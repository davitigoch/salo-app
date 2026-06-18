-- Verification script for Google Calendar foundation (PR1).
-- Run against a dev/staging database after applying 20260627_google_calendar_foundation.sql.
-- Does not call Google APIs.

begin;

-- ---------------------------------------------------------------------------
-- 1. Schema checks
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'google_calendar_connections'
  ) then
    raise exception 'VERIFY FAIL: google_calendar_connections table missing';
  end if;

  if not exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'calendar_sync_jobs'
  ) then
    raise exception 'VERIFY FAIL: calendar_sync_jobs table missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'bookings'
      and column_name = 'google_calendar_event_id'
  ) then
    raise exception 'VERIFY FAIL: bookings.google_calendar_event_id missing';
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'enqueue_calendar_sync_job'
  ) then
    raise exception 'VERIFY FAIL: enqueue_calendar_sync_job function missing';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    where c.relname = 'bookings'
      and t.tgname = 'on_booking_calendar_sync_enqueue'
      and not t.tgisinternal
  ) then
    raise exception 'VERIFY FAIL: on_booking_calendar_sync_enqueue trigger missing';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    where c.relname = 'bookings'
      and t.tgname = 'on_booking_calendar_sync_delete_enqueue'
      and not t.tgisinternal
  ) then
    raise exception 'VERIFY FAIL: on_booking_calendar_sync_delete_enqueue trigger missing';
  end if;

  raise notice 'VERIFY PASS: schema objects present';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Fixture: business + active Google connection (stub token for enqueue tests)
-- ---------------------------------------------------------------------------

create temp table _gcal_verify_ctx on commit drop as
with owner_user as (
  select id
  from auth.users
  order by created_at asc
  limit 1
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
    'GCal Verify Salon',
    'gcal-verify-' || left(replace(gen_random_uuid()::text, '-', ''), 10),
    'America/New_York'
  from owner_user
  returning id, owner_user_id
)
select
  nb.id as business_id,
  nb.owner_user_id as user_id
from new_business nb;

insert into public.google_calendar_connections (
  business_id,
  google_account_email,
  calendar_id,
  refresh_token_encrypted,
  sync_enabled,
  connected_at
)
select
  business_id,
  'verify@salo.test',
  'primary',
  'stub-refresh-token-for-verify-only',
  true,
  timezone('utc', now())
from _gcal_verify_ctx
on conflict (business_id) do update
set
  google_account_email = excluded.google_account_email,
  calendar_id = excluded.calendar_id,
  refresh_token_encrypted = excluded.refresh_token_encrypted,
  sync_enabled = true,
  disconnected_at = null,
  connected_at = excluded.connected_at;

-- ---------------------------------------------------------------------------
-- 3. Confirmed insert enqueues create job
-- ---------------------------------------------------------------------------

with ctx as (select * from _gcal_verify_ctx),
insert_booking as (
  insert into public.bookings (
    client_name,
    service,
    date,
    time,
    status,
    price,
    user_id,
    business_id,
    booking_source,
    booking_token
  )
  select
    'Verify Client',
    'Haircut',
    '2030-06-01',
    '10:00',
    'confirmed',
    50,
    user_id,
    business_id,
    'owner',
    'verify-confirmed-' || left(replace(gen_random_uuid()::text, '-', ''), 12)
  from ctx
  returning id, business_id
)
select
  ib.id as booking_id,
  (
    select count(*)
    from public.calendar_sync_jobs csj
    where csj.booking_id = ib.id
      and csj.operation = 'create'
      and csj.event_type = 'booking_confirmed'
      and csj.status = 'pending'
  ) as create_jobs
from insert_booking ib;

do $$
declare
  v_count integer;
begin
  select count(*)
  into v_count
  from public.calendar_sync_jobs csj
  where csj.event_type = 'booking_confirmed'
    and csj.operation = 'create'
    and csj.status = 'pending'
    and csj.metadata ->> 'client_name' = 'Verify Client';

  if v_count < 1 then
    raise exception 'VERIFY FAIL: confirmed insert did not enqueue create job';
  end if;

  raise notice 'VERIFY PASS: confirmed insert enqueued create job (count=%)', v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Pending insert does NOT enqueue
-- ---------------------------------------------------------------------------

with ctx as (select * from _gcal_verify_ctx),
insert_pending as (
  insert into public.bookings (
    client_name,
    service,
    date,
    time,
    status,
    price,
    user_id,
    business_id,
    booking_source,
    booking_token
  )
  select
    'Pending Client',
    'Color',
    '2030-06-02',
    '11:00',
    'pending',
    80,
    user_id,
    business_id,
    'public',
    'verify-pending-' || left(replace(gen_random_uuid()::text, '-', ''), 12)
  from ctx
  returning id
)
select id as pending_booking_id from insert_pending;

do $$
declare
  v_count integer;
begin
  select count(*)
  into v_count
  from public.calendar_sync_jobs csj
  where csj.metadata ->> 'client_name' = 'Pending Client';

  if v_count <> 0 then
    raise exception 'VERIFY FAIL: pending insert enqueued % job(s), expected 0', v_count;
  end if;

  raise notice 'VERIFY PASS: pending insert did not enqueue jobs';
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Pending -> confirmed enqueues create job
-- ---------------------------------------------------------------------------

with pending_booking as (
  select b.id, b.business_id
  from public.bookings b
  where b.client_name = 'Pending Client'
  order by b.created_at desc
  limit 1
)
update public.bookings b
set status = 'confirmed'
from pending_booking pb
where b.id = pb.id;

do $$
declare
  v_count integer;
begin
  select count(*)
  into v_count
  from public.calendar_sync_jobs csj
  join public.bookings b on b.id = csj.booking_id
  where b.client_name = 'Pending Client'
    and csj.operation = 'create'
    and csj.event_type = 'booking_confirmed'
    and csj.status = 'pending';

  if v_count < 1 then
    raise exception 'VERIFY FAIL: pending -> confirmed did not enqueue create job';
  end if;

  raise notice 'VERIFY PASS: pending -> confirmed enqueued create job';
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Reschedule enqueues update job
-- ---------------------------------------------------------------------------

with confirmed_booking as (
  select b.id
  from public.bookings b
  where b.client_name = 'Verify Client'
  order by b.created_at desc
  limit 1
)
update public.bookings b
set
  date = '2030-06-03',
  time = '14:30'
from confirmed_booking cb
where b.id = cb.id;

do $$
declare
  v_count integer;
begin
  select count(*)
  into v_count
  from public.calendar_sync_jobs csj
  join public.bookings b on b.id = csj.booking_id
  where b.client_name = 'Verify Client'
    and csj.operation = 'update'
    and csj.event_type = 'booking_rescheduled'
    and csj.status = 'pending';

  if v_count < 1 then
    raise exception 'VERIFY FAIL: reschedule did not enqueue update job';
  end if;

  raise notice 'VERIFY PASS: reschedule enqueued update job';
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Cancel enqueues delete job
-- ---------------------------------------------------------------------------

with confirmed_booking as (
  select b.id
  from public.bookings b
  where b.client_name = 'Verify Client'
  order by b.created_at desc
  limit 1
)
update public.bookings b
set status = 'cancelled'
from confirmed_booking cb
where b.id = cb.id;

do $$
declare
  v_count integer;
begin
  select count(*)
  into v_count
  from public.calendar_sync_jobs csj
  join public.bookings b on b.id = csj.booking_id
  where b.client_name = 'Verify Client'
    and csj.operation = 'delete'
    and csj.event_type = 'booking_cancelled'
    and csj.status = 'pending';

  if v_count < 1 then
    raise exception 'VERIFY FAIL: cancel did not enqueue delete job';
  end if;

  raise notice 'VERIFY PASS: cancel enqueued delete job';
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Hard delete with google_calendar_event_id enqueues booking_deleted
--    (must be separate statements so BEFORE DELETE trigger fires)
-- ---------------------------------------------------------------------------

create temp table _gcal_delete_target (
  booking_id uuid primary key
) on commit drop;

with ctx as (select * from _gcal_verify_ctx),
inserted_booking as (
  insert into public.bookings (
    client_name,
    service,
    date,
    time,
    status,
    price,
    user_id,
    business_id,
    booking_source,
    booking_token,
    google_calendar_event_id
  )
  select
    'Delete Me Client',
    'Blowout',
    '2030-06-04',
    '09:00',
    'confirmed',
    40,
    user_id,
    business_id,
    'owner',
    'verify-delete-' || left(replace(gen_random_uuid()::text, '-', ''), 12),
    'stub-google-event-id-123'
  from ctx
  returning id
)
insert into _gcal_delete_target (booking_id)
select id
from inserted_booking;

delete from public.bookings b
using _gcal_delete_target d
where b.id = d.booking_id;

do $$
declare
  v_count integer;
begin
  select count(*)
  into v_count
  from public.calendar_sync_jobs csj
  where csj.event_type = 'booking_deleted'
    and csj.operation = 'delete'
    and csj.metadata ->> 'google_calendar_event_id' = 'stub-google-event-id-123'
    and csj.status = 'pending';

  if v_count < 1 then
    raise exception 'VERIFY FAIL: hard delete did not enqueue booking_deleted job';
  end if;

  raise notice 'VERIFY PASS: hard delete enqueued booking_deleted job';
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. No connection => no enqueue
-- ---------------------------------------------------------------------------

update public.google_calendar_connections gcc
set
  sync_enabled = false,
  disconnected_at = timezone('utc', now())
from _gcal_verify_ctx ctx
where gcc.business_id = ctx.business_id;

with ctx as (select * from _gcal_verify_ctx),
insert_no_conn as (
  insert into public.bookings (
    client_name,
    service,
    date,
    time,
    status,
    price,
    user_id,
    business_id,
    booking_source,
    booking_token
  )
  select
    'No Connection Client',
    'Trim',
    '2030-06-05',
    '12:00',
    'confirmed',
    30,
    user_id,
    business_id,
    'owner',
    'verify-noconn-' || left(replace(gen_random_uuid()::text, '-', ''), 12)
  from ctx
  returning id
)
select id from insert_no_conn;

do $$
declare
  v_count integer;
begin
  select count(*)
  into v_count
  from public.calendar_sync_jobs csj
  where csj.metadata ->> 'client_name' = 'No Connection Client';

  if v_count <> 0 then
    raise exception 'VERIFY FAIL: disconnected business enqueued % job(s), expected 0', v_count;
  end if;

  raise notice 'VERIFY PASS: inactive connection did not enqueue jobs';
end;
$$;

rollback;
