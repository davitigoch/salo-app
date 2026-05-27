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

create or replace function public.get_business_booked_slots(
  target_business_id uuid,
  target_date text
)
returns table (
  id uuid,
  time text,
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
    bk.time,
    greatest(1, coalesce((bk.booking_metadata ->> 'service_duration_minutes')::integer, 60)) as duration_minutes
  from public.bookings bk
  where bk.business_id = target_business_id
    and bk.date = target_date;
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
