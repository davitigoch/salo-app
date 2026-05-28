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

drop policy if exists "Owners can read own ai recommendations" on public.ai_recommendations;
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

drop policy if exists "Owners can insert own ai recommendations" on public.ai_recommendations;
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

drop policy if exists "Owners can update own ai recommendations" on public.ai_recommendations;
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

drop policy if exists "Owners can delete own ai recommendations" on public.ai_recommendations;
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
