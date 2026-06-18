-- PR4 Phase 4.1: Notification Center database foundation.
-- Tables, RLS, RPCs. No app UI, emit wiring, or push changes.

-- ---------------------------------------------------------------------------
-- notification_events
-- ---------------------------------------------------------------------------

create table if not exists public.notification_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  severity text not null default 'info',
  title text not null,
  body text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  dedupe_key text,
  created_at timestamptz not null default timezone('utc', now()),
  constraint notification_events_event_type_check check (
    event_type in (
      'booking_created',
      'booking_confirmed',
      'booking_cancelled',
      'booking_rescheduled',
      'public_booking_request',
      'payment_received',
      'calendar_sync_failed',
      'message_delivery_failed'
    )
  ),
  constraint notification_events_severity_check check (
    severity in ('info', 'success', 'warning')
  ),
  constraint notification_events_entity_type_check check (
    entity_type is null
    or entity_type in ('booking', 'client', 'payment', 'calendar_connection')
  )
);

create index if not exists notification_events_business_created_idx
  on public.notification_events (business_id, created_at desc);

create index if not exists notification_events_user_created_idx
  on public.notification_events (user_id, created_at desc);

create index if not exists notification_events_user_business_created_idx
  on public.notification_events (user_id, business_id, created_at desc);

create unique index if not exists notification_events_dedupe_idx
  on public.notification_events (business_id, dedupe_key)
  where dedupe_key is not null;

comment on table public.notification_events is
  'Immutable in-app notification feed for business owners (PR4 Notification Center).';

-- ---------------------------------------------------------------------------
-- notification_reads
-- ---------------------------------------------------------------------------

create table if not exists public.notification_reads (
  notification_event_id uuid not null references public.notification_events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default timezone('utc', now()),
  primary key (notification_event_id, user_id)
);

create index if not exists notification_reads_user_idx
  on public.notification_reads (user_id);

comment on table public.notification_reads is
  'Per-user read state for notification_events.';

-- ---------------------------------------------------------------------------
-- emit_notification_event (service role / triggers; Phase 4.2 wiring)
-- ---------------------------------------------------------------------------

create or replace function public.emit_notification_event(
  p_business_id uuid,
  p_user_id uuid,
  p_event_type text,
  p_title text,
  p_body text,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_metadata jsonb default '{}'::jsonb,
  p_dedupe_key text default null,
  p_severity text default 'info',
  p_actor_user_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_user_id uuid;
  v_event_id uuid;
begin
  if p_business_id is null or p_user_id is null then
    raise exception 'business_id and user_id are required';
  end if;

  if coalesce(trim(p_title), '') = '' or coalesce(trim(p_body), '') = '' then
    raise exception 'title and body are required';
  end if;

  select b.owner_user_id
  into v_owner_user_id
  from public.businesses b
  where b.id = p_business_id;

  if not found then
    raise exception 'Business not found';
  end if;

  if v_owner_user_id is distinct from p_user_id then
    raise exception 'user_id must match business owner';
  end if;

  if p_dedupe_key is not null then
    select ne.id
    into v_event_id
    from public.notification_events ne
    where ne.business_id = p_business_id
      and ne.dedupe_key = p_dedupe_key
    limit 1;

    if v_event_id is not null then
      return v_event_id;
    end if;
  end if;

  insert into public.notification_events (
    business_id,
    user_id,
    actor_user_id,
    event_type,
    severity,
    title,
    body,
    entity_type,
    entity_id,
    metadata,
    dedupe_key
  ) values (
    p_business_id,
    p_user_id,
    p_actor_user_id,
    p_event_type,
    coalesce(nullif(trim(p_severity), ''), 'info'),
    trim(p_title),
    trim(p_body),
    nullif(trim(p_entity_type), ''),
    p_entity_id,
    coalesce(p_metadata, '{}'::jsonb),
    nullif(trim(p_dedupe_key), '')
  )
  on conflict (business_id, dedupe_key) where dedupe_key is not null
  do nothing
  returning id into v_event_id;

  if v_event_id is null and p_dedupe_key is not null then
    select ne.id
    into v_event_id
    from public.notification_events ne
    where ne.business_id = p_business_id
      and ne.dedupe_key = p_dedupe_key
    limit 1;
  end if;

  return v_event_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- list_notifications
-- ---------------------------------------------------------------------------

create or replace function public.list_notifications(
  p_business_id uuid,
  p_limit integer default 50,
  p_offset integer default 0,
  p_unread_only boolean default false
)
returns table (
  id uuid,
  business_id uuid,
  user_id uuid,
  actor_user_id uuid,
  event_type text,
  severity text,
  title text,
  body text,
  entity_type text,
  entity_id uuid,
  metadata jsonb,
  dedupe_key text,
  created_at timestamptz,
  is_read boolean,
  read_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  perform public._assert_business_owner(p_business_id);

  return query
  select
    ne.id,
    ne.business_id,
    ne.user_id,
    ne.actor_user_id,
    ne.event_type,
    ne.severity,
    ne.title,
    ne.body,
    ne.entity_type,
    ne.entity_id,
    ne.metadata,
    ne.dedupe_key,
    ne.created_at,
    nr.read_at is not null as is_read,
    nr.read_at
  from public.notification_events ne
  left join public.notification_reads nr
    on nr.notification_event_id = ne.id
    and nr.user_id = auth.uid()
  where ne.business_id = p_business_id
    and ne.user_id = auth.uid()
    and (
      not coalesce(p_unread_only, false)
      or nr.read_at is null
    )
  order by ne.created_at desc
  limit v_limit
  offset v_offset;
end;
$$;

-- ---------------------------------------------------------------------------
-- get_unread_notification_count
-- ---------------------------------------------------------------------------

create or replace function public.get_unread_notification_count(
  p_business_id uuid
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count bigint;
begin
  perform public._assert_business_owner(p_business_id);

  select count(*)
  into v_count
  from public.notification_events ne
  where ne.business_id = p_business_id
    and ne.user_id = auth.uid()
    and not exists (
      select 1
      from public.notification_reads nr
      where nr.notification_event_id = ne.id
        and nr.user_id = auth.uid()
    );

  return coalesce(v_count, 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- mark_notification_read
-- ---------------------------------------------------------------------------

create or replace function public.mark_notification_read(
  p_notification_event_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_notification_event_id is null then
    raise exception 'notification_event_id is required';
  end if;

  if not exists (
    select 1
    from public.notification_events ne
    where ne.id = p_notification_event_id
      and ne.user_id = auth.uid()
  ) then
    raise exception 'Notification not found or access denied';
  end if;

  perform public._assert_business_owner(
    (select ne.business_id from public.notification_events ne where ne.id = p_notification_event_id)
  );

  insert into public.notification_reads (notification_event_id, user_id)
  values (p_notification_event_id, auth.uid())
  on conflict (notification_event_id, user_id) do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- mark_all_notifications_read
-- ---------------------------------------------------------------------------

create or replace function public.mark_all_notifications_read(
  p_business_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer;
begin
  perform public._assert_business_owner(p_business_id);

  with unread as (
    select ne.id
    from public.notification_events ne
    where ne.business_id = p_business_id
      and ne.user_id = auth.uid()
      and not exists (
        select 1
        from public.notification_reads nr
        where nr.notification_event_id = ne.id
          and nr.user_id = auth.uid()
      )
  ),
  inserted as (
    insert into public.notification_reads (notification_event_id, user_id)
    select unread.id, auth.uid()
    from unread
    on conflict (notification_event_id, user_id) do nothing
    returning 1
  )
  select count(*)::integer into v_inserted from inserted;

  return coalesce(v_inserted, 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on function public.emit_notification_event(
  uuid, uuid, text, text, text, text, uuid, jsonb, text, text, uuid
) from public;
grant execute on function public.emit_notification_event(
  uuid, uuid, text, text, text, text, uuid, jsonb, text, text, uuid
) to service_role;

revoke all on function public.list_notifications(uuid, integer, integer, boolean) from public;
grant execute on function public.list_notifications(uuid, integer, integer, boolean) to authenticated;

revoke all on function public.get_unread_notification_count(uuid) from public;
grant execute on function public.get_unread_notification_count(uuid) to authenticated;

revoke all on function public.mark_notification_read(uuid) from public;
grant execute on function public.mark_notification_read(uuid) to authenticated;

revoke all on function public.mark_all_notifications_read(uuid) from public;
grant execute on function public.mark_all_notifications_read(uuid) to authenticated;

grant select on table public.notification_events to authenticated;
grant select, insert on table public.notification_reads to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.notification_events enable row level security;
alter table public.notification_reads enable row level security;

drop policy if exists "Owners can read own notification events" on public.notification_events;
create policy "Owners can read own notification events"
on public.notification_events
for select
using (auth.uid() = user_id);

drop policy if exists "Owners can read own notification reads" on public.notification_reads;
create policy "Owners can read own notification reads"
on public.notification_reads
for select
using (auth.uid() = user_id);

drop policy if exists "Owners can insert own notification reads" on public.notification_reads;
create policy "Owners can insert own notification reads"
on public.notification_reads
for insert
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.notification_events ne
    where ne.id = notification_event_id
      and ne.user_id = auth.uid()
  )
);
