-- P1: Industry templates foundation.
-- Registry, business fields, list/apply RPCs, conservative backfill. No module gating or roles.

-- ---------------------------------------------------------------------------
-- businesses: industry template fields
-- ---------------------------------------------------------------------------

alter table public.businesses
  add column if not exists industry_template text not null default 'other',
  add column if not exists template_version integer not null default 1,
  add column if not exists template_applied_at timestamptz,
  add column if not exists template_metadata jsonb not null default '{}'::jsonb;

alter table public.businesses
  drop constraint if exists businesses_industry_template_check;

alter table public.businesses
  add constraint businesses_industry_template_check
  check (industry_template in (
    'barber_shop',
    'beauty_salon',
    'spa',
    'dental_clinic',
    'medical_practice',
    'wellness_clinic',
    'fitness_studio',
    'coaching_consulting',
    'other'
  ));

create index if not exists businesses_industry_template_idx
  on public.businesses (industry_template);

-- ---------------------------------------------------------------------------
-- industry_template_definitions registry
-- ---------------------------------------------------------------------------

create table if not exists public.industry_template_definitions (
  template_key text not null,
  version integer not null default 1,
  label text not null,
  description text not null default '',
  industry_category text not null default 'general',
  display_labels jsonb not null default '{}'::jsonb,
  recommended_modules jsonb not null default '[]'::jsonb,
  onboarding_shortcuts jsonb not null default '{}'::jsonb,
  sample_services jsonb not null default '[]'::jsonb,
  default_business_hours jsonb,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (template_key, version)
);

alter table public.industry_template_definitions enable row level security;

drop policy if exists "Authenticated users can read industry templates"
  on public.industry_template_definitions;

create policy "Authenticated users can read industry templates"
  on public.industry_template_definitions
  for select
  to authenticated
  using (is_active = true);

-- ---------------------------------------------------------------------------
-- Seed registry v1
-- ---------------------------------------------------------------------------

insert into public.industry_template_definitions (
  template_key,
  version,
  label,
  description,
  industry_category,
  display_labels,
  recommended_modules,
  onboarding_shortcuts,
  sample_services,
  sort_order
) values
  (
    'barber_shop',
    1,
    'Barber Shop',
    'Haircuts, fades, and grooming for barbers and chair renters.',
    'personal_grooming',
    '{"client":"Client","appointment":"Appointment","service":"Service","staff_member":"Barber"}'::jsonb,
    '["staff_management","public_booking","sms_reminders","client_profiles"]'::jsonb,
    '{"skip_staff_step":false,"suggest_deposits":false,"solo_operator_default":false}'::jsonb,
    '[{"name":"Haircut","duration_minutes":30,"price":35,"category":"Hair"},{"name":"Beard trim","duration_minutes":15,"price":15,"category":"Grooming"}]'::jsonb,
    10
  ),
  (
    'beauty_salon',
    1,
    'Beauty Salon',
    'Hair, nails, esthetics, and beauty services.',
    'personal_grooming',
    '{"client":"Client","appointment":"Appointment","service":"Service","staff_member":"Stylist"}'::jsonb,
    '["staff_management","public_booking","client_profiles","sms_reminders"]'::jsonb,
    '{"skip_staff_step":false,"suggest_deposits":false,"solo_operator_default":false}'::jsonb,
    '[{"name":"Haircut","duration_minutes":45,"price":45,"category":"Hair"},{"name":"Color treatment","duration_minutes":90,"price":95,"category":"Hair"}]'::jsonb,
    20
  ),
  (
    'spa',
    1,
    'Spa',
    'Massage, facials, body treatments, and spa services.',
    'wellness_spa',
    '{"client":"Client","appointment":"Appointment","service":"Treatment","staff_member":"Therapist"}'::jsonb,
    '["staff_management","public_booking","sms_reminders","client_profiles"]'::jsonb,
    '{"skip_staff_step":false,"suggest_deposits":true,"solo_operator_default":false}'::jsonb,
    '[{"name":"Swedish massage","duration_minutes":60,"price":90,"category":"Massage"},{"name":"Facial","duration_minutes":60,"price":75,"category":"Skincare"}]'::jsonb,
    30
  ),
  (
    'dental_clinic',
    1,
    'Dental Clinic',
    'Dental hygiene, exams, and chair-side appointments.',
    'healthcare',
    '{"client":"Patient","appointment":"Appointment","service":"Procedure","staff_member":"Provider"}'::jsonb,
    '["client_profiles","sms_reminders","public_booking","analytics"]'::jsonb,
    '{"skip_staff_step":false,"suggest_deposits":false,"solo_operator_default":false}'::jsonb,
    '[{"name":"Dental exam","duration_minutes":45,"price":0,"category":"Exam"},{"name":"Hygiene cleaning","duration_minutes":60,"price":0,"category":"Hygiene"}]'::jsonb,
    40
  ),
  (
    'medical_practice',
    1,
    'Medical Practice',
    'Physician visits, nurse appointments, and clinical scheduling.',
    'healthcare',
    '{"client":"Patient","appointment":"Visit","service":"Service","staff_member":"Clinician"}'::jsonb,
    '["client_profiles","sms_reminders","public_booking","analytics"]'::jsonb,
    '{"skip_staff_step":false,"suggest_deposits":false,"solo_operator_default":false}'::jsonb,
    '[{"name":"Consultation","duration_minutes":30,"price":0,"category":"Consultation"},{"name":"Follow-up visit","duration_minutes":15,"price":0,"category":"Follow-up"}]'::jsonb,
    50
  ),
  (
    'wellness_clinic',
    1,
    'Wellness Clinic',
    'Holistic care, therapy, and integrative wellness appointments.',
    'wellness_spa',
    '{"client":"Client","appointment":"Appointment","service":"Service","staff_member":"Practitioner"}'::jsonb,
    '["staff_management","client_profiles","sms_reminders","public_booking"]'::jsonb,
    '{"skip_staff_step":false,"suggest_deposits":false,"solo_operator_default":false}'::jsonb,
    '[{"name":"Initial consultation","duration_minutes":60,"price":0,"category":"Consultation"},{"name":"Follow-up session","duration_minutes":45,"price":0,"category":"Session"}]'::jsonb,
    60
  ),
  (
    'fitness_studio',
    1,
    'Fitness Studio',
    'Personal training, classes, and fitness appointments.',
    'fitness',
    '{"client":"Client","appointment":"Session","service":"Session","staff_member":"Trainer"}'::jsonb,
    '["staff_management","public_booking","client_profiles","analytics"]'::jsonb,
    '{"skip_staff_step":false,"suggest_deposits":true,"solo_operator_default":false}'::jsonb,
    '[{"name":"Personal training session","duration_minutes":60,"price":75,"category":"Training"},{"name":"Intro assessment","duration_minutes":45,"price":0,"category":"Assessment"}]'::jsonb,
    70
  ),
  (
    'coaching_consulting',
    1,
    'Coaching / Consulting',
    'Coaches, consultants, and solo appointment-based professionals.',
    'professional_services',
    '{"client":"Client","appointment":"Session","service":"Session","staff_member":"Coach"}'::jsonb,
    '["client_profiles","public_booking","calendar_sync","analytics"]'::jsonb,
    '{"skip_staff_step":true,"suggest_deposits":false,"solo_operator_default":true}'::jsonb,
    '[{"name":"Discovery call","duration_minutes":30,"price":0,"category":"Consultation"},{"name":"Coaching session","duration_minutes":60,"price":150,"category":"Session"}]'::jsonb,
    80
  ),
  (
    'other',
    1,
    'Other',
    'General appointment-based business.',
    'general',
    '{"client":"Client","appointment":"Appointment","service":"Service","staff_member":"Staff member"}'::jsonb,
    '["core_booking","client_profiles","public_booking"]'::jsonb,
    '{"skip_staff_step":false,"suggest_deposits":false,"solo_operator_default":false}'::jsonb,
    '[{"name":"Appointment","duration_minutes":60,"price":0,"category":"General"}]'::jsonb,
    90
  )
on conflict (template_key, version) do update
set
  label = excluded.label,
  description = excluded.description,
  industry_category = excluded.industry_category,
  display_labels = excluded.display_labels,
  recommended_modules = excluded.recommended_modules,
  onboarding_shortcuts = excluded.onboarding_shortcuts,
  sample_services = excluded.sample_services,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;

-- ---------------------------------------------------------------------------
-- Helpers and RPCs
-- ---------------------------------------------------------------------------

create or replace function public.get_industry_template_definition(p_template_key text)
returns public.industry_template_definitions
language sql
stable
security definer
set search_path = public
as $$
  select d.*
  from public.industry_template_definitions d
  where d.template_key = p_template_key
    and d.is_active = true
  order by d.version desc
  limit 1;
$$;

create or replace function public.list_industry_templates()
returns table (
  template_key text,
  version integer,
  label text,
  description text,
  industry_category text,
  display_labels jsonb,
  recommended_modules jsonb,
  onboarding_shortcuts jsonb,
  sample_services jsonb,
  sort_order integer
)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (d.template_key)
    d.template_key,
    d.version,
    d.label,
    d.description,
    d.industry_category,
    d.display_labels,
    d.recommended_modules,
    d.onboarding_shortcuts,
    d.sample_services,
    d.sort_order
  from public.industry_template_definitions d
  where d.is_active = true
  order by d.template_key, d.version desc, d.sort_order;
$$;

grant execute on function public.list_industry_templates() to authenticated;

create or replace function public.apply_industry_template(p_template_key text)
returns public.businesses
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business public.businesses;
  v_def public.industry_template_definitions;
  v_metadata jsonb;
  v_service jsonb;
  v_sort_order integer := 0;
begin
  select b.*
  into v_business
  from public.businesses b
  where b.owner_user_id = auth.uid()
  order by b.created_at asc
  limit 1;

  if v_business.id is null then
    raise exception 'Business not found for current user';
  end if;

  v_def := public.get_industry_template_definition(p_template_key);

  if v_def.template_key is null then
    raise exception 'Unknown industry template: %', p_template_key;
  end if;

  v_metadata := jsonb_build_object(
    'industry_category', coalesce(v_def.industry_category, 'general'),
    'display_labels', coalesce(v_def.display_labels, '{}'::jsonb),
    'recommended_modules', coalesce(v_def.recommended_modules, '[]'::jsonb),
    'onboarding_shortcuts', coalesce(v_def.onboarding_shortcuts, '{}'::jsonb),
    'sample_services', coalesce(v_def.sample_services, '[]'::jsonb)
  );

  update public.businesses
  set
    industry_template = v_def.template_key,
    template_version = v_def.version,
    template_applied_at = timezone('utc', now()),
    template_metadata = v_metadata,
    description = case
      when coalesce(trim(description), '') = '' then nullif(trim(v_def.description), '')
      else description
    end
  where id = v_business.id
  returning * into v_business;

  if not exists (
    select 1
    from public.services s
    where s.business_id = v_business.id
  ) then
    for v_service in
      select value
      from jsonb_array_elements(coalesce(v_def.sample_services, '[]'::jsonb))
    loop
      v_sort_order := v_sort_order + 1;

      insert into public.services (
        business_id,
        name,
        duration_minutes,
        price,
        category,
        is_active,
        sort_order
      ) values (
        v_business.id,
        coalesce(v_service->>'name', 'Appointment'),
        greatest(coalesce((v_service->>'duration_minutes')::integer, 60), 1),
        greatest(coalesce((v_service->>'price')::numeric, 0), 0),
        coalesce(nullif(trim(v_service->>'category'), ''), 'General'),
        true,
        v_sort_order
      );
    end loop;
  end if;

  return v_business;
end;
$$;

grant execute on function public.apply_industry_template(text) to authenticated;
grant execute on function public.get_industry_template_definition(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Conservative backfill: existing businesses -> other
-- ---------------------------------------------------------------------------

update public.businesses
set
  industry_template = 'other',
  template_version = 1,
  template_applied_at = coalesce(template_applied_at, created_at, timezone('utc', now()))
where template_applied_at is null
   or template_metadata = '{}'::jsonb;

update public.businesses b
set template_metadata = jsonb_build_object(
  'industry_category', d.industry_category,
  'display_labels', d.display_labels,
  'recommended_modules', d.recommended_modules,
  'onboarding_shortcuts', d.onboarding_shortcuts,
  'sample_services', d.sample_services
)
from public.industry_template_definitions d
where d.template_key = b.industry_template
  and d.version = b.template_version
  and (
    b.template_metadata = '{}'::jsonb
    or not (b.template_metadata ? 'industry_category')
  );

-- ---------------------------------------------------------------------------
-- Default business creation: neutral copy (Business, not Salon)
-- ---------------------------------------------------------------------------

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
  v_other_def public.industry_template_definitions;
  v_metadata jsonb;
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
  business_name := initcap(replace(slug_base, '-', ' ')) || ' Business';

  v_other_def := public.get_industry_template_definition('other');

  v_metadata := jsonb_build_object(
    'industry_category', coalesce(v_other_def.industry_category, 'general'),
    'display_labels', coalesce(v_other_def.display_labels, '{}'::jsonb),
    'recommended_modules', coalesce(v_other_def.recommended_modules, '[]'::jsonb),
    'onboarding_shortcuts', coalesce(v_other_def.onboarding_shortcuts, '{}'::jsonb),
    'sample_services', coalesce(v_other_def.sample_services, '[]'::jsonb)
  );

  insert into public.businesses (
    owner_user_id,
    business_name,
    slug,
    description,
    timezone,
    industry_template,
    template_version,
    template_applied_at,
    template_metadata
  ) values (
    new.id,
    business_name,
    business_slug,
    coalesce(nullif(trim(v_other_def.description), ''), 'Appointment-based business'),
    'UTC',
    'other',
    coalesce(v_other_def.version, 1),
    timezone('utc', now()),
    v_metadata
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
