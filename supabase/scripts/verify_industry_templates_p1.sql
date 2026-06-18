-- Verification script for P1 Industry Templates foundation.
-- Run after applying 20260707_industry_templates_foundation.sql

begin;

-- ---------------------------------------------------------------------------
-- 1. Schema checks
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'businesses'
      and column_name = 'industry_template'
  ) then
    raise exception 'VERIFY FAIL: businesses.industry_template missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'businesses'
      and column_name = 'template_metadata'
  ) then
    raise exception 'VERIFY FAIL: businesses.template_metadata missing';
  end if;

  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public'
      and table_name = 'industry_template_definitions'
  ) then
    raise exception 'VERIFY FAIL: industry_template_definitions table missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'industry_template_definitions'
      and column_name = 'industry_category'
  ) then
    raise exception 'VERIFY FAIL: industry_template_definitions.industry_category missing';
  end if;

  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'list_industry_templates'
  ) then
    raise exception 'VERIFY FAIL: list_industry_templates RPC missing';
  end if;

  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'apply_industry_template'
  ) then
    raise exception 'VERIFY FAIL: apply_industry_template RPC missing';
  end if;

  raise notice 'VERIFY PASS: schema objects present';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Registry count
-- ---------------------------------------------------------------------------

do $$
declare
  v_count integer;
begin
  select count(*)::integer
  into v_count
  from public.list_industry_templates();

  if v_count <> 9 then
    raise exception 'VERIFY FAIL: expected 9 industry templates, got %', v_count;
  end if;

  raise notice 'VERIFY PASS: list_industry_templates returns 9 templates';
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Backfill completeness
-- ---------------------------------------------------------------------------

do $$
declare
  v_missing_applied integer;
  v_missing_metadata integer;
begin
  select count(*)::integer
  into v_missing_applied
  from public.businesses
  where template_applied_at is null;

  if v_missing_applied > 0 then
    raise exception 'VERIFY FAIL: % businesses missing template_applied_at', v_missing_applied;
  end if;

  select count(*)::integer
  into v_missing_metadata
  from public.businesses
  where template_metadata = '{}'::jsonb
     or not (template_metadata ? 'industry_category');

  if v_missing_metadata > 0 then
    raise exception 'VERIFY FAIL: % businesses missing template_metadata snapshot', v_missing_metadata;
  end if;

  raise notice 'VERIFY PASS: businesses backfilled with template metadata';
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. apply_industry_template RPC (authenticated context simulation)
-- ---------------------------------------------------------------------------

create temp table _industry_template_ctx on commit drop as
with owner_user as (
  select id from auth.users order by created_at asc limit 1
),
new_business as (
  insert into public.businesses (
    owner_user_id,
    business_name,
    slug,
    timezone,
    industry_template,
    template_version,
    template_applied_at,
    template_metadata
  )
  select
    owner_user.id,
    'Industry Template Verify Co',
    'industry-template-' || left(replace(gen_random_uuid()::text, '-', ''), 10),
    'America/New_York',
    'other',
    1,
    timezone('utc', now()),
    '{}'::jsonb
  from owner_user
  returning id, owner_user_id
)
select nb.id as business_id, nb.owner_user_id as user_id
from new_business nb;

do $$
declare
  v_user_id uuid;
  v_business_id uuid;
  v_result public.businesses;
  v_service_count integer;
begin
  select business_id, user_id
  into v_business_id, v_user_id
  from _industry_template_ctx
  limit 1;

  perform set_config('request.jwt.claim.sub', v_user_id::text, true);

  select *
  into v_result
  from public.apply_industry_template('wellness_clinic');

  if v_result.industry_template <> 'wellness_clinic' then
    raise exception 'VERIFY FAIL: apply_industry_template did not set industry_template';
  end if;

  if coalesce(v_result.template_metadata->>'industry_category', '') <> 'wellness_spa' then
    raise exception 'VERIFY FAIL: template_metadata.industry_category not set';
  end if;

  if jsonb_array_length(coalesce(v_result.template_metadata->'recommended_modules', '[]'::jsonb)) < 1 then
    raise exception 'VERIFY FAIL: recommended_modules missing from template_metadata';
  end if;

  select count(*)::integer
  into v_service_count
  from public.services
  where business_id = v_result.id;

  if v_service_count < 2 then
    raise exception 'VERIFY FAIL: expected sample services seeded, got %', v_service_count;
  end if;

  perform public.apply_industry_template('wellness_clinic');

  select count(*)::integer
  into v_service_count
  from public.services
  where business_id = v_result.id;

  if v_service_count <> 2 then
    raise exception 'VERIFY FAIL: re-apply duplicated services (count=%)', v_service_count;
  end if;

  raise notice 'VERIFY PASS: apply_industry_template seeds metadata and services idempotently';
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Default signup copy (function body check)
-- ---------------------------------------------------------------------------

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(p.oid)
  into v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'create_default_business_for_user';

  if v_definition is null then
    raise exception 'VERIFY FAIL: create_default_business_for_user missing';
  end if;

  if v_definition not ilike '%Business%' then
    raise exception 'VERIFY FAIL: default business creation does not use Business copy';
  end if;

  if v_definition ilike '%Salon%' then
    raise exception 'VERIFY FAIL: default business creation still references Salon copy';
  end if;

  raise notice 'VERIFY PASS: default business creation uses neutral Business copy';
end;
$$;

rollback;
