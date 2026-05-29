alter table public.notification_outbox
  add column if not exists notification_channel text not null default 'email',
  add column if not exists notification_status text not null default 'pending',
  add column if not exists attempts integer not null default 0,
  add column if not exists max_attempts integer not null default 3,
  add column if not exists next_attempt_at timestamptz not null default timezone('utc', now()),
  add column if not exists template_key text,
  add column if not exists recipient text,
  add column if not exists sent_at timestamptz,
  add column if not exists last_error text,
  add column if not exists provider_message_id text,
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

update public.notification_outbox
set notification_channel = coalesce(notification_channel, 'email');

update public.notification_outbox
set notification_status = coalesce(notification_status, 'pending');

update public.notification_outbox
set attempts = coalesce(attempts, 0);

update public.notification_outbox
set max_attempts = coalesce(max_attempts, 3);

update public.notification_outbox
set next_attempt_at = coalesce(next_attempt_at, timezone('utc', now()));

update public.notification_outbox
set template_key = coalesce(template_key, event_type);

update public.notification_outbox
set recipient = coalesce(recipient, payload ->> 'customer_email');

alter table public.notification_outbox
  drop constraint if exists notification_outbox_notification_channel_check;

alter table public.notification_outbox
  add constraint notification_outbox_notification_channel_check
  check (notification_channel in ('email'));

alter table public.notification_outbox
  drop constraint if exists notification_outbox_notification_status_check;

alter table public.notification_outbox
  add constraint notification_outbox_notification_status_check
  check (notification_status in ('pending', 'processing', 'processed', 'failed'));

create index if not exists notification_outbox_email_queue_idx
  on public.notification_outbox (notification_channel, notification_status, next_attempt_at, created_at);

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
  v_business_name text;
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

  insert into public.notification_outbox (
    event_type,
    booking_id,
    business_id,
    template_key,
    recipient,
    payload,
    notification_channel,
    notification_status,
    attempts,
    max_attempts,
    next_attempt_at,
    updated_at
  ) values (
    p_event_type,
    v_booking.id,
    v_booking.business_id,
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
      'manage_appointment_url', v_manage_appointment_url
    ),
    'email',
    'pending',
    0,
    3,
    timezone('utc', now()),
    timezone('utc', now())
  );
end;
$$;

revoke all on function public.enqueue_notification_outbox_event(text, uuid) from public;
