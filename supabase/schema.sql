-- SALO bookings schema
create extension if not exists "pgcrypto";

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  business_name text not null,
  slug text not null unique,
  description text,
  timezone text not null default 'UTC',
  services jsonb not null default '[
    {"id":"haircut","name":"Haircut","price":45,"duration_minutes":45},
    {"id":"coloring","name":"Coloring","price":95,"duration_minutes":90},
    {"id":"nails","name":"Nails","price":60,"duration_minutes":60},
    {"id":"facial","name":"Facial","price":75,"duration_minutes":60}
  ]'::jsonb,
  onboarding_completed boolean not null default false,
  stripe_account_id text,
  ai_settings jsonb not null default '{}'::jsonb,
  public_booking_enabled boolean not null default true,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists businesses_owner_user_id_idx on public.businesses (owner_user_id);
create index if not exists businesses_slug_idx on public.businesses (slug);

alter table public.businesses enable row level security;

create policy "Public can read enabled businesses"
on public.businesses
for select
using (public_booking_enabled = true or auth.uid() = owner_user_id);

create policy "Users can insert own businesses"
on public.businesses
for insert
with check (auth.uid() = owner_user_id);

create policy "Users can update own businesses"
on public.businesses
for update
using (auth.uid() = owner_user_id)
with check (auth.uid() = owner_user_id);

create policy "Users can delete own businesses"
on public.businesses
for delete
using (auth.uid() = owner_user_id);

create or replace function public.create_default_business_for_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  slug_base text;
  business_slug text;
  business_name text;
begin
  slug_base := lower(
    regexp_replace(
      split_part(coalesce(new.email, new.id::text), '@', 1),
      '[^a-z0-9]+',
      '-',
      'g'
    )
  );

  if slug_base is null or length(slug_base) = 0 then
    slug_base := 'salo';
  end if;

  business_slug := slug_base || '-' || substr(replace(new.id::text, '-', ''), 1, 6);
  business_name := initcap(replace(slug_base, '-', ' ')) || ' Salon';

  insert into public.businesses (
    owner_user_id,
    business_name,
    slug,
    description,
    timezone
  ) values (
    new.id,
    business_name,
    business_slug,
    'Luxury salon booking experience',
    'UTC'
  )
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_business on auth.users;

create trigger on_auth_user_created_business
after insert on auth.users
for each row
execute procedure public.create_default_business_for_user();

create table if not exists public.business_hours (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  weekday smallint not null check (weekday >= 0 and weekday <= 6),
  is_closed boolean not null default false,
  open_time text not null default '09:00',
  close_time text not null default '18:00',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (business_id, weekday)
);

create index if not exists business_hours_business_id_idx on public.business_hours (business_id);

alter table public.business_hours enable row level security;

create policy "Public can read business hours for enabled businesses"
on public.business_hours
for select
using (
  exists (
    select 1
    from public.businesses b
    where b.id = business_id
      and (b.public_booking_enabled = true or b.owner_user_id = auth.uid())
  )
);

create policy "Owners can insert own business hours"
on public.business_hours
for insert
with check (
  exists (
    select 1
    from public.businesses b
    where b.id = business_id
      and b.owner_user_id = auth.uid()
  )
);

create policy "Owners can update own business hours"
on public.business_hours
for update
using (
  exists (
    select 1
    from public.businesses b
    where b.id = business_id
      and b.owner_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.businesses b
    where b.id = business_id
      and b.owner_user_id = auth.uid()
  )
);

create policy "Owners can delete own business hours"
on public.business_hours
for delete
using (
  exists (
    select 1
    from public.businesses b
    where b.id = business_id
      and b.owner_user_id = auth.uid()
  )
);

create table if not exists public.staff_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  email text,
  role text not null default 'Stylist',
  avatar_url text,
  color text not null default '#7C3AED',
  is_active boolean not null default true,
  availability_settings jsonb not null default '{}'::jsonb,
  ai_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists staff_members_business_id_idx on public.staff_members (business_id);
create index if not exists staff_members_business_id_active_idx on public.staff_members (business_id, is_active);

alter table public.staff_members enable row level security;

create policy "Owners can read own staff members"
on public.staff_members
for select
using (
  exists (
    select 1
    from public.businesses b
    where b.id = business_id
      and b.owner_user_id = auth.uid()
  )
);

create policy "Owners can insert own staff members"
on public.staff_members
for insert
with check (
  exists (
    select 1
    from public.businesses b
    where b.id = business_id
      and b.owner_user_id = auth.uid()
  )
);

create policy "Owners can update own staff members"
on public.staff_members
for update
using (
  exists (
    select 1
    from public.businesses b
    where b.id = business_id
      and b.owner_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.businesses b
    where b.id = business_id
      and b.owner_user_id = auth.uid()
  )
);

create policy "Owners can delete own staff members"
on public.staff_members
for delete
using (
  exists (
    select 1
    from public.businesses b
    where b.id = business_id
      and b.owner_user_id = auth.uid()
  )
);

create table if not exists public.staff_availability (
  id uuid primary key default gen_random_uuid(),
  staff_member_id uuid not null references public.staff_members(id) on delete cascade,
  weekday smallint not null check (weekday >= 0 and weekday <= 6),
  is_closed boolean not null default false,
  open_time text not null default '09:00',
  close_time text not null default '18:00',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (staff_member_id, weekday)
);

create index if not exists staff_availability_staff_member_id_idx on public.staff_availability (staff_member_id);

alter table public.staff_availability enable row level security;

create policy "Owners can read own staff availability"
on public.staff_availability
for select
using (
  exists (
    select 1
    from public.staff_members sm
    join public.businesses b on b.id = sm.business_id
    where sm.id = staff_member_id
      and b.owner_user_id = auth.uid()
  )
);

create policy "Owners can insert own staff availability"
on public.staff_availability
for insert
with check (
  exists (
    select 1
    from public.staff_members sm
    join public.businesses b on b.id = sm.business_id
    where sm.id = staff_member_id
      and b.owner_user_id = auth.uid()
  )
);

create policy "Owners can update own staff availability"
on public.staff_availability
for update
using (
  exists (
    select 1
    from public.staff_members sm
    join public.businesses b on b.id = sm.business_id
    where sm.id = staff_member_id
      and b.owner_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.staff_members sm
    join public.businesses b on b.id = sm.business_id
    where sm.id = staff_member_id
      and b.owner_user_id = auth.uid()
  )
);

create policy "Owners can delete own staff availability"
on public.staff_availability
for delete
using (
  exists (
    select 1
    from public.staff_members sm
    join public.businesses b on b.id = sm.business_id
    where sm.id = staff_member_id
      and b.owner_user_id = auth.uid()
  )
);

create or replace function public.get_public_staff_members(
  target_business_id uuid
)
returns table (
  id uuid,
  name text,
  role text,
  avatar_url text,
  color text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.businesses b
    where b.id = target_business_id
      and b.public_booking_enabled = true
  ) then
    return;
  end if;

  return query
  select
    sm.id,
    sm.name,
    sm.role,
    sm.avatar_url,
    sm.color
  from public.staff_members sm
  where sm.business_id = target_business_id
    and sm.is_active = true
  order by sm.created_at asc;
end;
$$;

revoke all on function public.get_public_staff_members(uuid) from public;
grant execute on function public.get_public_staff_members(uuid) to anon;
grant execute on function public.get_public_staff_members(uuid) to authenticated;

create or replace function public.get_public_staff_availability(
  target_business_id uuid
)
returns table (
  staff_member_id uuid,
  weekday smallint,
  is_closed boolean,
  open_time text,
  close_time text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.businesses b
    where b.id = target_business_id
      and b.public_booking_enabled = true
  ) then
    return;
  end if;

  return query
  select
    sa.staff_member_id,
    sa.weekday,
    sa.is_closed,
    sa.open_time,
    sa.close_time
  from public.staff_availability sa
  join public.staff_members sm on sm.id = sa.staff_member_id
  where sm.business_id = target_business_id
    and sm.is_active = true
  order by sa.staff_member_id, sa.weekday;
end;
$$;

revoke all on function public.get_public_staff_availability(uuid) from public;
grant execute on function public.get_public_staff_availability(uuid) to anon;
grant execute on function public.get_public_staff_availability(uuid) to authenticated;

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  description text,
  duration_minutes integer not null default 60,
  price numeric(10,2) not null default 0,
  category text,
  color text not null default '#7C3AED',
  is_active boolean not null default true,
  sort_order integer not null default 0,
  stripe_price_id text,
  ai_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists services_business_id_idx on public.services (business_id);
create index if not exists services_business_id_active_idx on public.services (business_id, is_active);

alter table public.services enable row level security;

create policy "Public can read active services for enabled businesses"
on public.services
for select
using (
  is_active = true
  and exists (
    select 1
    from public.businesses b
    where b.id = business_id
      and b.public_booking_enabled = true
  )
);

create policy "Owners can read own services"
on public.services
for select
using (
  exists (
    select 1
    from public.businesses b
    where b.id = business_id
      and b.owner_user_id = auth.uid()
  )
);

create policy "Owners can insert own services"
on public.services
for insert
with check (
  exists (
    select 1
    from public.businesses b
    where b.id = business_id
      and b.owner_user_id = auth.uid()
  )
);

create policy "Owners can update own services"
on public.services
for update
using (
  exists (
    select 1
    from public.businesses b
    where b.id = business_id
      and b.owner_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.businesses b
    where b.id = business_id
      and b.owner_user_id = auth.uid()
  )
);

create policy "Owners can delete own services"
on public.services
for delete
using (
  exists (
    select 1
    from public.businesses b
    where b.id = business_id
      and b.owner_user_id = auth.uid()
  )
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  client_name text not null,
  service text not null,
  date text not null,
  time text not null,
  status text not null default 'confirmed',
  price numeric(10,2) not null default 0,
  business_id uuid references public.businesses(id) on delete set null,
  business_slug text,
  customer_email text,
  customer_phone text,
  staff_member_id uuid references public.staff_members(id) on delete set null,
  booking_source text not null default 'owner',
  booking_metadata jsonb not null default '{}'::jsonb,
  notes text,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.bookings
add column if not exists price numeric(10,2) not null default 0;

alter table public.bookings
add column if not exists status text not null default 'confirmed';

update public.bookings
set status = 'confirmed'
where status is null;

alter table public.bookings
drop constraint if exists bookings_status_check;

alter table public.bookings
add constraint bookings_status_check
check (status in ('pending', 'confirmed', 'completed', 'cancelled', 'no_show'));

alter table public.bookings
add column if not exists staff_member_id uuid references public.staff_members(id) on delete set null;

alter table public.bookings enable row level security;

create policy "Users can read own bookings"
on public.bookings
for select
using (auth.uid() = user_id);

create policy "Users can insert own bookings"
on public.bookings
for insert
with check (auth.uid() = user_id);

create policy "Public can create bookings for enabled businesses"
on public.bookings
for insert
with check (
  booking_source = 'public'
  and status = 'pending'
  and user_id is not null
  and business_slug is not null
  and (
    staff_member_id is null
    or exists (
      select 1
      from public.staff_members sm
      where sm.id = staff_member_id
        and sm.business_id = business_id
        and sm.is_active = true
    )
  )
  and exists (
    select 1
    from public.businesses b
    where b.slug = business_slug
      and b.owner_user_id = user_id
      and b.public_booking_enabled = true
      and (business_id is null or business_id = b.id)
  )
);

create policy "Users can update own bookings"
on public.bookings
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete own bookings"
on public.bookings
for delete
using (auth.uid() = user_id);

create table if not exists public.ai_recommendations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete set null,
  recommendation_type text not null check (recommendation_type in ('best_available', 'fastest_appointment', 'preferred_staff')),
  accepted boolean not null default false,
  reasoning_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists ai_recommendations_business_id_idx on public.ai_recommendations (business_id);
create index if not exists ai_recommendations_user_id_idx on public.ai_recommendations (user_id);
create index if not exists ai_recommendations_booking_id_idx on public.ai_recommendations (booking_id);
create index if not exists ai_recommendations_type_created_idx on public.ai_recommendations (recommendation_type, created_at desc);

alter table public.ai_recommendations enable row level security;

create policy "Owners can read own ai recommendations"
on public.ai_recommendations
for select
using (
  auth.uid() = user_id
  and exists (
    select 1
    from public.businesses b
    where b.id = business_id
      and b.owner_user_id = auth.uid()
  )
);

create policy "Owners can insert own ai recommendations"
on public.ai_recommendations
for insert
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.businesses b
    where b.id = business_id
      and b.owner_user_id = auth.uid()
  )
);

create policy "Owners can update own ai recommendations"
on public.ai_recommendations
for update
using (
  auth.uid() = user_id
  and exists (
    select 1
    from public.businesses b
    where b.id = business_id
      and b.owner_user_id = auth.uid()
  )
)
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.businesses b
    where b.id = business_id
      and b.owner_user_id = auth.uid()
  )
);

create policy "Owners can delete own ai recommendations"
on public.ai_recommendations
for delete
using (
  auth.uid() = user_id
  and exists (
    select 1
    from public.businesses b
    where b.id = business_id
      and b.owner_user_id = auth.uid()
  )
);

create or replace function public.get_business_booked_slots(
  target_business_id uuid,
  target_date text
)
returns table (
  id uuid,
  booking_time text,
  staff_member_id uuid,
  duration_minutes integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.businesses b
    where b.id = target_business_id
      and b.public_booking_enabled = true
  ) then
    return;
  end if;

  return query
  select
    bk.id,
    bk.time as booking_time,
    bk.staff_member_id,
    greatest(1, coalesce((bk.booking_metadata ->> 'service_duration_minutes')::integer, 60)) as duration_minutes
  from public.bookings bk
  where bk.business_id = target_business_id
    and bk.date = target_date
    and bk.status <> 'cancelled';
end;
$$;

revoke all on function public.get_business_booked_slots(uuid, text) from public;
grant execute on function public.get_business_booked_slots(uuid, text) to anon;
grant execute on function public.get_business_booked_slots(uuid, text) to authenticated;

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  client_name text not null,
  phone text,
  email text,
  notes text,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.clients enable row level security;

create policy "Users can read own clients"
on public.clients
for select
using (auth.uid() = user_id);

create policy "Users can insert own clients"
on public.clients
for insert
with check (auth.uid() = user_id);

create policy "Users can update own clients"
on public.clients
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete own clients"
on public.clients
for delete
using (auth.uid() = user_id);

create table if not exists public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references public.businesses(id) on delete cascade,
  enable_customer_sms boolean not null default true,
  send_booking_created_sms boolean not null default true,
  send_status_update_sms boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

insert into public.notification_preferences (business_id)
select b.id
from public.businesses b
where not exists (
  select 1
  from public.notification_preferences np
  where np.business_id = b.id
);

alter table public.notification_preferences enable row level security;

drop policy if exists "Owners can read own notification preferences" on public.notification_preferences;
create policy "Owners can read own notification preferences"
on public.notification_preferences
for select
using (
  exists (
    select 1
    from public.businesses b
    where b.id = business_id
      and b.owner_user_id = auth.uid()
  )
);

drop policy if exists "Owners can insert own notification preferences" on public.notification_preferences;
create policy "Owners can insert own notification preferences"
on public.notification_preferences
for insert
with check (
  exists (
    select 1
    from public.businesses b
    where b.id = business_id
      and b.owner_user_id = auth.uid()
  )
);

drop policy if exists "Owners can update own notification preferences" on public.notification_preferences;
create policy "Owners can update own notification preferences"
on public.notification_preferences
for update
using (
  exists (
    select 1
    from public.businesses b
    where b.id = business_id
      and b.owner_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.businesses b
    where b.id = business_id
      and b.owner_user_id = auth.uid()
  )
);

drop policy if exists "Owners can delete own notification preferences" on public.notification_preferences;
create policy "Owners can delete own notification preferences"
on public.notification_preferences
for delete
using (
  exists (
    select 1
    from public.businesses b
    where b.id = business_id
      and b.owner_user_id = auth.uid()
  )
);

create table if not exists public.sms_notifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  event_type text not null check (event_type in (
    'booking_created',
    'booking_confirmed',
    'booking_cancelled',
    'booking_rescheduled',
    'booking_completed'
  )),
  customer_phone text not null,
  message_body text,
  provider text not null default 'twilio',
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  retry_count integer not null default 0,
  max_retries integer not null default 5,
  next_attempt_at timestamptz not null default timezone('utc', now()),
  last_error text,
  twilio_message_sid text,
  metadata jsonb not null default '{}'::jsonb,
  queued_at timestamptz not null default timezone('utc', now()),
  sent_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists sms_notifications_business_id_idx on public.sms_notifications (business_id);
create index if not exists sms_notifications_booking_id_idx on public.sms_notifications (booking_id);
create index if not exists sms_notifications_status_idx on public.sms_notifications (status);
create index if not exists sms_notifications_status_next_attempt_idx on public.sms_notifications (status, next_attempt_at);
create index if not exists sms_notifications_event_type_idx on public.sms_notifications (event_type);

alter table public.sms_notifications add column if not exists status text;
alter table public.sms_notifications add column if not exists retry_count integer;
alter table public.sms_notifications add column if not exists max_retries integer;
alter table public.sms_notifications add column if not exists next_attempt_at timestamptz;
alter table public.sms_notifications add column if not exists last_error text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'sms_notifications'
      and c.column_name = 'delivery_status'
  ) then
    execute '
      update public.sms_notifications
      set status = case
        when coalesce(delivery_status, ''pending'') = ''sent'' then ''sent''
        when coalesce(delivery_status, ''pending'') = ''pending'' then ''pending''
        else ''failed''
      end
      where status is null
    ';
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'sms_notifications'
      and c.column_name = 'attempt_count'
  ) then
    execute '
      update public.sms_notifications
      set retry_count = coalesce(attempt_count, 0)
      where retry_count is null
    ';
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'sms_notifications'
      and c.column_name = 'error_message'
  ) then
    execute '
      update public.sms_notifications
      set last_error = error_message
      where last_error is null
    ';
  end if;
end;
$$;

update public.sms_notifications
set max_retries = 5
where max_retries is null;

update public.sms_notifications
set next_attempt_at = coalesce(queued_at, timezone('utc', now()))
where next_attempt_at is null;

update public.sms_notifications
set retry_count = 0
where retry_count is null;

update public.sms_notifications
set status = 'pending'
where status is null;

alter table public.sms_notifications
  alter column status set default 'pending',
  alter column status set not null,
  alter column retry_count set default 0,
  alter column retry_count set not null,
  alter column max_retries set default 5,
  alter column max_retries set not null,
  alter column next_attempt_at set default timezone('utc', now()),
  alter column next_attempt_at set not null;

alter table public.sms_notifications
  drop constraint if exists sms_notifications_status_check;

alter table public.sms_notifications
  add constraint sms_notifications_status_check
  check (status in ('pending', 'sent', 'failed'));

alter table public.sms_notifications enable row level security;

drop policy if exists "Owners can read own sms notifications" on public.sms_notifications;
create policy "Owners can read own sms notifications"
on public.sms_notifications
for select
using (
  exists (
    select 1
    from public.businesses b
    where b.id = business_id
      and b.owner_user_id = auth.uid()
  )
);

drop policy if exists "Owners can insert own sms notifications" on public.sms_notifications;
create policy "Owners can insert own sms notifications"
on public.sms_notifications
for insert
with check (
  exists (
    select 1
    from public.businesses b
    where b.id = business_id
      and b.owner_user_id = auth.uid()
  )
);

drop policy if exists "Owners can update own sms notifications" on public.sms_notifications;
create policy "Owners can update own sms notifications"
on public.sms_notifications
for update
using (
  exists (
    select 1
    from public.businesses b
    where b.id = business_id
      and b.owner_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.businesses b
    where b.id = business_id
      and b.owner_user_id = auth.uid()
  )
);

drop policy if exists "Owners can delete own sms notifications" on public.sms_notifications;
create policy "Owners can delete own sms notifications"
on public.sms_notifications
for delete
using (
  exists (
    select 1
    from public.businesses b
    where b.id = business_id
      and b.owner_user_id = auth.uid()
  )
);

create or replace function public.ensure_notification_preferences_for_business()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notification_preferences (business_id)
  values (new.id)
  on conflict (business_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_business_created_notification_preferences on public.businesses;

create trigger on_business_created_notification_preferences
after insert on public.businesses
for each row
execute procedure public.ensure_notification_preferences_for_business();

create or replace function public.enqueue_booking_sms_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  prefs record;
  is_phone_present boolean;
  is_public_booking boolean;
begin
  if new.business_id is null or coalesce(trim(new.customer_phone), '') = '' then
    return new;
  end if;

  is_phone_present := coalesce(trim(new.customer_phone), '') <> '';
  is_public_booking := coalesce(new.booking_source, 'owner') = 'public';

  insert into public.notification_preferences (business_id)
  values (new.business_id)
  on conflict (business_id) do nothing;

  select *
  into prefs
  from public.notification_preferences
  where business_id = new.business_id;

  if not found or prefs.enable_customer_sms = false or is_phone_present = false then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if prefs.send_booking_created_sms then
      insert into public.sms_notifications (
        business_id,
        booking_id,
        event_type,
        customer_phone,
        metadata
      ) values (
        new.business_id,
        new.id,
        'booking_created',
        new.customer_phone,
        jsonb_build_object(
          'booking_source', new.booking_source,
          'status', new.status
        )
      );
    end if;

    return new;
  end if;

  if tg_op = 'UPDATE' then
    if prefs.send_status_update_sms then
      if (old.date is distinct from new.date) or (old.time is distinct from new.time) then
        insert into public.sms_notifications (
          business_id,
          booking_id,
          event_type,
          customer_phone,
          metadata
        ) values (
          new.business_id,
          new.id,
          'booking_rescheduled',
          new.customer_phone,
          jsonb_build_object(
            'old_date', old.date,
            'old_time', old.time,
            'new_date', new.date,
            'new_time', new.time,
            'booking_source', new.booking_source
          )
        );
      end if;

      if old.status is distinct from new.status then
        if new.status = 'confirmed' then
          insert into public.sms_notifications (
            business_id,
            booking_id,
            event_type,
            customer_phone,
            metadata
          ) values (
            new.business_id,
            new.id,
            'booking_confirmed',
            new.customer_phone,
            jsonb_build_object(
              'old_status', old.status,
              'new_status', new.status,
              'booking_source', new.booking_source,
              'is_public_booking', is_public_booking
            )
          );
        elsif new.status = 'cancelled' then
          insert into public.sms_notifications (
            business_id,
            booking_id,
            event_type,
            customer_phone,
            metadata
          ) values (
            new.business_id,
            new.id,
            'booking_cancelled',
            new.customer_phone,
            jsonb_build_object(
              'old_status', old.status,
              'new_status', new.status,
              'booking_source', new.booking_source,
              'is_public_booking', is_public_booking
            )
          );
        elsif new.status = 'completed' then
          insert into public.sms_notifications (
            business_id,
            booking_id,
            event_type,
            customer_phone,
            metadata
          ) values (
            new.business_id,
            new.id,
            'booking_completed',
            new.customer_phone,
            jsonb_build_object(
              'old_status', old.status,
              'new_status', new.status,
              'booking_source', new.booking_source,
              'is_public_booking', is_public_booking
            )
          );
        end if;
      end if;
    end if;

    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists on_booking_sms_notification_enqueue on public.bookings;

create trigger on_booking_sms_notification_enqueue
after insert or update on public.bookings
for each row
execute procedure public.enqueue_booking_sms_notifications();

alter table public.businesses
add column if not exists deposits_enabled boolean not null default false;

alter table public.businesses
add column if not exists deposit_percentage numeric(5,2) not null default 30.00;

alter table public.businesses
add column if not exists require_card_on_booking boolean not null default false;

alter table public.businesses
add column if not exists stripe_charges_enabled boolean not null default false;

alter table public.businesses
add column if not exists stripe_payouts_enabled boolean not null default false;

alter table public.businesses
drop constraint if exists businesses_deposit_percentage_check;

alter table public.businesses
add constraint businesses_deposit_percentage_check
check (deposit_percentage >= 0 and deposit_percentage <= 100);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  stripe_payment_intent_id text,
  stripe_checkout_session_id text,
  amount numeric(10,2) not null check (amount >= 0),
  currency text not null default 'usd',
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'refunded')),
  refunded boolean not null default false,
  provider_event_type text,
  provider_event_id text,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  paid_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (stripe_payment_intent_id),
  unique (stripe_checkout_session_id)
);

create index if not exists payments_booking_id_idx on public.payments (booking_id);
create index if not exists payments_business_id_idx on public.payments (business_id);
create index if not exists payments_status_idx on public.payments (status);
create index if not exists payments_event_id_idx on public.payments (provider_event_id);

alter table public.payments enable row level security;

drop policy if exists "Owners can read own payments" on public.payments;
create policy "Owners can read own payments"
on public.payments
for select
using (
  exists (
    select 1
    from public.businesses b
    where b.id = business_id
      and b.owner_user_id = auth.uid()
  )
);

drop policy if exists "Owners can insert own payments" on public.payments;
create policy "Owners can insert own payments"
on public.payments
for insert
with check (
  exists (
    select 1
    from public.businesses b
    where b.id = business_id
      and b.owner_user_id = auth.uid()
  )
);

drop policy if exists "Owners can update own payments" on public.payments;
create policy "Owners can update own payments"
on public.payments
for update
using (
  exists (
    select 1
    from public.businesses b
    where b.id = business_id
      and b.owner_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.businesses b
    where b.id = business_id
      and b.owner_user_id = auth.uid()
  )
);

drop policy if exists "Owners can delete own payments" on public.payments;
create policy "Owners can delete own payments"
on public.payments
for delete
using (
  exists (
    select 1
    from public.businesses b
    where b.id = business_id
      and b.owner_user_id = auth.uid()
  )
);

create or replace function public.sync_booking_status_from_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'succeeded' then
    update public.bookings
    set
      status = 'confirmed',
      booking_metadata = coalesce(booking_metadata, '{}'::jsonb) || jsonb_build_object(
        'payment_status', 'succeeded',
        'payment_id', new.id,
        'stripe_payment_intent_id', new.stripe_payment_intent_id
      )
    where id = new.booking_id;
  elsif new.status = 'failed' then
    update public.bookings
    set
      status = 'pending',
      booking_metadata = coalesce(booking_metadata, '{}'::jsonb) || jsonb_build_object(
        'payment_status', 'failed',
        'payment_id', new.id,
        'payment_last_error', new.last_error
      )
    where id = new.booking_id;
  elsif new.status = 'refunded' or new.refunded = true then
    update public.bookings
    set
      status = 'cancelled',
      booking_metadata = coalesce(booking_metadata, '{}'::jsonb) || jsonb_build_object(
        'payment_status', 'refunded',
        'payment_id', new.id
      )
    where id = new.booking_id;
  end if;

  return new;
end;
$$;

drop trigger if exists on_payment_status_sync_booking on public.payments;

create trigger on_payment_status_sync_booking
after insert or update on public.payments
for each row
execute procedure public.sync_booking_status_from_payment();
