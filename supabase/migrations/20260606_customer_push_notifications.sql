-- ============================================================
-- Customer push notification support
-- ============================================================
-- Architecture decision:
--   Customers who book via the public booking flow do not have
--   Supabase auth accounts, so their Expo push tokens cannot
--   live in user_push_tokens.  We store one token directly on
--   the bookings row, registered through an anon-accessible
--   security-definer RPC, and fan out customer push rows
--   inside the existing notification_outbox functions.
--
-- Workers are NOT changed: send-push-notifications already
--   polls notification_outbox for channel='push' regardless of
--   whether the recipient is the owner or the customer.
-- ============================================================

-- 1. Add customer token column to bookings.
alter table public.bookings
  add column if not exists customer_expo_push_token text;

-- 2. RPC: save a customer push token by booking_token (anon-safe).
--    Validates the booking_token exists and is not cancelled, then
--    writes the token.  Returns the booking id so the caller can
--    confirm success.
create or replace function public.register_customer_push_token(
  p_booking_token        text,
  p_expo_push_token      text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking_id uuid;
begin
  if p_booking_token is null or length(trim(p_booking_token)) = 0 then
    raise exception 'booking_token is required';
  end if;

  if p_expo_push_token is null or length(trim(p_expo_push_token)) = 0 then
    raise exception 'expo_push_token is required';
  end if;

  -- Only register for active bookings.
  select id
  into v_booking_id
  from public.bookings
  where booking_token = trim(p_booking_token)
    and status not in ('cancelled', 'completed', 'no_show')
  limit 1;

  if not found then
    raise exception 'booking not found or is no longer active';
  end if;

  update public.bookings
  set customer_expo_push_token = trim(p_expo_push_token)
  where id = v_booking_id;

  return v_booking_id;
end;
$$;

-- Revoke all from public, then grant execute to anon so customers
-- can register without logging in.
revoke all on function public.register_customer_push_token(text, text) from public;
grant execute on function public.register_customer_push_token(text, text) to anon;
grant execute on function public.register_customer_push_token(text, text) to authenticated;

-- 3. Customer-specific title helpers for push notifications.
--    The owner already has _salo_push_title / _salo_push_body which
--    are owner-centric ("New booking received").  Customers need a
--    different copy ("Your booking is confirmed").
create or replace function public._salo_customer_push_title(p_event_type text)
returns text
language plpgsql
immutable
as $$
begin
  if p_event_type = 'booking.created' then
    return 'Booking confirmed';
  elsif p_event_type = 'booking.rescheduled' then
    return 'Appointment rescheduled';
  elsif p_event_type = 'booking.cancelled' then
    return 'Appointment cancelled';
  elsif p_event_type = 'booking.reminder_24h' then
    return 'Appointment tomorrow';
  elsif p_event_type = 'booking.reminder_2h' then
    return 'Appointment in 2 hours';
  end if;
  return 'SALO update';
end;
$$;

create or replace function public._salo_customer_push_body(
  p_event_type text,
  p_service    text,
  p_date       text,
  p_time       text
)
returns text
language plpgsql
immutable
as $$
begin
  if p_event_type = 'booking.created' then
    return coalesce(p_service, 'Appointment') || ' on ' || coalesce(p_date, 'your date') || ' at ' || coalesce(p_time, 'your time');
  elsif p_event_type = 'booking.rescheduled' then
    return coalesce(p_service, 'Appointment') || ' moved to ' || coalesce(p_date, 'your date') || ' at ' || coalesce(p_time, 'your time');
  elsif p_event_type = 'booking.cancelled' then
    return coalesce(p_service, 'Appointment') || ' on ' || coalesce(p_date, 'your date') || ' at ' || coalesce(p_time, 'your time') || ' was cancelled';
  elsif p_event_type = 'booking.reminder_24h' then
    return coalesce(p_service, 'Appointment') || ' is tomorrow at ' || coalesce(p_time, 'your time');
  elsif p_event_type = 'booking.reminder_2h' then
    return coalesce(p_service, 'Appointment') || ' starts at ' || coalesce(p_time, 'your time');
  end if;
  return coalesce(p_service, 'Appointment') || ' update';
end;
$$;

-- 4. Update enqueue_notification_outbox_event to also insert a
--    customer push row when customer_expo_push_token is set.
--    This covers: booking.created, booking.rescheduled, booking.cancelled.
create or replace function public.enqueue_notification_outbox_event(
  p_event_type text,
  p_booking_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking           public.bookings%rowtype;
  v_manage_url        text;
  v_book_new_url      text;
  v_business_name     text;
  v_cancel_reason     text;
  v_owner_title       text;
  v_owner_body        text;
  v_customer_title    text;
  v_customer_body     text;
  v_push_token        record;
begin
  if p_event_type is null or p_booking_id is null then
    return;
  end if;

  select * into v_booking
  from public.bookings b
  where b.id = p_booking_id
  limit 1;

  if not found then
    return;
  end if;

  if v_booking.booking_token is null or length(trim(v_booking.booking_token)) = 0 then
    return;
  end if;

  select b.business_name into v_business_name
  from public.businesses b
  where b.id = v_booking.business_id
  limit 1;

  v_manage_url    := 'https://salo.app/appointment/' || trim(v_booking.booking_token);
  v_book_new_url  :=
    case
      when nullif(trim(coalesce(v_booking.business_slug, '')), '') is null
        then v_manage_url
      else
        'https://salo.app/book/' || trim(v_booking.business_slug)
    end;

  v_cancel_reason := nullif(
    trim(coalesce(
      v_booking.booking_metadata ->> 'cancel_reason',
      v_booking.booking_metadata ->> 'cancellation_reason',
      ''
    )),
    ''
  );

  -- ── Customer email ──────────────────────────────────────────
  insert into public.notification_outbox (
    business_id, booking_id, user_id,
    notification_channel, notification_status,
    event_type, template_key, recipient, payload,
    attempts, max_attempts, next_attempt_at, updated_at
  ) values (
    v_booking.business_id, v_booking.id, v_booking.user_id,
    'email', 'pending',
    p_event_type, p_event_type,
    lower(trim(coalesce(v_booking.customer_email, ''))),
    jsonb_build_object(
      'booking_id',            v_booking.id,
      'booking_token',         v_booking.booking_token,
      'business_id',           v_booking.business_id,
      'business_name',         coalesce(v_business_name, 'SALO'),
      'customer_name',         v_booking.client_name,
      'customer_email',        v_booking.customer_email,
      'customer_phone',        v_booking.customer_phone,
      'service',               v_booking.service,
      'date',                  v_booking.date,
      'time',                  v_booking.time,
      'cancellation_reason',   v_cancel_reason,
      'manage_appointment_url', v_manage_url,
      'book_new_appointment_url', v_book_new_url
    ),
    0, 3, timezone('utc', now()), timezone('utc', now())
  );

  -- ── Owner push (one row per registered owner device) ────────
  v_owner_title := public._salo_push_title(p_event_type);
  v_owner_body  := public._salo_push_body(p_event_type, v_booking.service, v_booking.date, v_booking.time);

  for v_push_token in
    select upt.expo_push_token
    from public.user_push_tokens upt
    where upt.user_id = v_booking.user_id
      and upt.enabled = true
      and nullif(trim(coalesce(upt.expo_push_token, '')), '') is not null
  loop
    insert into public.notification_outbox (
      business_id, booking_id, user_id,
      notification_channel, notification_status,
      event_type, template_key, recipient, payload,
      attempts, max_attempts, next_attempt_at, updated_at
    ) values (
      v_booking.business_id, v_booking.id, v_booking.user_id,
      'push', 'pending',
      p_event_type, p_event_type,
      trim(v_push_token.expo_push_token),
      jsonb_build_object(
        'title',               v_owner_title,
        'body',                v_owner_body,
        'booking_id',          v_booking.id,
        'event_type',          p_event_type,
        'manage_appointment_url', v_manage_url,
        'service',             v_booking.service,
        'date',                v_booking.date,
        'time',                v_booking.time,
        'business_name',       coalesce(v_business_name, 'SALO')
      ),
      0, 3, timezone('utc', now()), timezone('utc', now())
    );
  end loop;

  -- ── Customer push (when token registered via portal) ────────
  if nullif(trim(coalesce(v_booking.customer_expo_push_token, '')), '') is not null then
    v_customer_title := public._salo_customer_push_title(p_event_type);
    v_customer_body  := public._salo_customer_push_body(
      p_event_type, v_booking.service, v_booking.date, v_booking.time
    );

    insert into public.notification_outbox (
      business_id, booking_id, user_id,
      notification_channel, notification_status,
      event_type, template_key, recipient, payload,
      attempts, max_attempts, next_attempt_at, updated_at
    ) values (
      v_booking.business_id, v_booking.id, v_booking.user_id,
      'push', 'pending',
      p_event_type, p_event_type,
      trim(v_booking.customer_expo_push_token),
      jsonb_build_object(
        'title',               v_customer_title,
        'body',                v_customer_body,
        'booking_id',          v_booking.id,
        'event_type',          p_event_type,
        'manage_appointment_url', v_manage_url,
        'service',             v_booking.service,
        'date',                v_booking.date,
        'time',                v_booking.time,
        'business_name',       coalesce(v_business_name, 'SALO')
      ),
      0, 3, timezone('utc', now()), timezone('utc', now())
    );
  end if;
end;
$$;

-- 5. Update enqueue_booking_reminder_24h to also enqueue a
--    customer push row when customer_expo_push_token is set.
create or replace function public.enqueue_booking_reminder_24h(
  p_limit          integer default 200,
  p_window_minutes integer default 60
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows_inserted   integer := 0;
  v_inserted_email         integer := 0;
  v_inserted_push          integer := 0;
  v_inserted_customer_push integer := 0;
begin
  -- Customer email
  with eligible_email as (
    select
      b.id, b.booking_token, b.business_id, b.user_id,
      b.client_name, b.customer_email, b.service, b.date, b.time,
      bs.business_name
    from public.bookings b
    left join public.businesses bs on bs.id = b.business_id
    where b.status not in ('cancelled', 'completed', 'no_show')
      and nullif(trim(coalesce(b.customer_email, '')), '') is not null
      and nullif(trim(coalesce(b.booking_token, '')), '') is not null
      and to_timestamp(b.date || ' ' || b.time, 'YYYY-MM-DD HH24:MI')
            >= (timezone('utc', now()) + interval '24 hours')
      and to_timestamp(b.date || ' ' || b.time, 'YYYY-MM-DD HH24:MI')
            < (timezone('utc', now()) + interval '24 hours'
               + make_interval(mins => greatest(1, p_window_minutes)))
      and not exists (
        select 1 from public.notification_outbox n
        where n.booking_id = b.id
          and n.event_type = 'booking.reminder_24h'
          and n.notification_channel = 'email'
          and n.notification_status in ('pending', 'processing', 'processed')
      )
    order by b.date, b.time
    limit greatest(1, p_limit)
  )
  insert into public.notification_outbox (
    business_id, booking_id, user_id,
    notification_channel, notification_status,
    event_type, template_key, recipient, payload,
    attempts, max_attempts, next_attempt_at, updated_at
  )
  select
    e.business_id, e.id, e.user_id,
    'email', 'pending',
    'booking.reminder_24h', 'booking.reminder_24h',
    lower(trim(e.customer_email)),
    jsonb_build_object(
      'business_name', coalesce(e.business_name, 'SALO'),
      'customer_name', e.client_name,
      'service', e.service, 'date', e.date, 'time', e.time,
      'manage_appointment_url',
        'https://salo.app/appointment/' || trim(e.booking_token),
      'booking_id', e.id, 'event_type', 'booking.reminder_24h'
    ),
    0, 3, timezone('utc', now()), timezone('utc', now())
  from eligible_email e;

  get diagnostics v_inserted_email = row_count;

  -- Owner push
  with eligible_owner_push as (
    select
      b.id, b.booking_token, b.business_id, b.user_id,
      b.service, b.date, b.time, bs.business_name,
      upt.expo_push_token
    from public.bookings b
    left join public.businesses bs on bs.id = b.business_id
    join public.user_push_tokens upt
      on upt.user_id = b.user_id
     and upt.enabled = true
     and nullif(trim(coalesce(upt.expo_push_token, '')), '') is not null
    where b.status not in ('cancelled', 'completed', 'no_show')
      and nullif(trim(coalesce(b.booking_token, '')), '') is not null
      and to_timestamp(b.date || ' ' || b.time, 'YYYY-MM-DD HH24:MI')
            >= (timezone('utc', now()) + interval '24 hours')
      and to_timestamp(b.date || ' ' || b.time, 'YYYY-MM-DD HH24:MI')
            < (timezone('utc', now()) + interval '24 hours'
               + make_interval(mins => greatest(1, p_window_minutes)))
      and not exists (
        select 1 from public.notification_outbox n
        where n.booking_id = b.id
          and n.event_type = 'booking.reminder_24h'
          and n.notification_channel = 'push'
          and n.recipient = trim(upt.expo_push_token)
          and n.notification_status in ('pending', 'processing', 'processed')
      )
    order by b.date, b.time
    limit greatest(1, p_limit)
  )
  insert into public.notification_outbox (
    business_id, booking_id, user_id,
    notification_channel, notification_status,
    event_type, template_key, recipient, payload,
    attempts, max_attempts, next_attempt_at, updated_at
  )
  select
    e.business_id, e.id, e.user_id,
    'push', 'pending',
    'booking.reminder_24h', 'booking.reminder_24h',
    trim(e.expo_push_token),
    jsonb_build_object(
      'title', public._salo_push_title('booking.reminder_24h'),
      'body',  public._salo_push_body('booking.reminder_24h', e.service, e.date, e.time),
      'booking_id', e.id, 'event_type', 'booking.reminder_24h',
      'manage_appointment_url',
        'https://salo.app/appointment/' || trim(e.booking_token),
      'business_name', coalesce(e.business_name, 'SALO'),
      'service', e.service, 'date', e.date, 'time', e.time
    ),
    0, 3, timezone('utc', now()), timezone('utc', now())
  from eligible_owner_push e;

  get diagnostics v_inserted_push = row_count;

  -- Customer push (bookings with a registered customer token)
  with eligible_customer_push as (
    select
      b.id, b.booking_token, b.business_id, b.user_id,
      b.service, b.date, b.time, b.customer_expo_push_token,
      bs.business_name
    from public.bookings b
    left join public.businesses bs on bs.id = b.business_id
    where b.status not in ('cancelled', 'completed', 'no_show')
      and nullif(trim(coalesce(b.booking_token, '')), '') is not null
      and nullif(trim(coalesce(b.customer_expo_push_token, '')), '') is not null
      and to_timestamp(b.date || ' ' || b.time, 'YYYY-MM-DD HH24:MI')
            >= (timezone('utc', now()) + interval '24 hours')
      and to_timestamp(b.date || ' ' || b.time, 'YYYY-MM-DD HH24:MI')
            < (timezone('utc', now()) + interval '24 hours'
               + make_interval(mins => greatest(1, p_window_minutes)))
      and not exists (
        select 1 from public.notification_outbox n
        where n.booking_id = b.id
          and n.event_type = 'booking.reminder_24h'
          and n.notification_channel = 'push'
          and n.recipient = trim(b.customer_expo_push_token)
          and n.notification_status in ('pending', 'processing', 'processed')
      )
    order by b.date, b.time
    limit greatest(1, p_limit)
  )
  insert into public.notification_outbox (
    business_id, booking_id, user_id,
    notification_channel, notification_status,
    event_type, template_key, recipient, payload,
    attempts, max_attempts, next_attempt_at, updated_at
  )
  select
    e.business_id, e.id, e.user_id,
    'push', 'pending',
    'booking.reminder_24h', 'booking.reminder_24h',
    trim(e.customer_expo_push_token),
    jsonb_build_object(
      'title', public._salo_customer_push_title('booking.reminder_24h'),
      'body',  public._salo_customer_push_body('booking.reminder_24h', e.service, e.date, e.time),
      'booking_id', e.id, 'event_type', 'booking.reminder_24h',
      'manage_appointment_url',
        'https://salo.app/appointment/' || trim(e.booking_token),
      'business_name', coalesce(e.business_name, 'SALO'),
      'service', e.service, 'date', e.date, 'time', e.time
    ),
    0, 3, timezone('utc', now()), timezone('utc', now())
  from eligible_customer_push e;

  get diagnostics v_inserted_customer_push = row_count;
  v_rows_inserted := coalesce(v_inserted_email, 0)
                   + coalesce(v_inserted_push, 0)
                   + coalesce(v_inserted_customer_push, 0);
  return v_rows_inserted;
end;
$$;

-- 6. Update enqueue_booking_reminder_2h identically.
create or replace function public.enqueue_booking_reminder_2h(
  p_limit          integer default 200,
  p_window_minutes integer default 30
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows_inserted   integer := 0;
  v_inserted_email  integer := 0;
  v_inserted_push          integer := 0;
  v_inserted_customer_push integer := 0;
begin
  -- Customer email
  with eligible_email as (
    select
      b.id, b.booking_token, b.business_id, b.user_id,
      b.client_name, b.customer_email, b.service, b.date, b.time,
      bs.business_name
    from public.bookings b
    left join public.businesses bs on bs.id = b.business_id
    where b.status not in ('cancelled', 'completed', 'no_show')
      and nullif(trim(coalesce(b.customer_email, '')), '') is not null
      and nullif(trim(coalesce(b.booking_token, '')), '') is not null
      and to_timestamp(b.date || ' ' || b.time, 'YYYY-MM-DD HH24:MI')
            >= (timezone('utc', now()) + interval '2 hours')
      and to_timestamp(b.date || ' ' || b.time, 'YYYY-MM-DD HH24:MI')
            < (timezone('utc', now()) + interval '2 hours'
               + make_interval(mins => greatest(1, p_window_minutes)))
      and not exists (
        select 1 from public.notification_outbox n
        where n.booking_id = b.id
          and n.event_type = 'booking.reminder_2h'
          and n.notification_channel = 'email'
          and n.notification_status in ('pending', 'processing', 'processed')
      )
    order by b.date, b.time
    limit greatest(1, p_limit)
  )
  insert into public.notification_outbox (
    business_id, booking_id, user_id,
    notification_channel, notification_status,
    event_type, template_key, recipient, payload,
    attempts, max_attempts, next_attempt_at, updated_at
  )
  select
    e.business_id, e.id, e.user_id,
    'email', 'pending',
    'booking.reminder_2h', 'booking.reminder_2h',
    lower(trim(e.customer_email)),
    jsonb_build_object(
      'business_name', coalesce(e.business_name, 'SALO'),
      'customer_name', e.client_name,
      'service', e.service, 'date', e.date, 'time', e.time,
      'manage_appointment_url',
        'https://salo.app/appointment/' || trim(e.booking_token),
      'booking_id', e.id, 'event_type', 'booking.reminder_2h'
    ),
    0, 3, timezone('utc', now()), timezone('utc', now())
  from eligible_email e;

  get diagnostics v_inserted_email = row_count;

  -- Owner push
  with eligible_owner_push as (
    select
      b.id, b.booking_token, b.business_id, b.user_id,
      b.service, b.date, b.time, bs.business_name,
      upt.expo_push_token
    from public.bookings b
    left join public.businesses bs on bs.id = b.business_id
    join public.user_push_tokens upt
      on upt.user_id = b.user_id
     and upt.enabled = true
     and nullif(trim(coalesce(upt.expo_push_token, '')), '') is not null
    where b.status not in ('cancelled', 'completed', 'no_show')
      and nullif(trim(coalesce(b.booking_token, '')), '') is not null
      and to_timestamp(b.date || ' ' || b.time, 'YYYY-MM-DD HH24:MI')
            >= (timezone('utc', now()) + interval '2 hours')
      and to_timestamp(b.date || ' ' || b.time, 'YYYY-MM-DD HH24:MI')
            < (timezone('utc', now()) + interval '2 hours'
               + make_interval(mins => greatest(1, p_window_minutes)))
      and not exists (
        select 1 from public.notification_outbox n
        where n.booking_id = b.id
          and n.event_type = 'booking.reminder_2h'
          and n.notification_channel = 'push'
          and n.recipient = trim(upt.expo_push_token)
          and n.notification_status in ('pending', 'processing', 'processed')
      )
    order by b.date, b.time
    limit greatest(1, p_limit)
  )
  insert into public.notification_outbox (
    business_id, booking_id, user_id,
    notification_channel, notification_status,
    event_type, template_key, recipient, payload,
    attempts, max_attempts, next_attempt_at, updated_at
  )
  select
    e.business_id, e.id, e.user_id,
    'push', 'pending',
    'booking.reminder_2h', 'booking.reminder_2h',
    trim(e.expo_push_token),
    jsonb_build_object(
      'title', public._salo_push_title('booking.reminder_2h'),
      'body',  public._salo_push_body('booking.reminder_2h', e.service, e.date, e.time),
      'booking_id', e.id, 'event_type', 'booking.reminder_2h',
      'manage_appointment_url',
        'https://salo.app/appointment/' || trim(e.booking_token),
      'business_name', coalesce(e.business_name, 'SALO'),
      'service', e.service, 'date', e.date, 'time', e.time
    ),
    0, 3, timezone('utc', now()), timezone('utc', now())
  from eligible_owner_push e;

  get diagnostics v_inserted_push = row_count;

  -- Customer push
  with eligible_customer_push as (
    select
      b.id, b.booking_token, b.business_id, b.user_id,
      b.service, b.date, b.time, b.customer_expo_push_token,
      bs.business_name
    from public.bookings b
    left join public.businesses bs on bs.id = b.business_id
    where b.status not in ('cancelled', 'completed', 'no_show')
      and nullif(trim(coalesce(b.booking_token, '')), '') is not null
      and nullif(trim(coalesce(b.customer_expo_push_token, '')), '') is not null
      and to_timestamp(b.date || ' ' || b.time, 'YYYY-MM-DD HH24:MI')
            >= (timezone('utc', now()) + interval '2 hours')
      and to_timestamp(b.date || ' ' || b.time, 'YYYY-MM-DD HH24:MI')
            < (timezone('utc', now()) + interval '2 hours'
               + make_interval(mins => greatest(1, p_window_minutes)))
      and not exists (
        select 1 from public.notification_outbox n
        where n.booking_id = b.id
          and n.event_type = 'booking.reminder_2h'
          and n.notification_channel = 'push'
          and n.recipient = trim(b.customer_expo_push_token)
          and n.notification_status in ('pending', 'processing', 'processed')
      )
    order by b.date, b.time
    limit greatest(1, p_limit)
  )
  insert into public.notification_outbox (
    business_id, booking_id, user_id,
    notification_channel, notification_status,
    event_type, template_key, recipient, payload,
    attempts, max_attempts, next_attempt_at, updated_at
  )
  select
    e.business_id, e.id, e.user_id,
    'push', 'pending',
    'booking.reminder_2h', 'booking.reminder_2h',
    trim(e.customer_expo_push_token),
    jsonb_build_object(
      'title', public._salo_customer_push_title('booking.reminder_2h'),
      'body',  public._salo_customer_push_body('booking.reminder_2h', e.service, e.date, e.time),
      'booking_id', e.id, 'event_type', 'booking.reminder_2h',
      'manage_appointment_url',
        'https://salo.app/appointment/' || trim(e.booking_token),
      'business_name', coalesce(e.business_name, 'SALO'),
      'service', e.service, 'date', e.date, 'time', e.time
    ),
    0, 3, timezone('utc', now()), timezone('utc', now())
  from eligible_customer_push e;

  get diagnostics v_inserted_customer_push = row_count;
  v_rows_inserted := coalesce(v_inserted_email, 0)
                   + coalesce(v_inserted_push, 0)
                   + coalesce(v_inserted_customer_push, 0);
  return v_rows_inserted;
end;
$$;

revoke all on function public.enqueue_notification_outbox_event(text, uuid) from public;
revoke all on function public.enqueue_booking_reminder_24h(integer, integer) from public;
revoke all on function public.enqueue_booking_reminder_2h(integer, integer) from public;
revoke all on function public._salo_customer_push_title(text) from public;
revoke all on function public._salo_customer_push_body(text, text, text, text) from public;
