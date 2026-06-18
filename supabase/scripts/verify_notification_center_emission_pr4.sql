-- Verification script for PR4 Phase 4.2: Notification Center emission wiring.
-- Run after applying 20260703_notification_center_emission.sql

begin;

-- ---------------------------------------------------------------------------
-- 1. Trigger / function presence
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'emit_booking_notification_events'
  ) then
    raise exception 'VERIFY FAIL: emit_booking_notification_events missing';
  end if;

  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'bookings' and t.tgname = 'on_booking_notification_events'
  ) then
    raise exception 'VERIFY FAIL: on_booking_notification_events trigger missing';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'emit_payment_notification_event'
  ) then
    raise exception 'VERIFY FAIL: emit_payment_notification_event missing';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'emit_sms_delivery_failed_notification'
  ) then
    raise exception 'VERIFY FAIL: emit_sms_delivery_failed_notification missing';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'emit_calendar_sync_failed_notification'
  ) then
    raise exception 'VERIFY FAIL: emit_calendar_sync_failed_notification missing';
  end if;

  raise notice 'VERIFY PASS: emission triggers present';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Fixture context
-- ---------------------------------------------------------------------------

create temp table _emit_ctx on commit drop as
with owner_user as (
  select id from auth.users order by created_at asc limit 1
),
new_business as (
  insert into public.businesses (
    owner_user_id,
    business_name,
    slug,
    timezone
  )
  select
    owner_user.id,
    'Notification Emit Verify Co',
    'notif-emit-' || left(replace(gen_random_uuid()::text, '-', ''), 10),
    'America/New_York'
  from owner_user
  returning id, owner_user_id
)
select nb.id as business_id, nb.owner_user_id as user_id
from new_business nb;

-- ---------------------------------------------------------------------------
-- 3. Booking events: public request, owner created, confirmed, reschedule, cancel
-- ---------------------------------------------------------------------------

do $$
declare
  v_business_id uuid;
  v_user_id uuid;
  v_public_booking_id uuid;
  v_owner_booking_id uuid;
  v_count integer;
begin
  select business_id, user_id into v_business_id, v_user_id from _emit_ctx limit 1;

  insert into public.bookings (
    client_name, service, date, time, status, price, user_id, business_id,
    booking_source, customer_email, customer_phone, booking_token
  ) values (
    'Sam Rivera', 'Consultation', '2030-09-01', '10:00', 'pending', 80,
    v_user_id, v_business_id, 'public', 'sam@example.com', '555-0200',
    'emit-public-' || left(replace(gen_random_uuid()::text, '-', ''), 12)
  )
  returning id into v_public_booking_id;

  if not exists (
    select 1 from public.notification_events
    where business_id = v_business_id and event_type = 'public_booking_request'
      and (metadata ->> 'booking_id')::uuid = v_public_booking_id
  ) then
    raise exception 'VERIFY FAIL: public_booking_request not emitted';
  end if;

  insert into public.bookings (
    client_name, service, date, time, status, price, user_id, business_id,
    booking_source, customer_email, customer_phone, booking_token
  ) values (
    'Jordan Lee', 'Strategy Session', '2030-09-02', '14:00', 'confirmed', 120,
    v_user_id, v_business_id, 'owner', 'jordan@example.com', '555-0201',
    'emit-owner-' || left(replace(gen_random_uuid()::text, '-', ''), 12)
  )
  returning id into v_owner_booking_id;

  select count(*)::integer into v_count
  from public.notification_events
  where business_id = v_business_id
    and (metadata ->> 'booking_id')::uuid = v_owner_booking_id
    and event_type in ('booking_created', 'booking_confirmed');

  if v_count < 2 then
    raise exception 'VERIFY FAIL: expected booking_created + booking_confirmed for owner booking, got %', v_count;
  end if;

  update public.bookings
  set date = '2030-09-03', time = '15:00'
  where id = v_owner_booking_id;

  if not exists (
    select 1 from public.notification_events
    where business_id = v_business_id and event_type = 'booking_rescheduled'
      and (metadata ->> 'booking_id')::uuid = v_owner_booking_id
  ) then
    raise exception 'VERIFY FAIL: booking_rescheduled not emitted';
  end if;

  update public.bookings set status = 'cancelled' where id = v_owner_booking_id;

  if not exists (
    select 1 from public.notification_events
    where business_id = v_business_id and event_type = 'booking_cancelled'
      and (metadata ->> 'booking_id')::uuid = v_owner_booking_id
  ) then
    raise exception 'VERIFY FAIL: booking_cancelled not emitted';
  end if;

  update public.bookings set status = 'confirmed' where id = v_public_booking_id;

  if not exists (
    select 1 from public.notification_events
    where business_id = v_business_id and event_type = 'booking_confirmed'
      and (metadata ->> 'booking_id')::uuid = v_public_booking_id
  ) then
    raise exception 'VERIFY FAIL: booking_confirmed not emitted on public request confirm';
  end if;

  raise notice 'VERIFY PASS: booking lifecycle events emitted';
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. payment_received
-- ---------------------------------------------------------------------------

do $$
declare
  v_business_id uuid;
  v_booking_id uuid;
  v_payment_id uuid;
begin
  select business_id into v_business_id from _emit_ctx limit 1;

  select id into v_booking_id
  from public.bookings
  where business_id = v_business_id and client_name = 'Sam Rivera'
  limit 1;

  insert into public.payments (
    booking_id, business_id, amount, currency, status,
    provider_event_type, provider_event_id
  ) values (
    v_booking_id, v_business_id, 40.00, 'usd', 'succeeded',
    'payment_succeeded', 'verify-emit-payment-1'
  )
  returning id into v_payment_id;

  if not exists (
    select 1 from public.notification_events
    where business_id = v_business_id
      and event_type = 'payment_received'
      and entity_id = v_payment_id
  ) then
    raise exception 'VERIFY FAIL: payment_received not emitted';
  end if;

  raise notice 'VERIFY PASS: payment_received emitted';
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. message_delivery_failed (SMS) — when sms_notifications exists
-- ---------------------------------------------------------------------------

do $$
declare
  v_business_id uuid;
  v_booking_id uuid;
  v_sms_id uuid;
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'sms_notifications'
  ) then
    raise notice 'VERIFY SKIP: sms_notifications table not present';
    return;
  end if;

  select business_id into v_business_id from _emit_ctx limit 1;

  select id into v_booking_id
  from public.bookings
  where business_id = v_business_id and client_name = 'Sam Rivera'
  limit 1;

  insert into public.sms_notifications (
    business_id, booking_id, event_type, customer_phone, status, last_error
  ) values (
    v_business_id, v_booking_id, 'booking_confirmed', '555-0200', 'failed',
    'Twilio unreachable (verify fixture)'
  )
  returning id into v_sms_id;

  if not exists (
    select 1 from public.notification_events
    where business_id = v_business_id
      and event_type = 'message_delivery_failed'
      and metadata ->> 'sms_notification_id' = v_sms_id::text
  ) then
    raise exception 'VERIFY FAIL: message_delivery_failed not emitted';
  end if;

  raise notice 'VERIFY PASS: message_delivery_failed emitted';
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. calendar_sync_failed
-- ---------------------------------------------------------------------------

do $$
declare
  v_business_id uuid;
  v_booking_id uuid;
  v_job_id uuid;
begin
  select business_id into v_business_id from _emit_ctx limit 1;

  select id into v_booking_id
  from public.bookings
  where business_id = v_business_id and client_name = 'Sam Rivera'
  limit 1;

  insert into public.calendar_sync_jobs (
    business_id, booking_id, operation, event_type, status, last_error
  ) values (
    v_business_id, v_booking_id, 'create', 'booking_confirmed', 'failed',
    'Google API error (verify fixture)'
  )
  returning id into v_job_id;

  if not exists (
    select 1 from public.notification_events
    where business_id = v_business_id
      and event_type = 'calendar_sync_failed'
      and metadata ->> 'calendar_sync_job_id' = v_job_id::text
  ) then
    raise exception 'VERIFY FAIL: calendar_sync_failed not emitted';
  end if;

  raise notice 'VERIFY PASS: calendar_sync_failed emitted';
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Dedupe: payment emit twice should not duplicate
-- ---------------------------------------------------------------------------

do $$
declare
  v_payment_id uuid;
  v_count integer;
begin
  select id into v_payment_id
  from public.payments
  where provider_event_id = 'verify-emit-payment-1'
  limit 1;

  update public.payments
  set updated_at = timezone('utc', now())
  where id = v_payment_id;

  select count(*)::integer into v_count
  from public.notification_events
  where event_type = 'payment_received' and entity_id = v_payment_id;

  if v_count <> 1 then
    raise exception 'VERIFY FAIL: payment_received dedupe expected 1 row, got %', v_count;
  end if;

  raise notice 'VERIFY PASS: payment dedupe holds';
end;
$$;

rollback;
