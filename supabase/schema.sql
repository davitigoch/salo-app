-- SALO bookings schema
create extension if not exists "pgcrypto";

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  client_name text not null,
  service text not null,
  date text not null,
  time text not null,
  notes text,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.bookings enable row level security;

create policy "Users can read own bookings"
on public.bookings
for select
using (auth.uid() = user_id);

create policy "Users can insert own bookings"
on public.bookings
for insert
with check (auth.uid() = user_id);

create policy "Users can update own bookings"
on public.bookings
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete own bookings"
on public.bookings
for delete
using (auth.uid() = user_id);

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
