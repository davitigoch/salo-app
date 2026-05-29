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
    lower(trim(e.customer_email)),
    jsonb_build_object(
      'business_name', coalesce(e.business_name, 'SALO'),
      'customer_name', e.client_name,
      'service', e.service,
      'date', e.date,
      'time', e.time,
      'manage_appointment_url', 'https://salo.app/appointment/' || trim(e.booking_token),
      'booking_id', e.id,
      'booking_token', e.booking_token,
      'business_id', e.business_id
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
begin
  with eligible as (
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
      and to_timestamp(b.date || ' ' || b.time, 'YYYY-MM-DD HH24:MI')
            >= (timezone('utc', now()) + interval '2 hours')
      and to_timestamp(b.date || ' ' || b.time, 'YYYY-MM-DD HH24:MI')
            < (timezone('utc', now()) + interval '2 hours' + make_interval(mins => greatest(1, p_window_minutes)))
      and not exists (
        select 1
        from public.notification_outbox n
        where n.booking_id = b.id
          and n.event_type = 'booking.reminder_2h'
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
      'booking_token', e.booking_token,
      'business_id', e.business_id
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

revoke all on function public.enqueue_booking_reminder_24h(integer, integer) from public;
revoke all on function public.enqueue_booking_reminder_2h(integer, integer) from public;
