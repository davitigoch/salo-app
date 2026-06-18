-- Verification script for SMS Reminders foundation.
-- Run after applying:
--   20260705_sms_reminders_foundation.sql
--   20260706_sms_reminders_schedule_prefs_fix.sql

begin;

do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'sms_notifications'
  ) then
    raise exception 'VERIFY FAIL: sms_notifications table missing';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'claim_sms_notifications'
  ) then
    raise exception 'VERIFY FAIL: claim_sms_notifications RPC missing';
  end if;

  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    where c.relname = 'bookings' and t.tgname = 'on_booking_sms_notifications_enqueue'
  ) then
    raise exception 'VERIFY FAIL: on_booking_sms_notifications_enqueue trigger missing';
  end if;

  raise notice 'VERIFY PASS: SMS schema objects present';
end;
$$;

create temp table _sms_ctx on commit drop as
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
    'SMS Reminders Verify Co',
    'sms-verify-' || left(replace(gen_random_uuid()::text, '-', ''), 10),
    'America/New_York'
  from owner_user
  returning id, owner_user_id
)
select nb.id as business_id, nb.owner_user_id as user_id
from new_business nb;

do $$
declare
  v_business_id uuid;
  v_user_id uuid;
  v_booking_id uuid;
  v_confirmed_count integer;
  v_reminder_count integer;
begin
  select business_id, user_id into v_business_id, v_user_id from _sms_ctx limit 1;

  insert into public.bookings (
    client_name, service, date, time, status, price, user_id, business_id,
    booking_source, customer_email, customer_phone, booking_token
  ) values (
    'Taylor Brooks', 'Consultation', '2030-10-15', '14:00', 'confirmed', 100,
    v_user_id, v_business_id, 'owner', 'taylor@example.com', '555-0300',
    'sms-verify-' || left(replace(gen_random_uuid()::text, '-', ''), 12)
  )
  returning id into v_booking_id;

  select count(*)::integer into v_confirmed_count
  from public.sms_notifications
  where booking_id = v_booking_id and notification_type = 'booking_confirmed';

  if v_confirmed_count < 1 then
    raise exception 'VERIFY FAIL: booking_confirmed SMS not queued';
  end if;

  select count(*)::integer into v_reminder_count
  from public.sms_notifications
  where booking_id = v_booking_id
    and notification_type in ('reminder_24h', 'reminder_2h')
    and status = 'queued';

  if v_reminder_count < 2 then
    raise exception 'VERIFY FAIL: expected reminder_24h and reminder_2h rows, got %', v_reminder_count;
  end if;

  update public.bookings
  set date = '2030-10-16', time = '15:00'
  where id = v_booking_id;

  if not exists (
    select 1 from public.sms_notifications
    where booking_id = v_booking_id and notification_type = 'booking_rescheduled'
  ) then
    raise exception 'VERIFY FAIL: booking_rescheduled SMS not queued';
  end if;

  update public.bookings set status = 'cancelled' where id = v_booking_id;

  if not exists (
    select 1 from public.sms_notifications
    where booking_id = v_booking_id and notification_type = 'booking_cancelled'
  ) then
    raise exception 'VERIFY FAIL: booking_cancelled SMS not queued';
  end if;

  if exists (
    select 1 from public.sms_notifications
    where booking_id = v_booking_id
      and notification_type in ('reminder_24h', 'reminder_2h')
      and status = 'queued'
  ) then
    raise exception 'VERIFY FAIL: queued reminders should be skipped after cancel';
  end if;

  raise notice 'VERIFY PASS: SMS queue lifecycle works';
end;
$$;

do $$
declare
  v_booking_id uuid;
  v_claimed integer;
begin
  select b.id into v_booking_id
  from public.bookings b
  join _sms_ctx c on c.business_id = b.business_id
  where b.client_name = 'Taylor Brooks'
  limit 1;

  update public.sms_notifications
  set scheduled_for = timezone('utc', now()) - interval '1 minute'
  where booking_id = v_booking_id
    and notification_type = 'booking_confirmed'
    and status = 'queued';

  select count(*)::integer into v_claimed
  from public.claim_sms_notifications(5)
  where booking_id = v_booking_id;

  if v_claimed < 1 then
    raise exception 'VERIFY FAIL: claim_sms_notifications returned no rows';
  end if;

  raise notice 'VERIFY PASS: claim_sms_notifications works';
end;
$$;

rollback;
