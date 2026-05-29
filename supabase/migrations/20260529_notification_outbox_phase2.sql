alter table public.notification_outbox
  drop constraint if exists notification_outbox_event_type_check;

alter table public.notification_outbox
  add constraint notification_outbox_event_type_check
  check (
    event_type in (
      'booking.created',
      'booking.rescheduled',
      'booking.cancelled',
      'booking.reminder_24h'
    )
  );

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
    nullif(trim(coalesce(v_booking.customer_email, '')), ''),
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
end;
$$;

create or replace function public.enqueue_booking_lifecycle_outbox_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_manage_appointment_url text;
  v_book_new_appointment_url text;
  v_business_name text;
  v_cancel_reason text;
begin
  if tg_op = 'INSERT' then
    if coalesce(new.booking_source, 'owner') = 'public' then
      perform public.enqueue_notification_outbox_event('booking.created', new.id);
    end if;

    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.status is distinct from new.status and new.status = 'cancelled' then
      perform public.enqueue_notification_outbox_event('booking.cancelled', new.id);
    end if;

    if old.date is distinct from new.date or old.time is distinct from new.time then
      if new.booking_token is null or length(trim(new.booking_token)) = 0 then
        return new;
      end if;

      select b.business_name
      into v_business_name
      from public.businesses b
      where b.id = new.business_id
      limit 1;

      v_manage_appointment_url := 'https://salo.app/appointment/' || trim(new.booking_token);
      v_book_new_appointment_url :=
        case
          when nullif(trim(coalesce(new.business_slug, '')), '') is null then
            v_manage_appointment_url
          else
            'https://salo.app/book/' || trim(new.business_slug)
        end;

      v_cancel_reason := nullif(
        trim(
          coalesce(
            new.booking_metadata ->> 'cancel_reason',
            new.booking_metadata ->> 'cancellation_reason',
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
        new.business_id,
        new.id,
        new.user_id,
        'email',
        'pending',
        'booking.rescheduled',
        'booking.rescheduled',
        nullif(trim(coalesce(new.customer_email, '')), ''),
        jsonb_build_object(
          'booking_id', new.id,
          'booking_token', new.booking_token,
          'business_id', new.business_id,
          'business_name', coalesce(v_business_name, 'SALO'),
          'customer_name', new.client_name,
          'customer_email', new.customer_email,
          'customer_phone', new.customer_phone,
          'service', new.service,
          'date', new.date,
          'time', new.time,
          'previous_date', old.date,
          'previous_time', old.time,
          'cancellation_reason', v_cancel_reason,
          'manage_appointment_url', v_manage_appointment_url,
          'book_new_appointment_url', v_book_new_appointment_url
        ),
        0,
        3,
        timezone('utc', now()),
        timezone('utc', now())
      );
    end if;

    return new;
  end if;

  return new;
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
begin
  with eligible as (
    select
      b.id,
      b.booking_token,
      b.business_id,
      b.business_slug,
      b.user_id,
      b.client_name,
      b.customer_email,
      b.customer_phone,
      b.service,
      b.date,
      b.time,
      bs.business_name
    from public.bookings b
    left join public.businesses bs on bs.id = b.business_id
    where b.status not in ('cancelled', 'completed', 'no_show')
      and nullif(trim(coalesce(b.customer_email, '')), '') is not null
      and nullif(trim(coalesce(b.booking_token, '')), '') is not null
      and to_timestamp(b.date || ' ' || b.time, 'YYYY-MM-DD HH24:MI')
            >= (timezone('utc', now()) + interval '24 hours')
      and to_timestamp(b.date || ' ' || b.time, 'YYYY-MM-DD HH24:MI')
            < (timezone('utc', now()) + interval '24 hours' + make_interval(mins => greatest(1, p_window_minutes)))
      and not exists (
        select 1
        from public.notification_outbox n
        where n.booking_id = b.id
          and n.event_type = 'booking.reminder_24h'
          and n.notification_channel = 'email'
          and n.notification_status in ('pending', 'processing', 'processed')
      )
    order by b.date, b.time
    limit greatest(1, p_limit)
  )
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
  )
  select
    e.business_id,
    e.id,
    e.user_id,
    'email',
    'pending',
    'booking.reminder_24h',
    'booking.reminder_24h',
    nullif(trim(coalesce(e.customer_email, '')), ''),
    jsonb_build_object(
      'booking_id', e.id,
      'booking_token', e.booking_token,
      'business_id', e.business_id,
      'business_name', coalesce(e.business_name, 'SALO'),
      'customer_name', e.client_name,
      'customer_email', e.customer_email,
      'customer_phone', e.customer_phone,
      'service', e.service,
      'date', e.date,
      'time', e.time,
      'manage_appointment_url', 'https://salo.app/appointment/' || trim(e.booking_token),
      'book_new_appointment_url',
        case
          when nullif(trim(coalesce(e.business_slug, '')), '') is null then
            'https://salo.app/appointment/' || trim(e.booking_token)
          else
            'https://salo.app/book/' || trim(e.business_slug)
        end,
      'reminder_window_hours', 24
    ),
    0,
    3,
    timezone('utc', now()),
    timezone('utc', now())
  from eligible e;

  get diagnostics v_rows_inserted = row_count;
  return coalesce(v_rows_inserted, 0);
end;
$$;

revoke all on function public.enqueue_notification_outbox_event(text, uuid) from public;
revoke all on function public.enqueue_booking_lifecycle_outbox_events() from public;
revoke all on function public.enqueue_booking_reminder_24h(integer, integer) from public;
