create table if not exists public.user_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  expo_push_token text not null,
  platform text,
  enabled boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists user_push_tokens_expo_push_token_uidx
  on public.user_push_tokens (expo_push_token);

alter table public.user_push_tokens
  enable row level security;

drop policy if exists "Users can read own push tokens" on public.user_push_tokens;
create policy "Users can read own push tokens"
on public.user_push_tokens
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own push tokens" on public.user_push_tokens;
create policy "Users can insert own push tokens"
on public.user_push_tokens
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own push tokens" on public.user_push_tokens;
create policy "Users can update own push tokens"
on public.user_push_tokens
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own push tokens" on public.user_push_tokens;
create policy "Users can delete own push tokens"
on public.user_push_tokens
for delete
using (auth.uid() = user_id);

create or replace function public.set_user_push_tokens_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists on_user_push_tokens_set_updated_at on public.user_push_tokens;
create trigger on_user_push_tokens_set_updated_at
before update on public.user_push_tokens
for each row
execute procedure public.set_user_push_tokens_updated_at();

alter table public.notification_outbox
  drop constraint if exists notification_outbox_notification_channel_check;

alter table public.notification_outbox
  add constraint notification_outbox_notification_channel_check
  check (notification_channel in ('email', 'push'));

alter table public.notification_outbox
  drop constraint if exists notification_outbox_event_type_check;

alter table public.notification_outbox
  add constraint notification_outbox_event_type_check
  check (
    event_type in (
      'booking.created',
      'booking.rescheduled',
      'booking.cancelled',
      'booking.reminder_24h',
      'booking.reminder_2h'
    )
  );

create or replace function public._salo_push_title(p_event_type text)
returns text
language plpgsql
immutable
as $$
begin
  if p_event_type = 'booking.created' then
    return 'New booking received';
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

create or replace function public._salo_push_body(
  p_event_type text,
  p_service text,
  p_date text,
  p_time text
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
  v_booking public.bookings%rowtype;
  v_manage_appointment_url text;
  v_book_new_appointment_url text;
  v_business_name text;
  v_cancel_reason text;
  v_push_title text;
  v_push_body text;
  v_push_token record;
begin
  if p_event_type is null or p_booking_id is null then
    return;
  end if;

  select *
  into v_booking
  from public.bookings b
  where b.id = p_booking_id
  limit 1;

  if not found then
    return;
  end if;

  if v_booking.booking_token is null or length(trim(v_booking.booking_token)) = 0 then
    return;
  end if;

  select b.business_name
  into v_business_name
  from public.businesses b
  where b.id = v_booking.business_id
  limit 1;

  v_manage_appointment_url := 'https://salo.app/appointment/' || trim(v_booking.booking_token);
  v_book_new_appointment_url :=
    case
      when nullif(trim(coalesce(v_booking.business_slug, '')), '') is null then
        v_manage_appointment_url
      else
        'https://salo.app/book/' || trim(v_booking.business_slug)
    end;

  v_cancel_reason := nullif(
    trim(
      coalesce(
        v_booking.booking_metadata ->> 'cancel_reason',
        v_booking.booking_metadata ->> 'cancellation_reason',
        ''
      )
    ),
    ''
  );

  insert into public.notification_outbox (
    business_id,
    booking_id,
    user_id,
    notification_channel,
    notification_status,
    event_type,
    template_key,
    recipient,
    payload,
    attempts,
    max_attempts,
    next_attempt_at,
    updated_at
  ) values (
    v_booking.business_id,
    v_booking.id,
    v_booking.user_id,
    'email',
    'pending',
    p_event_type,
    p_event_type,
    lower(trim(coalesce(v_booking.customer_email, ''))),
    jsonb_build_object(
      'booking_id', v_booking.id,
      'booking_token', v_booking.booking_token,
      'business_id', v_booking.business_id,
      'business_name', coalesce(v_business_name, 'SALO'),
      'customer_name', v_booking.client_name,
      'customer_email', v_booking.customer_email,
      'customer_phone', v_booking.customer_phone,
      'service', v_booking.service,
      'date', v_booking.date,
      'time', v_booking.time,
      'cancellation_reason', v_cancel_reason,
      'manage_appointment_url', v_manage_appointment_url,
      'book_new_appointment_url', v_book_new_appointment_url
    ),
    0,
    3,
    timezone('utc', now()),
    timezone('utc', now())
  );

  v_push_title := public._salo_push_title(p_event_type);
  v_push_body := public._salo_push_body(p_event_type, v_booking.service, v_booking.date, v_booking.time);

  for v_push_token in
    select upt.expo_push_token
    from public.user_push_tokens upt
    where upt.user_id = v_booking.user_id
      and upt.enabled = true
      and nullif(trim(coalesce(upt.expo_push_token, '')), '') is not null
  loop
    insert into public.notification_outbox (
      business_id,
      booking_id,
      user_id,
      notification_channel,
      notification_status,
      event_type,
      template_key,
      recipient,
      payload,
      attempts,
      max_attempts,
      next_attempt_at,
      updated_at
    ) values (
      v_booking.business_id,
      v_booking.id,
      v_booking.user_id,
      'push',
      'pending',
      p_event_type,
      p_event_type,
      trim(v_push_token.expo_push_token),
      jsonb_build_object(
        'title', v_push_title,
        'body', v_push_body,
        'booking_id', v_booking.id,
        'event_type', p_event_type,
        'manage_appointment_url', v_manage_appointment_url,
        'service', v_booking.service,
        'date', v_booking.date,
        'time', v_booking.time,
        'business_name', coalesce(v_business_name, 'SALO')
      ),
      0,
      3,
      timezone('utc', now()),
      timezone('utc', now())
    );
  end loop;
end;
$$;

create or replace function public.enqueue_booking_reminder_24h(
  p_limit integer default 200,
  p_window_minutes integer default 60
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows_inserted integer := 0;
  v_inserted_email integer := 0;
  v_inserted_push integer := 0;
begin
  with eligible_email as (
    select
      b.id,
      b.booking_token,
      b.business_id,
      b.user_id,
      b.client_name,
      b.customer_email,
      b.service,
      b.date,
      b.time,
      bs.business_name
    from public.bookings b
    left join public.businesses bs on bs.id = b.business_id
    where b.status not in ('cancelled', 'completed', 'no_show')
      and nullif(trim(coalesce(b.customer_email, '')), '') is not null
      and nullif(trim(coalesce(b.booking_token, '')), '') is not null
      and to_timestamp(b.date || ' ' || b.time, 'YYYY-MM-DD HH24:MI') >= (timezone('utc', now()) + interval '24 hours')
      and to_timestamp(b.date || ' ' || b.time, 'YYYY-MM-DD HH24:MI') < (timezone('utc', now()) + interval '24 hours' + make_interval(mins => greatest(1, p_window_minutes)))
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
    business_id, booking_id, user_id, notification_channel, notification_status,
    event_type, template_key, recipient, payload, attempts, max_attempts,
    next_attempt_at, updated_at
  )
  select
    e.business_id,
    e.id,
    e.user_id,
    'email',
    'pending',
    'booking.reminder_24h',
    'booking.reminder_24h',
    lower(trim(e.customer_email)),
    jsonb_build_object(
      'business_name', coalesce(e.business_name, 'SALO'),
      'customer_name', e.client_name,
      'service', e.service,
      'date', e.date,
      'time', e.time,
      'manage_appointment_url', 'https://salo.app/appointment/' || trim(e.booking_token),
      'booking_id', e.id,
      'event_type', 'booking.reminder_24h'
    ),
    0,
    3,
    timezone('utc', now()),
    timezone('utc', now())
  from eligible_email e;

  get diagnostics v_inserted_email = row_count;

  with eligible_push as (
    select
      b.id,
      b.booking_token,
      b.business_id,
      b.user_id,
      b.service,
      b.date,
      b.time,
      bs.business_name,
      upt.expo_push_token
    from public.bookings b
    left join public.businesses bs on bs.id = b.business_id
    join public.user_push_tokens upt
      on upt.user_id = b.user_id
     and upt.enabled = true
     and nullif(trim(coalesce(upt.expo_push_token, '')), '') is not null
    where b.status not in ('cancelled', 'completed', 'no_show')
      and nullif(trim(coalesce(b.booking_token, '')), '') is not null
      and to_timestamp(b.date || ' ' || b.time, 'YYYY-MM-DD HH24:MI') >= (timezone('utc', now()) + interval '24 hours')
      and to_timestamp(b.date || ' ' || b.time, 'YYYY-MM-DD HH24:MI') < (timezone('utc', now()) + interval '24 hours' + make_interval(mins => greatest(1, p_window_minutes)))
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
    business_id, booking_id, user_id, notification_channel, notification_status,
    event_type, template_key, recipient, payload, attempts, max_attempts,
    next_attempt_at, updated_at
  )
  select
    e.business_id,
    e.id,
    e.user_id,
    'push',
    'pending',
    'booking.reminder_24h',
    'booking.reminder_24h',
    trim(e.expo_push_token),
    jsonb_build_object(
      'title', public._salo_push_title('booking.reminder_24h'),
      'body', public._salo_push_body('booking.reminder_24h', e.service, e.date, e.time),
      'booking_id', e.id,
      'event_type', 'booking.reminder_24h',
      'manage_appointment_url', 'https://salo.app/appointment/' || trim(e.booking_token),
      'business_name', coalesce(e.business_name, 'SALO'),
      'service', e.service,
      'date', e.date,
      'time', e.time
    ),
    0,
    3,
    timezone('utc', now()),
    timezone('utc', now())
  from eligible_push e;

  get diagnostics v_inserted_push = row_count;
  v_rows_inserted := coalesce(v_inserted_email, 0) + coalesce(v_inserted_push, 0);
  return v_rows_inserted;
end;
$$;

create or replace function public.enqueue_booking_reminder_2h(
  p_limit integer default 200,
  p_window_minutes integer default 30
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows_inserted integer := 0;
  v_inserted_email integer := 0;
  v_inserted_push integer := 0;
begin
  with eligible_email as (
    select
      b.id,
      b.booking_token,
      b.business_id,
      b.user_id,
      b.client_name,
      b.customer_email,
      b.service,
      b.date,
      b.time,
      bs.business_name
    from public.bookings b
    left join public.businesses bs on bs.id = b.business_id
    where b.status not in ('cancelled', 'completed', 'no_show')
      and nullif(trim(coalesce(b.customer_email, '')), '') is not null
      and nullif(trim(coalesce(b.booking_token, '')), '') is not null
      and to_timestamp(b.date || ' ' || b.time, 'YYYY-MM-DD HH24:MI') >= (timezone('utc', now()) + interval '2 hours')
      and to_timestamp(b.date || ' ' || b.time, 'YYYY-MM-DD HH24:MI') < (timezone('utc', now()) + interval '2 hours' + make_interval(mins => greatest(1, p_window_minutes)))
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
    business_id, booking_id, user_id, notification_channel, notification_status,
    event_type, template_key, recipient, payload, attempts, max_attempts,
    next_attempt_at, updated_at
  )
  select
    e.business_id,
    e.id,
    e.user_id,
    'email',
    'pending',
    'booking.reminder_2h',
    'booking.reminder_2h',
    lower(trim(e.customer_email)),
    jsonb_build_object(
      'business_name', coalesce(e.business_name, 'SALO'),
      'customer_name', e.client_name,
      'service', e.service,
      'date', e.date,
      'time', e.time,
      'manage_appointment_url', 'https://salo.app/appointment/' || trim(e.booking_token),
      'booking_id', e.id,
      'event_type', 'booking.reminder_2h'
    ),
    0,
    3,
    timezone('utc', now()),
    timezone('utc', now())
  from eligible_email e;

  get diagnostics v_inserted_email = row_count;

  with eligible_push as (
    select
      b.id,
      b.booking_token,
      b.business_id,
      b.user_id,
      b.service,
      b.date,
      b.time,
      bs.business_name,
      upt.expo_push_token
    from public.bookings b
    left join public.businesses bs on bs.id = b.business_id
    join public.user_push_tokens upt
      on upt.user_id = b.user_id
     and upt.enabled = true
     and nullif(trim(coalesce(upt.expo_push_token, '')), '') is not null
    where b.status not in ('cancelled', 'completed', 'no_show')
      and nullif(trim(coalesce(b.booking_token, '')), '') is not null
      and to_timestamp(b.date || ' ' || b.time, 'YYYY-MM-DD HH24:MI') >= (timezone('utc', now()) + interval '2 hours')
      and to_timestamp(b.date || ' ' || b.time, 'YYYY-MM-DD HH24:MI') < (timezone('utc', now()) + interval '2 hours' + make_interval(mins => greatest(1, p_window_minutes)))
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
    business_id, booking_id, user_id, notification_channel, notification_status,
    event_type, template_key, recipient, payload, attempts, max_attempts,
    next_attempt_at, updated_at
  )
  select
    e.business_id,
    e.id,
    e.user_id,
    'push',
    'pending',
    'booking.reminder_2h',
    'booking.reminder_2h',
    trim(e.expo_push_token),
    jsonb_build_object(
      'title', public._salo_push_title('booking.reminder_2h'),
      'body', public._salo_push_body('booking.reminder_2h', e.service, e.date, e.time),
      'booking_id', e.id,
      'event_type', 'booking.reminder_2h',
      'manage_appointment_url', 'https://salo.app/appointment/' || trim(e.booking_token),
      'business_name', coalesce(e.business_name, 'SALO'),
      'service', e.service,
      'date', e.date,
      'time', e.time
    ),
    0,
    3,
    timezone('utc', now()),
    timezone('utc', now())
  from eligible_push e;

  get diagnostics v_inserted_push = row_count;
  v_rows_inserted := coalesce(v_inserted_email, 0) + coalesce(v_inserted_push, 0);
  return v_rows_inserted;
end;
$$;

revoke all on function public.enqueue_notification_outbox_event(text, uuid) from public;
revoke all on function public.enqueue_booking_reminder_24h(integer, integer) from public;
revoke all on function public.enqueue_booking_reminder_2h(integer, integer) from public;
