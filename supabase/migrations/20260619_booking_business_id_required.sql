-- Ensure every booking row has business_id populated at insert time and backfill legacy rows.

update public.bookings b
set
  business_id = bs.id,
  business_slug = coalesce(b.business_slug, bs.slug)
from (
  select distinct on (owner_user_id)
    id,
    owner_user_id,
    slug
  from public.businesses
  order by owner_user_id, created_at asc
) bs
where b.business_id is null
  and b.user_id = bs.owner_user_id;

do $$
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'ensure_booking_business_id'
  ) then
    execute $sql$
      create or replace function public.ensure_booking_business_id()
      returns trigger
      language plpgsql
      as $function$
      declare
        v_business_id uuid;
        v_business_slug text;
      begin
        if new.business_id is not null then
          return new;
        end if;

        if new.user_id is null then
          raise exception 'bookings.user_id is required';
        end if;

        select id, slug
        into v_business_id, v_business_slug
        from public.businesses
        where owner_user_id = new.user_id
        order by created_at asc
        limit 1;

        if v_business_id is null then
          raise exception 'No business found for booking user %', new.user_id;
        end if;

        new.business_id := v_business_id;

        if new.business_slug is null then
          new.business_slug := v_business_slug;
        end if;

        return new;
      end;
      $function$;
    $sql$;
  end if;
end;
$$;

drop trigger if exists on_booking_ensure_business_id on public.bookings;

do $$
begin
  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    where c.relname = 'bookings'
      and t.tgname = 'on_booking_ensure_business_id'
      and not t.tgisinternal
  )
  and not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    where c.relname = 'bookings'
      and t.tgname = 'on_booking_scope_defaults'
      and not t.tgisinternal
  ) then
    execute $sql$
      create trigger on_booking_ensure_business_id
      before insert on public.bookings
      for each row
      execute function public.ensure_booking_business_id();
    $sql$;
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1
    from public.bookings
    where business_id is null
  ) then
    raise exception 'Cannot enforce bookings.business_id NOT NULL: orphan bookings remain';
  end if;
end;
$$;

alter table public.bookings
alter column business_id set not null;

drop policy if exists "Users can insert own bookings" on public.bookings;

create policy "Users can insert own bookings"
on public.bookings
for insert
with check (
  auth.uid() = user_id
  and business_id is not null
  and exists (
    select 1
    from public.businesses b
    where b.id = bookings.business_id
      and b.owner_user_id = bookings.user_id
  )
);
