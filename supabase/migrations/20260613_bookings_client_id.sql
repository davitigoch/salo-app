-- Link bookings to clients for CRM integrity
alter table public.bookings
add column if not exists client_id uuid references public.clients(id) on delete set null;

create index if not exists bookings_client_id_idx on public.bookings (client_id);

-- Backfill by normalized name within the same owner
update public.bookings b
set client_id = c.id
from public.clients c
where b.client_id is null
  and b.user_id = c.user_id
  and lower(trim(b.client_name)) = lower(trim(c.client_name));

-- Backfill by customer email
update public.bookings b
set client_id = c.id
from public.clients c
where b.client_id is null
  and b.user_id = c.user_id
  and b.customer_email is not null
  and trim(b.customer_email) <> ''
  and lower(trim(b.customer_email)) = lower(trim(c.email));

-- Backfill by normalized phone digits
update public.bookings b
set client_id = c.id
from public.clients c
where b.client_id is null
  and b.user_id = c.user_id
  and b.customer_phone is not null
  and c.phone is not null
  and regexp_replace(b.customer_phone, '\D', '', 'g') <> ''
  and regexp_replace(b.customer_phone, '\D', '', 'g') = regexp_replace(c.phone, '\D', '', 'g');
