-- Stripe payments architecture migration for SALO

alter table if exists public.businesses
add column if not exists deposits_enabled boolean not null default false;

alter table if exists public.businesses
add column if not exists deposit_percentage numeric(5,2) not null default 30.00;

alter table if exists public.businesses
add column if not exists require_card_on_booking boolean not null default false;

alter table if exists public.businesses
add column if not exists stripe_charges_enabled boolean not null default false;

alter table if exists public.businesses
add column if not exists stripe_payouts_enabled boolean not null default false;

alter table if exists public.businesses
drop constraint if exists businesses_deposit_percentage_check;

alter table if exists public.businesses
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

alter table if exists public.payments enable row level security;

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
