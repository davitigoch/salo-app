-- PR3 Phase 3.1: Client Profiles database foundation.
-- Schema, backfill, booking event audit, stats view/RPCs, RLS. No app UI changes.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.normalize_client_phone(p_phone text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');
$$;

create or replace function public.parse_booking_local_timestamp(
  p_timezone text,
  p_date text,
  p_time text
)
returns timestamptz
language plpgsql
stable
set search_path = public
as $$
declare
  v_tz text;
  v_date date;
  v_hour integer;
  v_minute integer;
  v_match text[];
  v_time text;
begin
  if p_date is null or length(trim(p_date)) = 0 then
    return null;
  end if;

  begin
    v_date := p_date::date;
  exception
    when others then
      return null;
  end;

  v_tz := coalesce(nullif(trim(p_timezone), ''), 'UTC');
  v_time := lower(trim(coalesce(p_time, '')));

  if v_time ~ '^\d{1,2}:\d{2}$' then
    v_match := regexp_match(v_time, '^(\d{1,2}):(\d{2})$');
    v_hour := v_match[1]::integer;
    v_minute := v_match[2]::integer;
  elsif v_time ~ '^\d{1,2}:\d{2}\s*(am|pm)$' then
    v_match := regexp_match(v_time, '^(\d{1,2}):(\d{2})\s*(am|pm)$');
    v_hour := v_match[1]::integer;
    v_minute := v_match[2]::integer;

    if v_match[3] = 'pm' and v_hour < 12 then
      v_hour := v_hour + 12;
    elsif v_match[3] = 'am' and v_hour = 12 then
      v_hour := 0;
    end if;
  else
    return null;
  end if;

  if v_hour < 0 or v_hour > 23 or v_minute < 0 or v_minute > 59 then
    return null;
  end if;

  return make_timestamptz(
    extract(year from v_date)::integer,
    extract(month from v_date)::integer,
    extract(day from v_date)::integer,
    v_hour,
    v_minute,
    0,
    v_tz
  );
end;
$$;

create or replace function public.map_booking_source_to_client_source(p_booking_source text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when coalesce(p_booking_source, 'owner') = 'public' then 'public_booking'
    else 'owner_created'
  end;
$$;

-- ---------------------------------------------------------------------------
-- clients: new columns
-- ---------------------------------------------------------------------------

alter table public.clients
  add column if not exists business_id uuid references public.businesses(id) on delete cascade,
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists display_name text,
  add column if not exists phone_normalized text,
  add column if not exists preferred_staff_member_id uuid references public.staff_members(id) on delete set null,
  add column if not exists source text,
  add column if not exists source_detail text,
  add column if not exists profile_metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

alter table public.clients
  alter column profile_metadata set default '{}'::jsonb;

update public.clients
set source = 'owner_created'
where source is null;

alter table public.clients
  alter column source set default 'owner_created';

alter table public.clients
  drop constraint if exists clients_source_check;

alter table public.clients
  add constraint clients_source_check
  check (source in ('public_booking', 'owner_created', 'import', 'referral', 'unknown'));

-- ---------------------------------------------------------------------------
-- Backfill: business_id
-- ---------------------------------------------------------------------------

with booking_business_counts as (
  select
    b.client_id,
    b.business_id,
    count(*) as booking_count,
    row_number() over (
      partition by b.client_id
      order by count(*) desc, max(b.created_at) desc
    ) as business_rank
  from public.bookings b
  where b.client_id is not null
    and b.business_id is not null
  group by b.client_id, b.business_id
)
update public.clients c
set business_id = bbc.business_id
from booking_business_counts bbc
where c.id = bbc.client_id
  and bbc.business_rank = 1
  and c.business_id is null;

with owner_primary_business as (
  select distinct on (owner_user_id)
    id,
    owner_user_id
  from public.businesses
  order by owner_user_id, created_at asc
)
update public.clients c
set business_id = opb.id
from owner_primary_business opb
where c.business_id is null
  and c.user_id = opb.owner_user_id;

-- ---------------------------------------------------------------------------
-- Backfill: names + phone normalization
-- ---------------------------------------------------------------------------

update public.clients
set
  first_name = case
    when position(' ' in trim(client_name)) > 0 then split_part(trim(client_name), ' ', 1)
    else trim(client_name)
  end,
  last_name = case
    when position(' ' in trim(client_name)) > 0 then trim(substring(trim(client_name) from position(' ' in trim(client_name)) + 1))
    else null
  end
where coalesce(trim(first_name), '') = '';

update public.clients
set display_name = trim(
  coalesce(nullif(trim(first_name), ''), trim(client_name))
  || case
    when coalesce(trim(last_name), '') <> '' then ' ' || trim(last_name)
    else ''
  end
)
where coalesce(trim(display_name), '') = '';

update public.clients
set client_name = display_name
where coalesce(trim(client_name), '') = ''
  and coalesce(trim(display_name), '') <> '';

update public.clients
set phone_normalized = public.normalize_client_phone(phone)
where phone_normalized is distinct from public.normalize_client_phone(phone);

-- ---------------------------------------------------------------------------
-- Backfill: source from linked bookings
-- ---------------------------------------------------------------------------

update public.clients c
set source = 'public_booking'
where c.source = 'owner_created'
  and exists (
    select 1
    from public.bookings b
    where b.client_id = c.id
      and coalesce(b.booking_source, 'owner') = 'public'
  );

-- ---------------------------------------------------------------------------
-- Backfill: preferred staff from most frequent booking staff_member_id
-- ---------------------------------------------------------------------------

with staff_counts as (
  select
    b.client_id,
    b.staff_member_id,
    count(*) as booking_count,
    row_number() over (
      partition by b.client_id
      order by count(*) desc, max(b.created_at) desc
    ) as staff_rank
  from public.bookings b
  where b.client_id is not null
    and b.staff_member_id is not null
  group by b.client_id, b.staff_member_id
)
update public.clients c
set preferred_staff_member_id = sc.staff_member_id
from staff_counts sc
where c.id = sc.client_id
  and sc.staff_rank = 1
  and c.preferred_staff_member_id is null;

-- ---------------------------------------------------------------------------
-- Re-link bookings to business-scoped clients (email / phone / name)
-- ---------------------------------------------------------------------------

update public.bookings b
set client_id = c.id
from public.clients c
where b.client_id is null
  and b.business_id = c.business_id
  and b.customer_email is not null
  and length(trim(b.customer_email)) > 0
  and lower(trim(b.customer_email)) = lower(trim(c.email));

update public.bookings b
set client_id = c.id
from public.clients c
where b.client_id is null
  and b.business_id = c.business_id
  and b.customer_phone is not null
  and c.phone_normalized is not null
  and public.normalize_client_phone(b.customer_phone) = c.phone_normalized;

update public.bookings b
set client_id = c.id
from public.clients c
where b.client_id is null
  and b.business_id = c.business_id
  and lower(trim(b.client_name)) = lower(trim(c.display_name));

-- ---------------------------------------------------------------------------
-- Dedupe contact fields before unique indexes
-- ---------------------------------------------------------------------------

with ranked_emails as (
  select
    id,
    row_number() over (
      partition by business_id, lower(trim(email))
      order by created_at asc, id asc
    ) as row_num
  from public.clients
  where business_id is not null
    and email is not null
    and length(trim(email)) > 0
)
update public.clients c
set email = null
from ranked_emails re
where c.id = re.id
  and re.row_num > 1;

with ranked_phones as (
  select
    id,
    row_number() over (
      partition by business_id, phone_normalized
      order by created_at asc, id asc
    ) as row_num
  from public.clients
  where business_id is not null
    and phone_normalized is not null
)
update public.clients c
set
  phone = null,
  phone_normalized = null
from ranked_phones rp
where c.id = rp.id
  and rp.row_num > 1;

-- ---------------------------------------------------------------------------
-- Enforce business_id + sync legacy client_name
-- ---------------------------------------------------------------------------

do $$
declare
  v_missing_business_count integer;
begin
  select count(*)
  into v_missing_business_count
  from public.clients
  where business_id is null;

  if v_missing_business_count > 0 then
    raise exception 'Client profile migration blocked: % client(s) missing business_id', v_missing_business_count;
  end if;
end;
$$;

alter table public.clients
  alter column business_id set not null;

alter table public.clients
  alter column first_name set not null;

alter table public.clients
  alter column display_name set not null;

create index if not exists clients_business_id_idx on public.clients (business_id);
create index if not exists clients_business_display_name_idx on public.clients (business_id, display_name);
create index if not exists clients_business_email_idx on public.clients (business_id, lower(email));
create index if not exists clients_business_phone_normalized_idx on public.clients (business_id, phone_normalized);

create unique index if not exists clients_business_email_unique_idx
  on public.clients (business_id, lower(trim(email)))
  where email is not null and length(trim(email)) > 0;

create unique index if not exists clients_business_phone_unique_idx
  on public.clients (business_id, phone_normalized)
  where phone_normalized is not null;

-- ---------------------------------------------------------------------------
-- client_tags + assignments
-- ---------------------------------------------------------------------------

create table if not exists public.client_tags (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  color text,
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists client_tags_business_name_unique_idx
  on public.client_tags (business_id, lower(trim(name)));

create index if not exists client_tags_business_id_idx on public.client_tags (business_id);

create table if not exists public.client_tag_assignments (
  client_id uuid not null references public.clients(id) on delete cascade,
  tag_id uuid not null references public.client_tags(id) on delete cascade,
  assigned_at timestamptz not null default timezone('utc', now()),
  primary key (client_id, tag_id)
);

create index if not exists client_tag_assignments_tag_id_idx on public.client_tag_assignments (tag_id);

-- ---------------------------------------------------------------------------
-- client_booking_events (audit log)
-- ---------------------------------------------------------------------------

create table if not exists public.client_booking_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  booking_id uuid references public.bookings(id) on delete set null,
  event_type text not null check (event_type in (
    'booking_created',
    'booking_confirmed',
    'booking_rescheduled',
    'booking_cancelled',
    'booking_completed',
    'booking_no_show'
  )),
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists client_booking_events_client_id_idx
  on public.client_booking_events (client_id, occurred_at desc);

create index if not exists client_booking_events_booking_id_idx
  on public.client_booking_events (booking_id, occurred_at desc);

create index if not exists client_booking_events_business_id_idx
  on public.client_booking_events (business_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Future-proof stubs (no UI in PR3)
-- ---------------------------------------------------------------------------

create table if not exists public.client_segments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  rule_definition jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists client_segments_business_name_unique_idx
  on public.client_segments (business_id, lower(trim(name)));

create table if not exists public.client_loyalty_accounts (
  client_id uuid primary key references public.clients(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  points_balance integer not null default 0,
  tier text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists client_loyalty_accounts_business_id_idx
  on public.client_loyalty_accounts (business_id);

-- ---------------------------------------------------------------------------
-- Client maintainers
-- ---------------------------------------------------------------------------

create or replace function public.ensure_client_business_id()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.business_id is not null then
    return new;
  end if;

  if new.user_id is null then
    raise exception 'clients.user_id is required when business_id is missing';
  end if;

  select b.id
  into new.business_id
  from public.businesses b
  where b.owner_user_id = new.user_id
  order by b.created_at asc
  limit 1;

  if new.business_id is null then
    raise exception 'No business found for client user %', new.user_id;
  end if;

  return new;
end;
$$;

create or replace function public.sync_client_identity_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.phone_normalized := public.normalize_client_phone(new.phone);

  if coalesce(trim(new.first_name), '') = '' and coalesce(trim(new.client_name), '') <> '' then
    new.first_name := case
      when position(' ' in trim(new.client_name)) > 0 then split_part(trim(new.client_name), ' ', 1)
      else trim(new.client_name)
    end;
    new.last_name := case
      when position(' ' in trim(new.client_name)) > 0 then trim(substring(trim(new.client_name) from position(' ' in trim(new.client_name)) + 1))
      else null
    end;
  end if;

  if coalesce(trim(new.display_name), '') = '' then
    new.display_name := trim(
      coalesce(nullif(trim(new.first_name), ''), nullif(trim(new.client_name), ''), 'Client')
      || case
        when coalesce(trim(new.last_name), '') <> '' then ' ' || trim(new.last_name)
        else ''
      end
    );
  end if;

  if coalesce(trim(new.client_name), '') = '' then
    new.client_name := new.display_name;
  end if;

  if new.preferred_staff_member_id is not null then
    if not exists (
      select 1
      from public.staff_members sm
      where sm.id = new.preferred_staff_member_id
        and sm.business_id = new.business_id
    ) then
      raise exception 'preferred_staff_member_id must belong to the same business as the client';
    end if;
  end if;

  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists on_client_ensure_business_id on public.clients;
create trigger on_client_ensure_business_id
before insert on public.clients
for each row
execute function public.ensure_client_business_id();

drop trigger if exists on_client_sync_identity_fields on public.clients;
create trigger on_client_sync_identity_fields
before insert or update on public.clients
for each row
execute function public.sync_client_identity_fields();

-- ---------------------------------------------------------------------------
-- Booking event recorder
-- ---------------------------------------------------------------------------

create or replace function public.record_client_booking_event(
  p_business_id uuid,
  p_client_id uuid,
  p_booking_id uuid,
  p_event_type text,
  p_payload jsonb default '{}'::jsonb,
  p_occurred_at timestamptz default timezone('utc', now())
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_business_id is null or p_event_type is null then
    return;
  end if;

  insert into public.client_booking_events (
    business_id,
    client_id,
    booking_id,
    event_type,
    payload,
    occurred_at
  ) values (
    p_business_id,
    p_client_id,
    p_booking_id,
    p_event_type,
    coalesce(p_payload, '{}'::jsonb),
    coalesce(p_occurred_at, timezone('utc', now()))
  );
end;
$$;

create or replace function public.record_client_booking_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_business_id uuid;
begin
  v_client_id := coalesce(new.client_id, old.client_id);
  v_business_id := coalesce(new.business_id, old.business_id);

  if v_business_id is null then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    if v_client_id is not null then
      perform public.record_client_booking_event(
        v_business_id,
        v_client_id,
        new.id,
        'booking_created',
        jsonb_build_object(
          'status', new.status,
          'date', new.date,
          'time', new.time,
          'service', new.service,
          'booking_source', coalesce(new.booking_source, 'owner')
        ),
        coalesce(new.created_at, timezone('utc', now()))
      );

      if new.status = 'confirmed' then
        perform public.record_client_booking_event(
          v_business_id,
          v_client_id,
          new.id,
          'booking_confirmed',
          jsonb_build_object(
            'status', new.status,
            'date', new.date,
            'time', new.time,
            'booking_source', coalesce(new.booking_source, 'owner')
          ),
          coalesce(new.created_at, timezone('utc', now()))
        );
      end if;
    end if;

    return new;
  end if;

  if tg_op = 'UPDATE' then
    v_client_id := coalesce(new.client_id, old.client_id);

    if v_client_id is null then
      return new;
    end if;

    if old.status is distinct from new.status then
      if new.status = 'confirmed' then
        perform public.record_client_booking_event(
          v_business_id,
          v_client_id,
          new.id,
          'booking_confirmed',
          jsonb_build_object(
            'old_status', old.status,
            'status', new.status,
            'date', new.date,
            'time', new.time,
            'booking_source', coalesce(new.booking_source, 'owner')
          )
        );
      elsif new.status = 'cancelled' then
        perform public.record_client_booking_event(
          v_business_id,
          v_client_id,
          new.id,
          'booking_cancelled',
          jsonb_build_object(
            'old_status', old.status,
            'status', new.status,
            'date', new.date,
            'time', new.time
          )
        );
      elsif new.status = 'completed' then
        perform public.record_client_booking_event(
          v_business_id,
          v_client_id,
          new.id,
          'booking_completed',
          jsonb_build_object(
            'old_status', old.status,
            'status', new.status,
            'date', new.date,
            'time', new.time
          )
        );
      elsif new.status = 'no_show' then
        perform public.record_client_booking_event(
          v_business_id,
          v_client_id,
          new.id,
          'booking_no_show',
          jsonb_build_object(
            'old_status', old.status,
            'status', new.status,
            'date', new.date,
            'time', new.time
          )
        );
      end if;
    end if;

    if new.status = 'confirmed'
      and old.status = 'confirmed'
      and (old.date is distinct from new.date or old.time is distinct from new.time) then
      perform public.record_client_booking_event(
        v_business_id,
        v_client_id,
        new.id,
        'booking_rescheduled',
        jsonb_build_object(
          'old_date', old.date,
          'old_time', old.time,
          'new_date', new.date,
          'new_time', new.time,
          'booking_source', coalesce(new.booking_source, 'owner')
        )
      );
    end if;

    return new;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists on_booking_client_profile_events on public.bookings;
create trigger on_booking_client_profile_events
after insert or update on public.bookings
for each row
execute function public.record_client_booking_events();

-- Backfill baseline booking events for existing linked bookings.
insert into public.client_booking_events (
  business_id,
  client_id,
  booking_id,
  event_type,
  payload,
  occurred_at
)
select
  b.business_id,
  b.client_id,
  b.id,
  'booking_created',
  jsonb_build_object(
    'status', b.status,
    'date', b.date,
    'time', b.time,
    'service', b.service,
    'booking_source', coalesce(b.booking_source, 'owner'),
    'backfilled', true
  ),
  coalesce(b.created_at, timezone('utc', now()))
from public.bookings b
where b.client_id is not null
  and b.business_id is not null
  and not exists (
    select 1
    from public.client_booking_events cbe
    where cbe.booking_id = b.id
      and cbe.event_type = 'booking_created'
  );

insert into public.client_booking_events (
  business_id,
  client_id,
  booking_id,
  event_type,
  payload,
  occurred_at
)
select
  b.business_id,
  b.client_id,
  b.id,
  'booking_confirmed',
  jsonb_build_object(
    'status', b.status,
    'date', b.date,
    'time', b.time,
    'booking_source', coalesce(b.booking_source, 'owner'),
    'backfilled', true
  ),
  coalesce(b.created_at, timezone('utc', now()))
from public.bookings b
where b.client_id is not null
  and b.business_id is not null
  and b.status = 'confirmed'
  and not exists (
    select 1
    from public.client_booking_events cbe
    where cbe.booking_id = b.id
      and cbe.event_type = 'booking_confirmed'
  );

-- ---------------------------------------------------------------------------
-- Stats view
-- ---------------------------------------------------------------------------

create or replace view public.client_profile_stats
with (security_invoker = true)
as
with booking_metrics as (
  select
    b.client_id,
    b.business_id,
    count(*) filter (where b.status in ('pending', 'confirmed', 'completed')) as lifetime_bookings,
    count(*) filter (where b.status = 'cancelled') as cancellation_count,
    count(*) filter (where b.status = 'no_show') as no_show_count,
    count(*) filter (where b.status = 'completed') as completed_visit_count,
    coalesce(sum(b.price) filter (where b.status in ('confirmed', 'completed')), 0)::numeric(12, 2) as lifetime_revenue
  from public.bookings b
  where b.client_id is not null
  group by b.client_id, b.business_id
),
event_metrics as (
  select
    cbe.client_id,
    count(*) filter (where cbe.event_type = 'booking_rescheduled') as rescheduled_count
  from public.client_booking_events cbe
  group by cbe.client_id
),
appointment_bounds as (
  select
    c.id as client_id,
    c.business_id,
    (
      select b.id
      from public.bookings b
      join public.businesses bs on bs.id = b.business_id
      where b.client_id = c.id
        and b.business_id = c.business_id
        and b.status in ('confirmed', 'completed')
        and public.parse_booking_local_timestamp(bs.timezone, b.date, b.time) < timezone('utc', now())
      order by public.parse_booking_local_timestamp(bs.timezone, b.date, b.time) desc nulls last
      limit 1
    ) as last_visit_booking_id,
    (
      select public.parse_booking_local_timestamp(bs.timezone, b.date, b.time)
      from public.bookings b
      join public.businesses bs on bs.id = b.business_id
      where b.client_id = c.id
        and b.business_id = c.business_id
        and b.status in ('confirmed', 'completed')
        and public.parse_booking_local_timestamp(bs.timezone, b.date, b.time) < timezone('utc', now())
      order by public.parse_booking_local_timestamp(bs.timezone, b.date, b.time) desc nulls last
      limit 1
    ) as last_visit_at,
    (
      select b.id
      from public.bookings b
      join public.businesses bs on bs.id = b.business_id
      where b.client_id = c.id
        and b.business_id = c.business_id
        and b.status in ('pending', 'confirmed')
        and public.parse_booking_local_timestamp(bs.timezone, b.date, b.time) >= timezone('utc', now())
      order by public.parse_booking_local_timestamp(bs.timezone, b.date, b.time) asc nulls last
      limit 1
    ) as next_appointment_booking_id,
    (
      select public.parse_booking_local_timestamp(bs.timezone, b.date, b.time)
      from public.bookings b
      join public.businesses bs on bs.id = b.business_id
      where b.client_id = c.id
        and b.business_id = c.business_id
        and b.status in ('pending', 'confirmed')
        and public.parse_booking_local_timestamp(bs.timezone, b.date, b.time) >= timezone('utc', now())
      order by public.parse_booking_local_timestamp(bs.timezone, b.date, b.time) asc nulls last
      limit 1
    ) as next_appointment_at
  from public.clients c
)
select
  c.id as client_id,
  c.business_id,
  coalesce(bm.lifetime_bookings, 0) as lifetime_bookings,
  coalesce(bm.cancellation_count, 0) as cancellation_count,
  coalesce(bm.no_show_count, 0) as no_show_count,
  coalesce(bm.completed_visit_count, 0) as completed_visit_count,
  coalesce(bm.lifetime_revenue, 0)::numeric(12, 2) as lifetime_revenue,
  case
    when coalesce(bm.completed_visit_count, 0) > 0 then
      round(coalesce(bm.lifetime_revenue, 0) / bm.completed_visit_count, 2)
    else 0::numeric(12, 2)
  end as average_spend,
  coalesce(em.rescheduled_count, 0) as rescheduled_count,
  ab.last_visit_booking_id,
  ab.last_visit_at,
  ab.next_appointment_booking_id,
  ab.next_appointment_at
from public.clients c
left join booking_metrics bm
  on bm.client_id = c.id
 and bm.business_id = c.business_id
left join event_metrics em
  on em.client_id = c.id
left join appointment_bounds ab
  on ab.client_id = c.id
 and ab.business_id = c.business_id;

grant select on public.client_profile_stats to authenticated;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

create or replace function public._assert_business_owner(p_business_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_business_id is null then
    raise exception 'business_id is required';
  end if;

  if not exists (
    select 1
    from public.businesses b
    where b.id = p_business_id
      and b.owner_user_id = auth.uid()
  ) then
    raise exception 'Business not found or access denied';
  end if;
end;
$$;

create or replace function public.list_client_profiles(
  p_business_id uuid,
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  business_id uuid,
  first_name text,
  last_name text,
  display_name text,
  client_name text,
  phone text,
  email text,
  notes text,
  source text,
  source_detail text,
  preferred_staff_member_id uuid,
  profile_metadata jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  lifetime_bookings bigint,
  lifetime_revenue numeric,
  average_spend numeric,
  last_visit_at timestamptz,
  next_appointment_at timestamptz,
  no_show_count bigint,
  cancellation_count bigint,
  rescheduled_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_search text := nullif(trim(coalesce(p_search, '')), '');
begin
  perform public._assert_business_owner(p_business_id);

  return query
  select
    c.id,
    c.business_id,
    c.first_name,
    c.last_name,
    c.display_name,
    c.client_name,
    c.phone,
    c.email,
    c.notes,
    c.source,
    c.source_detail,
    c.preferred_staff_member_id,
    c.profile_metadata,
    c.created_at,
    c.updated_at,
    s.lifetime_bookings,
    s.lifetime_revenue,
    s.average_spend,
    s.last_visit_at,
    s.next_appointment_at,
    s.no_show_count,
    s.cancellation_count,
    s.rescheduled_count
  from public.clients c
  left join public.client_profile_stats s on s.client_id = c.id
  where c.business_id = p_business_id
    and (
      v_search is null
      or c.display_name ilike '%' || v_search || '%'
      or coalesce(c.email, '') ilike '%' || v_search || '%'
      or coalesce(c.phone, '') ilike '%' || v_search || '%'
      or coalesce(c.notes, '') ilike '%' || v_search || '%'
    )
  order by coalesce(s.next_appointment_at, s.last_visit_at) desc nulls last, c.display_name asc
  limit v_limit
  offset v_offset;
end;
$$;

create or replace function public.get_client_profile(p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client public.clients%rowtype;
  v_stats public.client_profile_stats%rowtype;
  v_tags jsonb;
  v_upcoming jsonb;
  v_history jsonb;
  v_cancelled jsonb;
  v_rescheduled jsonb;
begin
  select *
  into v_client
  from public.clients c
  where c.id = p_client_id;

  if not found then
    raise exception 'Client not found';
  end if;

  perform public._assert_business_owner(v_client.business_id);

  select *
  into v_stats
  from public.client_profile_stats s
  where s.client_id = p_client_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', t.id,
      'name', t.name,
      'color', t.color,
      'assigned_at', a.assigned_at
    )
    order by t.name asc
  ), '[]'::jsonb)
  into v_tags
  from public.client_tag_assignments a
  join public.client_tags t on t.id = a.tag_id
  where a.client_id = p_client_id;

  select coalesce(jsonb_agg(to_jsonb(b) order by b.date asc, b.time asc), '[]'::jsonb)
  into v_upcoming
  from public.bookings b
  join public.businesses bs on bs.id = b.business_id
  where b.client_id = p_client_id
    and b.business_id = v_client.business_id
    and b.status in ('pending', 'confirmed')
    and public.parse_booking_local_timestamp(bs.timezone, b.date, b.time) >= timezone('utc', now());

  select coalesce(jsonb_agg(to_jsonb(b) order by b.date desc, b.time desc), '[]'::jsonb)
  into v_history
  from public.bookings b
  join public.businesses bs on bs.id = b.business_id
  where b.client_id = p_client_id
    and b.business_id = v_client.business_id
    and b.status in ('confirmed', 'completed')
    and public.parse_booking_local_timestamp(bs.timezone, b.date, b.time) < timezone('utc', now());

  select coalesce(jsonb_agg(to_jsonb(b) order by b.date desc, b.time desc), '[]'::jsonb)
  into v_cancelled
  from public.bookings b
  where b.client_id = p_client_id
    and b.business_id = v_client.business_id
    and b.status = 'cancelled';

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', e.id,
      'booking_id', e.booking_id,
      'event_type', e.event_type,
      'payload', e.payload,
      'occurred_at', e.occurred_at
    )
    order by e.occurred_at desc
  ), '[]'::jsonb)
  into v_rescheduled
  from public.client_booking_events e
  where e.client_id = p_client_id
    and e.event_type = 'booking_rescheduled';

  return jsonb_build_object(
    'client', to_jsonb(v_client),
    'stats', to_jsonb(v_stats),
    'tags', v_tags,
    'upcoming_appointments', v_upcoming,
    'appointment_history', v_history,
    'cancelled_appointments', v_cancelled,
    'rescheduled_events', v_rescheduled
  );
end;
$$;

revoke all on function public._assert_business_owner(uuid) from public;
grant execute on function public._assert_business_owner(uuid) to service_role;

revoke all on function public.list_client_profiles(uuid, text, integer, integer) from public;
grant execute on function public.list_client_profiles(uuid, text, integer, integer) to authenticated;

revoke all on function public.get_client_profile(uuid) from public;
grant execute on function public.get_client_profile(uuid) to authenticated;

revoke all on function public.record_client_booking_event(uuid, uuid, uuid, text, jsonb, timestamptz) from public;
grant execute on function public.record_client_booking_event(uuid, uuid, uuid, text, jsonb, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.client_tags enable row level security;
alter table public.client_tag_assignments enable row level security;
alter table public.client_booking_events enable row level security;
alter table public.client_segments enable row level security;
alter table public.client_loyalty_accounts enable row level security;

drop policy if exists "Users can read own clients" on public.clients;
drop policy if exists "Users can insert own clients" on public.clients;
drop policy if exists "Users can update own clients" on public.clients;
drop policy if exists "Users can delete own clients" on public.clients;

create policy "Owners can read business clients"
on public.clients
for select
using (
  exists (
    select 1
    from public.businesses b
    where b.id = clients.business_id
      and b.owner_user_id = auth.uid()
  )
);

create policy "Owners can insert business clients"
on public.clients
for insert
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.businesses b
    where b.id = clients.business_id
      and b.owner_user_id = auth.uid()
  )
);

create policy "Owners can update business clients"
on public.clients
for update
using (
  exists (
    select 1
    from public.businesses b
    where b.id = clients.business_id
      and b.owner_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.businesses b
    where b.id = clients.business_id
      and b.owner_user_id = auth.uid()
  )
);

create policy "Owners can delete business clients"
on public.clients
for delete
using (
  exists (
    select 1
    from public.businesses b
    where b.id = clients.business_id
      and b.owner_user_id = auth.uid()
  )
);

drop policy if exists "Owners can read business client tags" on public.client_tags;
create policy "Owners can read business client tags"
on public.client_tags
for select
using (
  exists (
    select 1
    from public.businesses b
    where b.id = client_tags.business_id
      and b.owner_user_id = auth.uid()
  )
);

drop policy if exists "Owners can manage business client tags" on public.client_tags;
create policy "Owners can manage business client tags"
on public.client_tags
for all
using (
  exists (
    select 1
    from public.businesses b
    where b.id = client_tags.business_id
      and b.owner_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.businesses b
    where b.id = client_tags.business_id
      and b.owner_user_id = auth.uid()
  )
);

drop policy if exists "Owners can read client tag assignments" on public.client_tag_assignments;
create policy "Owners can read client tag assignments"
on public.client_tag_assignments
for select
using (
  exists (
    select 1
    from public.clients c
    join public.businesses b on b.id = c.business_id
    where c.id = client_tag_assignments.client_id
      and b.owner_user_id = auth.uid()
  )
);

drop policy if exists "Owners can manage client tag assignments" on public.client_tag_assignments;
create policy "Owners can manage client tag assignments"
on public.client_tag_assignments
for all
using (
  exists (
    select 1
    from public.clients c
    join public.businesses b on b.id = c.business_id
    where c.id = client_tag_assignments.client_id
      and b.owner_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.clients c
    join public.client_tags t on t.id = client_tag_assignments.tag_id
    join public.businesses b on b.id = c.business_id
    where c.id = client_tag_assignments.client_id
      and t.business_id = c.business_id
      and b.owner_user_id = auth.uid()
  )
);

drop policy if exists "Owners can read client booking events" on public.client_booking_events;
create policy "Owners can read client booking events"
on public.client_booking_events
for select
using (
  exists (
    select 1
    from public.businesses b
    where b.id = client_booking_events.business_id
      and b.owner_user_id = auth.uid()
  )
);

drop policy if exists "Owners can read client segments" on public.client_segments;
create policy "Owners can read client segments"
on public.client_segments
for select
using (
  exists (
    select 1
    from public.businesses b
    where b.id = client_segments.business_id
      and b.owner_user_id = auth.uid()
  )
);

drop policy if exists "Owners can manage client segments" on public.client_segments;
create policy "Owners can manage client segments"
on public.client_segments
for all
using (
  exists (
    select 1
    from public.businesses b
    where b.id = client_segments.business_id
      and b.owner_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.businesses b
    where b.id = client_segments.business_id
      and b.owner_user_id = auth.uid()
  )
);

drop policy if exists "Owners can read client loyalty accounts" on public.client_loyalty_accounts;
create policy "Owners can read client loyalty accounts"
on public.client_loyalty_accounts
for select
using (
  exists (
    select 1
    from public.businesses b
    where b.id = client_loyalty_accounts.business_id
      and b.owner_user_id = auth.uid()
  )
);

drop policy if exists "Owners can manage client loyalty accounts" on public.client_loyalty_accounts;
create policy "Owners can manage client loyalty accounts"
on public.client_loyalty_accounts
for all
using (
  exists (
    select 1
    from public.businesses b
    where b.id = client_loyalty_accounts.business_id
      and b.owner_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.businesses b
    where b.id = client_loyalty_accounts.business_id
      and b.owner_user_id = auth.uid()
  )
);
