alter table if exists public.businesses
add column if not exists stripe_card_payments_enabled boolean not null default false;

alter table if exists public.businesses
add column if not exists stripe_transfers_enabled boolean not null default false;
