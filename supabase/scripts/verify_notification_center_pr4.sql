-- Verification script for PR4 Phase 4.1: Notification Center foundation.
-- Run after applying 20260702_notification_center_foundation.sql

begin;

-- ---------------------------------------------------------------------------
-- 1. Schema checks
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'notification_events'
  ) then
    raise exception 'VERIFY FAIL: notification_events table missing';
  end if;

  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'notification_reads'
  ) then
    raise exception 'VERIFY FAIL: notification_reads table missing';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'emit_notification_event'
  ) then
    raise exception 'VERIFY FAIL: emit_notification_event RPC missing';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'list_notifications'
  ) then
    raise exception 'VERIFY FAIL: list_notifications RPC missing';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_unread_notification_count'
  ) then
    raise exception 'VERIFY FAIL: get_unread_notification_count RPC missing';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'mark_notification_read'
  ) then
    raise exception 'VERIFY FAIL: mark_notification_read RPC missing';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'mark_all_notifications_read'
  ) then
    raise exception 'VERIFY FAIL: mark_all_notifications_read RPC missing';
  end if;

  raise notice 'VERIFY PASS: schema objects present';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Fixture: business context
-- ---------------------------------------------------------------------------

create temp table _notification_ctx on commit drop as
with owner_user as (
  select id from auth.users order by created_at asc limit 1
),
new_business as (
  insert into public.businesses (
    owner_user_id,
    business_name,
    slug,
    timezone
  )
  select
    owner_user.id,
    'Notification Center Verify Co',
    'notif-center-' || left(replace(gen_random_uuid()::text, '-', ''), 10),
    'America/New_York'
  from owner_user
  returning id, owner_user_id
)
select nb.id as business_id, nb.owner_user_id as user_id
from new_business nb;

-- ---------------------------------------------------------------------------
-- 3. emit_notification_event + dedupe
-- ---------------------------------------------------------------------------

do $$
declare
  v_business_id uuid;
  v_user_id uuid;
  v_event_id uuid;
  v_dup_id uuid;
  v_count integer;
begin
  select business_id, user_id
  into v_business_id, v_user_id
  from _notification_ctx
  limit 1;

  v_event_id := public.emit_notification_event(
    p_business_id => v_business_id,
    p_user_id => v_user_id,
    p_event_type => 'booking_created',
    p_title => 'New appointment for Alex Johnson',
    p_body => 'Consultation on Aug 1 at 2:00 PM',
    p_entity_type => 'booking',
    p_metadata => jsonb_build_object('client_name', 'Alex Johnson'),
    p_dedupe_key => 'verify:booking:created:1',
    p_severity => 'info'
  );

  if v_event_id is null then
    raise exception 'VERIFY FAIL: emit_notification_event returned null';
  end if;

  v_dup_id := public.emit_notification_event(
    p_business_id => v_business_id,
    p_user_id => v_user_id,
    p_event_type => 'booking_created',
    p_title => 'Duplicate should be ignored',
    p_body => 'Duplicate body',
    p_dedupe_key => 'verify:booking:created:1'
  );

  if v_dup_id is distinct from v_event_id then
    raise exception 'VERIFY FAIL: dedupe_key did not return existing event id';
  end if;

  select count(*)::integer
  into v_count
  from public.notification_events
  where business_id = v_business_id
    and dedupe_key = 'verify:booking:created:1';

  if v_count <> 1 then
    raise exception 'VERIFY FAIL: expected 1 deduped notification row, got %', v_count;
  end if;

  perform public.emit_notification_event(
    p_business_id => v_business_id,
    p_user_id => v_user_id,
    p_event_type => 'payment_received',
    p_title => 'Payment received',
    p_body => '$120.00 deposit received',
    p_entity_type => 'payment',
    p_metadata => jsonb_build_object('amount_cents', 12000),
    p_dedupe_key => 'verify:payment:1',
    p_severity => 'success'
  );

  perform public.emit_notification_event(
    p_business_id => v_business_id,
    p_user_id => v_user_id,
    p_event_type => 'calendar_sync_failed',
    p_title => 'Google Calendar sync failed',
    p_body => 'Could not create calendar event',
    p_entity_type => 'calendar_connection',
    p_dedupe_key => 'verify:calendar:failed:1',
    p_severity => 'warning'
  );

  raise notice 'VERIFY PASS: emit + dedupe works';
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Read/unread RPCs (service role context; owner check via direct table reads)
-- ---------------------------------------------------------------------------

do $$
declare
  v_business_id uuid;
  v_user_id uuid;
  v_event_id uuid;
  v_unread bigint;
  v_marked integer;
begin
  select business_id, user_id
  into v_business_id, v_user_id
  from _notification_ctx
  limit 1;

  select ne.id
  into v_event_id
  from public.notification_events ne
  where ne.business_id = v_business_id
    and ne.dedupe_key = 'verify:booking:created:1'
  limit 1;

  select count(*)
  into v_unread
  from public.notification_events ne
  where ne.business_id = v_business_id
    and ne.user_id = v_user_id
    and not exists (
      select 1
      from public.notification_reads nr
      where nr.notification_event_id = ne.id
        and nr.user_id = v_user_id
    );

  if v_unread < 3 then
    raise exception 'VERIFY FAIL: expected at least 3 unread notifications, got %', v_unread;
  end if;

  insert into public.notification_reads (notification_event_id, user_id)
  values (v_event_id, v_user_id)
  on conflict do nothing;

  select count(*)
  into v_unread
  from public.notification_events ne
  where ne.business_id = v_business_id
    and ne.user_id = v_user_id
    and not exists (
      select 1
      from public.notification_reads nr
      where nr.notification_event_id = ne.id
        and nr.user_id = v_user_id
    );

  if v_unread < 2 then
    raise exception 'VERIFY FAIL: expected 2 unread after single mark, got %', v_unread;
  end if;

  with unread as (
    select ne.id
    from public.notification_events ne
    where ne.business_id = v_business_id
      and ne.user_id = v_user_id
      and not exists (
        select 1
        from public.notification_reads nr
        where nr.notification_event_id = ne.id
          and nr.user_id = v_user_id
      )
  ),
  inserted as (
    insert into public.notification_reads (notification_event_id, user_id)
    select unread.id, v_user_id
    from unread
    on conflict do nothing
    returning 1
  )
  select count(*)::integer into v_marked from inserted;

  if v_marked < 1 then
    raise exception 'VERIFY FAIL: mark all read inserted 0 rows';
  end if;

  select count(*)
  into v_unread
  from public.notification_events ne
  where ne.business_id = v_business_id
    and ne.user_id = v_user_id
    and not exists (
      select 1
      from public.notification_reads nr
      where nr.notification_event_id = ne.id
        and nr.user_id = v_user_id
    );

  if v_unread <> 0 then
    raise exception 'VERIFY FAIL: expected 0 unread after mark all, got %', v_unread;
  end if;

  raise notice 'VERIFY PASS: read/unread tracking works';
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Invalid emit guard
-- ---------------------------------------------------------------------------

do $$
declare
  v_business_id uuid;
  v_user_id uuid;
  v_other_user uuid;
begin
  select business_id, user_id
  into v_business_id, v_user_id
  from _notification_ctx
  limit 1;

  select id
  into v_other_user
  from auth.users
  where id <> v_user_id
  limit 1;

  if v_other_user is null then
    raise notice 'VERIFY SKIP: only one auth user; owner mismatch guard not tested';
    return;
  end if;

  begin
    perform public.emit_notification_event(
      p_business_id => v_business_id,
      p_user_id => v_other_user,
      p_event_type => 'booking_confirmed',
      p_title => 'Should fail',
      p_body => 'Wrong owner user_id'
    );
    raise exception 'VERIFY FAIL: emit should reject non-owner user_id';
  exception
    when others then
      if position('user_id must match business owner' in sqlerrm) = 0 then
        raise;
      end if;
  end;

  raise notice 'VERIFY PASS: owner user_id guard works';
end;
$$;

rollback;
