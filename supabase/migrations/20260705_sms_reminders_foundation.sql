-- SMS Reminders foundation: sms_notifications table, queue triggers, claim RPC.
-- Default provider mock; Twilio optional via send-sms-notifications worker.

-- ---------------------------------------------------------------------------
-- sms_notifications table (create or evolve)
-- ---------------------------------------------------------------------------

create table if not exists public.sms_notifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  phone_number text not null,
  message_body text,
  notification_type text not null,
  status text not null default 'queued',
  provider text not null default 'mock',
  provider_message_id text,
  last_error text,
  scheduled_for timestamptz not null default timezone('utc', now()),
  sent_at timestamptz,
  delivered_at timestamptz,
  retry_count integer not null default 0,
  max_retries integer not null default 5,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.sms_notifications
  add column if not exists client_id uuid references public.clients(id) on delete set null;

alter table public.sms_notifications
  add column if not exists phone_number text;

alter table public.sms_notifications
  add column if not exists notification_type text;

alter table public.sms_notifications
  add column if not exists provider text;

alter table public.sms_notifications
  add column if not exists provider_message_id text;

alter table public.sms_notifications
  add column if not exists scheduled_for timestamptz;

alter table public.sms_notifications
  add column if not exists delivered_at timestamptz;

alter table public.sms_notifications
  add column if not exists retry_count integer;

alter table public.sms_notifications
  add column if not exists max_retries integer;

-- Legacy column backfill
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sms_notifications' and column_name = 'customer_phone'
  ) then
    execute $sql$
      update public.sms_notifications
      set phone_number = customer_phone
      where coalesce(trim(phone_number), '') = ''
        and coalesce(trim(customer_phone), '') <> ''
    $sql$;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sms_notifications' and column_name = 'event_type'
  ) then
    execute $sql$
      update public.sms_notifications
      set notification_type = event_type
      where notification_type is null
    $sql$;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sms_notifications' and column_name = 'twilio_message_sid'
  ) then
    execute $sql$
      update public.sms_notifications
      set provider_message_id = twilio_message_sid
      where provider_message_id is null and twilio_message_sid is not null
    $sql$;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sms_notifications' and column_name = 'next_attempt_at'
  ) then
    execute $sql$
      update public.sms_notifications
      set scheduled_for = next_attempt_at
      where scheduled_for is null
    $sql$;
  end if;
end;
$$;

update public.sms_notifications
set status = case
  when status = 'pending' then 'queued'
  else status
end
where status is not null;

update public.sms_notifications
set provider = coalesce(nullif(trim(provider), ''), 'mock')
where provider is null or trim(provider) = '';

update public.sms_notifications
set scheduled_for = timezone('utc', now())
where scheduled_for is null;

update public.sms_notifications
set retry_count = 0
where retry_count is null;

update public.sms_notifications
set max_retries = 5
where max_retries is null;

update public.sms_notifications
set notification_type = 'booking_confirmed'
where notification_type = 'booking_created';

delete from public.sms_notifications
where notification_type is null
   or notification_type not in (
     'booking_confirmed',
     'booking_rescheduled',
     'booking_cancelled',
     'reminder_24h',
     'reminder_2h'
   );

alter table public.sms_notifications
  alter column phone_number set not null,
  alter column notification_type set not null,
  alter column status set default 'queued',
  alter column status set not null,
  alter column provider set default 'mock',
  alter column provider set not null,
  alter column scheduled_for set default timezone('utc', now()),
  alter column scheduled_for set not null,
  alter column retry_count set default 0,
  alter column retry_count set not null,
  alter column max_retries set default 5,
  alter column max_retries set not null;

alter table public.sms_notifications
  drop constraint if exists sms_notifications_event_type_check;

alter table public.sms_notifications
  drop constraint if exists sms_notifications_status_check;

alter table public.sms_notifications
  drop constraint if exists sms_notifications_provider_check;

alter table public.sms_notifications
  drop constraint if exists sms_notifications_notification_type_check;

alter table public.sms_notifications
  add constraint sms_notifications_notification_type_check
  check (notification_type in (
    'booking_confirmed',
    'booking_rescheduled',
    'booking_cancelled',
    'reminder_24h',
    'reminder_2h'
  ));

alter table public.sms_notifications
  add constraint sms_notifications_status_check
  check (status in ('queued', 'sent', 'failed', 'delivered', 'skipped'));

alter table public.sms_notifications
  add constraint sms_notifications_provider_check
  check (provider in ('mock', 'twilio'));

create index if not exists sms_notifications_business_id_idx
  on public.sms_notifications (business_id);

create index if not exists sms_notifications_booking_id_idx
  on public.sms_notifications (booking_id);

create index if not exists sms_notifications_status_scheduled_idx
  on public.sms_notifications (status, scheduled_for);

create index if not exists sms_notifications_notification_type_idx
  on public.sms_notifications (notification_type);

create unique index if not exists sms_notifications_active_immediate_dedup_idx
  on public.sms_notifications (booking_id, notification_type)
  where status in ('queued', 'sent')
    and notification_type in ('booking_confirmed', 'booking_rescheduled', 'booking_cancelled');

create unique index if not exists sms_notifications_active_reminder_dedup_idx
  on public.sms_notifications (booking_id, notification_type, scheduled_for)
  where status in ('queued', 'sent')
    and notification_type in ('reminder_24h', 'reminder_2h');

-- ---------------------------------------------------------------------------
-- notification_preferences: reminder toggles
-- ---------------------------------------------------------------------------

alter table public.notification_preferences
  add column if not exists send_reminder_24h_sms boolean not null default true;

alter table public.notification_preferences
  add column if not exists send_reminder_2h_sms boolean not null default true;

-- ---------------------------------------------------------------------------
-- Queue helpers
-- ---------------------------------------------------------------------------

create or replace function public.skip_queued_sms_reminders(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_booking_id is null then
    return;
  end if;

  update public.sms_notifications
  set
    status = 'skipped',
    updated_at = timezone('utc', now())
  where booking_id = p_booking_id
    and notification_type in ('reminder_24h', 'reminder_2h')
    and status = 'queued';
end;
$$;

create or replace function public.enqueue_sms_notification(
  p_business_id uuid,
  p_booking_id uuid,
  p_client_id uuid,
  p_phone_number text,
  p_notification_type text,
  p_scheduled_for timestamptz default timezone('utc', now()),
  p_message_body text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_business_id is null or p_booking_id is null then
    return null;
  end if;

  if coalesce(trim(p_phone_number), '') = '' then
    return null;
  end if;

  if p_scheduled_for is null then
    p_scheduled_for := timezone('utc', now());
  end if;

  if p_notification_type in ('booking_confirmed', 'booking_rescheduled', 'booking_cancelled') then
    select sn.id
    into v_id
    from public.sms_notifications sn
    where sn.booking_id = p_booking_id
      and sn.notification_type = p_notification_type
      and sn.status in ('queued', 'sent')
    limit 1;

    if v_id is not null then
      return v_id;
    end if;
  elsif p_notification_type in ('reminder_24h', 'reminder_2h') then
    select sn.id
    into v_id
    from public.sms_notifications sn
    where sn.booking_id = p_booking_id
      and sn.notification_type = p_notification_type
      and sn.scheduled_for = p_scheduled_for
      and sn.status in ('queued', 'sent')
    limit 1;

    if v_id is not null then
      return v_id;
    end if;
  end if;

  insert into public.sms_notifications (
    business_id,
    booking_id,
    client_id,
    phone_number,
    message_body,
    notification_type,
    status,
    provider,
    scheduled_for,
    metadata
  ) values (
    p_business_id,
    p_booking_id,
    p_client_id,
    trim(p_phone_number),
    nullif(trim(p_message_body), ''),
    p_notification_type,
    'queued',
    'mock',
    p_scheduled_for,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.schedule_booking_sms_reminders(
  p_booking public.bookings,
  p_prefs public.notification_preferences,
  p_timezone text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appointment_at timestamptz;
  v_reminder_24h timestamptz;
  v_reminder_2h timestamptz;
begin
  if p_booking.id is null or coalesce(trim(p_booking.customer_phone), '') = '' then
    return;
  end if;

  if p_booking.status not in ('pending', 'confirmed') then
    return;
  end if;

  perform public.skip_queued_sms_reminders(p_booking.id);

  v_appointment_at := public.parse_booking_local_timestamp(
    p_timezone,
    p_booking.date,
    p_booking.time
  );

  if v_appointment_at is null then
    return;
  end if;

  v_reminder_24h := v_appointment_at - interval '24 hours';
  v_reminder_2h := v_appointment_at - interval '2 hours';

  if coalesce(p_prefs.send_reminder_24h_sms, true)
    and v_reminder_24h > timezone('utc', now()) then
    perform public.enqueue_sms_notification(
      p_booking.business_id,
      p_booking.id,
      p_booking.client_id,
      p_booking.customer_phone,
      'reminder_24h',
      v_reminder_24h,
      null,
      jsonb_build_object('appointment_at', v_appointment_at)
    );
  end if;

  if coalesce(p_prefs.send_reminder_2h_sms, true)
    and v_reminder_2h > timezone('utc', now()) then
    perform public.enqueue_sms_notification(
      p_booking.business_id,
      p_booking.id,
      p_booking.client_id,
      p_booking.customer_phone,
      'reminder_2h',
      v_reminder_2h,
      null,
      jsonb_build_object('appointment_at', v_appointment_at)
    );
  end if;
end;
$$;

create or replace function public.enqueue_sms_notifications_from_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  prefs record;
  business_tz text;
  phone_present boolean;
begin
  if new.business_id is null then
    return new;
  end if;

  phone_present := coalesce(trim(new.customer_phone), '') <> '';

  insert into public.notification_preferences (business_id)
  values (new.business_id)
  on conflict (business_id) do nothing;

  select *
  into prefs
  from public.notification_preferences
  where business_id = new.business_id;

  select coalesce(nullif(trim(b.timezone), ''), 'UTC')
  into business_tz
  from public.businesses b
  where b.id = new.business_id;

  if not found or prefs.enable_customer_sms = false or not phone_present then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status = 'confirmed' and prefs.send_status_update_sms then
      perform public.enqueue_sms_notification(
        new.business_id,
        new.id,
        new.client_id,
        new.customer_phone,
        'booking_confirmed',
        timezone('utc', now()),
        null,
        jsonb_build_object('booking_source', coalesce(new.booking_source, 'owner'))
      );
      perform public.schedule_booking_sms_reminders(new, prefs, business_tz);
    end if;

    return new;
  end if;

  if tg_op = 'UPDATE' then
    if prefs.send_status_update_sms
      and ((old.date is distinct from new.date) or (old.time is distinct from new.time)) then
      perform public.enqueue_sms_notification(
        new.business_id,
        new.id,
        new.client_id,
        new.customer_phone,
        'booking_rescheduled',
        timezone('utc', now()),
        null,
        jsonb_build_object(
          'old_date', old.date,
          'old_time', old.time,
          'new_date', new.date,
          'new_time', new.time
        )
      );
      perform public.schedule_booking_sms_reminders(new, prefs, business_tz);
    end if;

    if prefs.send_status_update_sms
      and old.status is distinct from new.status
      and new.status = 'confirmed' then
      perform public.enqueue_sms_notification(
        new.business_id,
        new.id,
        new.client_id,
        new.customer_phone,
        'booking_confirmed',
        timezone('utc', now()),
        null,
        jsonb_build_object('old_status', old.status, 'new_status', new.status)
      );
      perform public.schedule_booking_sms_reminders(new, prefs, business_tz);
    end if;

    if prefs.send_status_update_sms
      and old.status is distinct from new.status
      and new.status = 'cancelled' then
      perform public.skip_queued_sms_reminders(new.id);
      perform public.enqueue_sms_notification(
        new.business_id,
        new.id,
        new.client_id,
        new.customer_phone,
        'booking_cancelled',
        timezone('utc', now()),
        null,
        jsonb_build_object('old_status', old.status, 'new_status', new.status)
      );
    end if;

    if old.status is distinct from new.status
      and new.status = 'cancelled' then
      perform public.skip_queued_sms_reminders(new.id);
    end if;

    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists on_booking_sms_notification_enqueue on public.bookings;
drop trigger if exists on_booking_sms_notifications_enqueue on public.bookings;

create trigger on_booking_sms_notifications_enqueue
after insert or update on public.bookings
for each row
execute procedure public.enqueue_sms_notifications_from_booking();

-- ---------------------------------------------------------------------------
-- Worker claim RPC
-- ---------------------------------------------------------------------------

create or replace function public.claim_sms_notifications(
  p_limit integer default 20
)
returns setof public.sms_notifications
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with picked as (
    select sn.id
    from public.sms_notifications sn
    where sn.status = 'queued'
      and sn.scheduled_for <= timezone('utc', now())
    order by sn.scheduled_for asc, sn.created_at asc
    limit greatest(1, least(coalesce(p_limit, 20), 100))
    for update skip locked
  )
  update public.sms_notifications sn
  set
    updated_at = timezone('utc', now())
  from picked
  where sn.id = picked.id
  returning sn.*;
end;
$$;

revoke all on function public.claim_sms_notifications(integer) from public;
grant execute on function public.claim_sms_notifications(integer) to service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.sms_notifications enable row level security;

drop policy if exists "Owners can read own sms notifications" on public.sms_notifications;
create policy "Owners can read own sms notifications"
on public.sms_notifications
for select
using (
  exists (
    select 1
    from public.businesses b
    where b.id = business_id
      and b.owner_user_id = auth.uid()
  )
);

drop policy if exists "Owners can insert own sms notifications" on public.sms_notifications;
create policy "Owners can insert own sms notifications"
on public.sms_notifications
for insert
with check (
  exists (
    select 1
    from public.businesses b
    where b.id = business_id
      and b.owner_user_id = auth.uid()
  )
);

drop policy if exists "Owners can update own sms notifications" on public.sms_notifications;
create policy "Owners can update own sms notifications"
on public.sms_notifications
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

-- ---------------------------------------------------------------------------
-- Notification center failure trigger (new column names)
-- ---------------------------------------------------------------------------

create or replace function public.emit_sms_delivery_failed_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_user_id uuid;
  v_client_name text;
  v_title text;
  v_body text;
  v_metadata jsonb;
begin
  if new.status <> 'failed' or new.business_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status = 'failed' then
    return new;
  end if;

  select b.owner_user_id
  into v_owner_user_id
  from public.businesses b
  where b.id = new.business_id;

  if v_owner_user_id is null then
    return new;
  end if;

  select coalesce(nullif(trim(bk.client_name), ''), 'Client')
  into v_client_name
  from public.bookings bk
  where bk.id = new.booking_id;

  v_title := 'SMS could not be delivered';
  v_body := 'Client SMS for ' || v_client_name || ' failed to send.';

  v_metadata := jsonb_build_object(
    'booking_id', new.booking_id,
    'client_name', v_client_name,
    'channel', 'sms',
    'sms_notification_id', new.id,
    'notification_type', new.notification_type,
    'phone_number', new.phone_number,
    'error_summary', coalesce(new.last_error, 'Delivery failed')
  );

  perform public.emit_notification_event(
    p_business_id => new.business_id,
    p_user_id => v_owner_user_id,
    p_event_type => 'message_delivery_failed',
    p_title => v_title,
    p_body => v_body,
    p_entity_type => 'booking',
    p_entity_id => new.booking_id,
    p_metadata => v_metadata,
    p_dedupe_key => 'sms:' || new.id::text || ':failed',
    p_severity => 'warning'
  );

  return new;
end;
$$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'sms_notifications'
  ) then
    execute 'drop trigger if exists on_sms_delivery_failed_notification on public.sms_notifications';
    execute '
      create trigger on_sms_delivery_failed_notification
      after insert or update on public.sms_notifications
      for each row
      execute procedure public.emit_sms_delivery_failed_notification()
    ';
  end if;
end;
$$;

-- Attach notification center failure trigger (replaces conditional 4.2 block)
