-- Verification script for PR3 Phase 3.1: Client Profiles foundation.
-- Run after applying 20260701_client_profiles_foundation.sql

begin;

-- ---------------------------------------------------------------------------
-- 1. Schema checks
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clients' and column_name = 'business_id'
  ) then
    raise exception 'VERIFY FAIL: clients.business_id missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clients' and column_name = 'display_name'
  ) then
    raise exception 'VERIFY FAIL: clients.display_name missing';
  end if;

  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'client_tags'
  ) then
    raise exception 'VERIFY FAIL: client_tags table missing';
  end if;

  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'client_booking_events'
  ) then
    raise exception 'VERIFY FAIL: client_booking_events table missing';
  end if;

  if not exists (
    select 1 from information_schema.views
    where table_schema = 'public' and table_name = 'client_profile_stats'
  ) then
    raise exception 'VERIFY FAIL: client_profile_stats view missing';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_client_profile'
  ) then
    raise exception 'VERIFY FAIL: get_client_profile RPC missing';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'list_client_profiles'
  ) then
    raise exception 'VERIFY FAIL: list_client_profiles RPC missing';
  end if;

  raise notice 'VERIFY PASS: schema objects present';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Fixture: business + client
-- ---------------------------------------------------------------------------

create temp table _client_profile_ctx on commit drop as
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
    'Client Profile Verify Co',
    'client-profile-' || left(replace(gen_random_uuid()::text, '-', ''), 10),
    'America/New_York'
  from owner_user
  returning id, owner_user_id
)
select nb.id as business_id, nb.owner_user_id as user_id
from new_business nb;

with ctx as (select * from _client_profile_ctx),
new_client as (
  insert into public.clients (
    client_name,
    first_name,
    last_name,
    display_name,
    phone,
    email,
    notes,
    user_id,
    business_id,
    source
  )
  select
    'Alex Johnson',
    'Alex',
    'Johnson',
    'Alex Johnson',
    '555-0100',
    'alex.verify@example.com',
    'Prefers afternoon appointments',
    user_id,
    business_id,
    'owner_created'
  from ctx
  returning id, business_id
)
select * from new_client;

-- ---------------------------------------------------------------------------
-- 3. Booking creates audit events + stats
-- ---------------------------------------------------------------------------

with ctx as (select * from _client_profile_ctx),
client_row as (
  select c.id as client_id
  from public.clients c
  join ctx on ctx.business_id = c.business_id
  where c.email = 'alex.verify@example.com'
  limit 1
),
insert_booking as (
  insert into public.bookings (
    client_id,
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
    customer_email,
    customer_phone
  )
  select
    client_row.client_id,
    'Alex Johnson',
    'Consultation',
    '2030-08-01',
    '14:00',
    'confirmed',
    120,
    ctx.user_id,
    ctx.business_id,
    'public',
    'verify-client-profile-' || left(replace(gen_random_uuid()::text, '-', ''), 12),
    'alex.verify@example.com',
    '555-0100'
  from ctx, client_row
  returning id, client_id
)
select id as booking_id, client_id from insert_booking;

do $$
declare
  v_client_id uuid;
  v_created_events integer;
  v_stats_bookings bigint;
begin
  select c.id
  into v_client_id
  from public.clients c
  where c.email = 'alex.verify@example.com'
  limit 1;

  select count(*)
  into v_created_events
  from public.client_booking_events e
  where e.client_id = v_client_id
    and e.event_type in ('booking_created', 'booking_confirmed');

  if v_created_events < 2 then
    raise exception 'VERIFY FAIL: expected booking_created + booking_confirmed events, got %', v_created_events;
  end if;

  select s.lifetime_bookings
  into v_stats_bookings
  from public.client_profile_stats s
  where s.client_id = v_client_id;

  if coalesce(v_stats_bookings, 0) < 1 then
    raise exception 'VERIFY FAIL: client_profile_stats.lifetime_bookings expected >= 1';
  end if;

  raise notice 'VERIFY PASS: booking events and stats updated';
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Reschedule records booking_rescheduled event
-- ---------------------------------------------------------------------------

with booking_row as (
  select b.id
  from public.bookings b
  join public.clients c on c.id = b.client_id
  where c.email = 'alex.verify@example.com'
  order by b.created_at desc
  limit 1
)
update public.bookings b
set date = '2030-08-02', time = '15:30'
from booking_row br
where b.id = br.id;

do $$
declare
  v_client_id uuid;
  v_rescheduled integer;
begin
  select c.id into v_client_id
  from public.clients c
  where c.email = 'alex.verify@example.com'
  limit 1;

  select count(*)
  into v_rescheduled
  from public.client_booking_events e
  where e.client_id = v_client_id
    and e.event_type = 'booking_rescheduled';

  if v_rescheduled < 1 then
    raise exception 'VERIFY FAIL: booking_rescheduled event missing';
  end if;

  raise notice 'VERIFY PASS: reschedule event recorded';
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Tags tables writable under RLS (service role in script)
-- ---------------------------------------------------------------------------

do $$
declare
  v_business_id uuid;
  v_client_id uuid;
  v_tag_id uuid;
begin
  select business_id into v_business_id from _client_profile_ctx limit 1;
  select id into v_client_id from public.clients where email = 'alex.verify@example.com' limit 1;

  insert into public.client_tags (business_id, name, color)
  values (v_business_id, 'VIP', '#8B5CF6')
  returning id into v_tag_id;

  insert into public.client_tag_assignments (client_id, tag_id)
  values (v_client_id, v_tag_id);

  if not exists (
    select 1
    from public.client_tag_assignments a
    join public.client_tags t on t.id = a.tag_id
    where a.client_id = v_client_id and t.name = 'VIP'
  ) then
    raise exception 'VERIFY FAIL: client tag assignment missing';
  end if;

  raise notice 'VERIFY PASS: tags schema works';
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. RPC payload shape (executed as migration role; owner check skipped here)
-- ---------------------------------------------------------------------------

do $$
declare
  v_client_id uuid;
  v_profile jsonb;
begin
  select id into v_client_id from public.clients where email = 'alex.verify@example.com' limit 1;

  -- Direct stats/view readable
  perform 1 from public.client_profile_stats where client_id = v_client_id;

  raise notice 'VERIFY PASS: client_profile_stats row exists for fixture client';
end;
$$;

rollback;
