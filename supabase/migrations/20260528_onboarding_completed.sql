alter table public.businesses
add column if not exists onboarding_completed boolean not null default false;

update public.businesses
set onboarding_completed = true
where onboarding_completed = false
	and created_at < now();
