-- Verification script for Google Calendar sync worker (PR3).
-- Run against a dev/staging database after applying 20260629_google_calendar_sync_worker.sql.
-- Does not call Google APIs.

begin;

-- ---------------------------------------------------------------------------
-- 1. Schema checks
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'claim_calendar_sync_jobs'
  ) then
    raise exception 'VERIFY FAIL: claim_calendar_sync_jobs function missing';
  end if;

  raise notice 'VERIFY PASS: claim_calendar_sync_jobs function present';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Fixture: business + active Google connection
-- ---------------------------------------------------------------------------

create temp table _gcal_worker_ctx on commit drop as
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
    'GCal Worker Verify Salon',
    'gcal-worker-' || left(replace(gen_random_uuid()::text, '-', ''), 10),
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
  'worker-verify@salo.test',
  'worker-verify-calendar-id',
  'stub-refresh-token-for-worker-verify',
  true,
  timezone('utc', now())
from _gcal_worker_ctx
on conflict (business_id) do update
set
  google_account_email = excluded.google_account_email,
  calendar_id = excluded.calendar_id,
  refresh_token_encrypted = excluded.refresh_token_encrypted,
  sync_enabled = true,
  disconnected_at = null,
  connected_at = excluded.connected_at;

-- ---------------------------------------------------------------------------
-- 3. Enqueue a pending create job
-- ---------------------------------------------------------------------------

with ctx as (select * from _gcal_worker_ctx),
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
    booking_token,
    booking_metadata
  )
  select
    'Worker Verify Client',
    'Haircut',
    '2030-07-01',
    '10:00',
    'confirmed',
    50,
    user_id,
    business_id,
    'owner',
    'worker-verify-' || left(replace(gen_random_uuid()::text, '-', ''), 12),
    jsonb_build_object('service_duration_minutes', 45)
  from ctx
  returning id, business_id
),
latest_job as (
  select csj.id
  from public.calendar_sync_jobs csj
  join insert_booking ib on ib.id = csj.booking_id
  where csj.operation = 'create'
    and csj.status = 'pending'
  order by csj.queued_at desc
  limit 1
)
select
  ib.id as booking_id,
  lj.id as job_id
from insert_booking ib
cross join latest_job lj;

do $$
declare
  v_count integer;
begin
  select count(*)
  into v_count
  from public.calendar_sync_jobs csj
  where csj.operation = 'create'
    and csj.status = 'pending'
    and csj.metadata ->> 'client_name' = 'Worker Verify Client';

  if v_count < 1 then
    raise exception 'VERIFY FAIL: confirmed booking did not enqueue create job';
  end if;

  raise notice 'VERIFY PASS: pending create job enqueued (count=%)', v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. claim_calendar_sync_jobs marks job as processing
-- ---------------------------------------------------------------------------

do $$
declare
  v_claimed_count integer;
  v_processing_count integer;
begin
  select count(*)
  into v_claimed_count
  from public.claim_calendar_sync_jobs(5);

  select count(*)
  into v_processing_count
  from public.calendar_sync_jobs csj
  where csj.metadata ->> 'client_name' = 'Worker Verify Client'
    and csj.status = 'processing';

  if v_claimed_count < 1 then
    raise exception 'VERIFY FAIL: claim_calendar_sync_jobs returned 0 rows';
  end if;

  if v_processing_count < 1 then
    raise exception 'VERIFY FAIL: claimed job was not marked processing';
  end if;

  raise notice 'VERIFY PASS: claim_calendar_sync_jobs claimed % job(s)', v_claimed_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Reset claimed job back to pending for rollback cleanliness
-- ---------------------------------------------------------------------------

update public.calendar_sync_jobs csj
set status = 'pending'
where csj.metadata ->> 'client_name' = 'Worker Verify Client'
  and csj.status = 'processing';

rollback;
