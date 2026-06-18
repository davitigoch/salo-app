-- Google Calendar MVP foundation: connection storage, sync job queue, booking columns, enqueue triggers.
-- OAuth, worker, and UI are implemented in follow-up PRs.

-- ---------------------------------------------------------------------------
-- google_calendar_connections (one active connection per business)
-- ---------------------------------------------------------------------------

create table if not exists public.google_calendar_connections (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  google_account_email text,
  calendar_id text,
  refresh_token_encrypted text,
  sync_enabled boolean not null default true,
  connected_at timestamptz,
  disconnected_at timestamptz,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists google_calendar_connections_sync_enabled_idx
  on public.google_calendar_connections (sync_enabled)
  where disconnected_at is null;

alter table public.google_calendar_connections enable row level security;

drop policy if exists "Owners can read own google calendar connections" on public.google_calendar_connections;
create policy "Owners can read own google calendar connections"
on public.google_calendar_connections
for select
using (
  exists (
    select 1
    from public.businesses b
    where b.id = google_calendar_connections.business_id
      and b.owner_user_id = auth.uid()
  )
);

-- Writes are service-role only (OAuth edge functions). No owner insert/update/delete policies.

-- ---------------------------------------------------------------------------
-- calendar_sync_jobs (async queue for Google Calendar API worker)
-- ---------------------------------------------------------------------------

create table if not exists public.calendar_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete set null,
  operation text not null check (operation in ('create', 'update', 'delete')),
  event_type text not null check (event_type in (
    'booking_confirmed',
    'booking_rescheduled',
    'booking_cancelled',
    'booking_deleted'
  )),
  status text not null default 'pending' check (status in ('pending', 'processing', 'succeeded', 'failed')),
  retry_count integer not null default 0,
  max_retries integer not null default 5,
  next_attempt_at timestamptz not null default timezone('utc', now()),
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  queued_at timestamptz not null default timezone('utc', now()),
  processed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists calendar_sync_jobs_business_id_idx
  on public.calendar_sync_jobs (business_id);

create index if not exists calendar_sync_jobs_booking_id_idx
  on public.calendar_sync_jobs (booking_id);

create index if not exists calendar_sync_jobs_status_idx
  on public.calendar_sync_jobs (status);

create index if not exists calendar_sync_jobs_status_next_attempt_idx
  on public.calendar_sync_jobs (status, next_attempt_at);

create unique index if not exists calendar_sync_jobs_active_dedup_idx
  on public.calendar_sync_jobs (booking_id, operation)
  where status in ('pending', 'processing');

alter table public.calendar_sync_jobs enable row level security;

drop policy if exists "Owners can read own calendar sync jobs" on public.calendar_sync_jobs;
create policy "Owners can read own calendar sync jobs"
on public.calendar_sync_jobs
for select
using (
  exists (
    select 1
    from public.businesses b
    where b.id = calendar_sync_jobs.business_id
      and b.owner_user_id = auth.uid()
  )
);

-- Inserts/updates are performed by security-definer triggers and the service-role worker.

-- ---------------------------------------------------------------------------
-- bookings: Google Calendar sync state
-- ---------------------------------------------------------------------------

alter table public.bookings
  add column if not exists google_calendar_event_id text;

alter table public.bookings
  add column if not exists google_calendar_synced_at timestamptz;

alter table public.bookings
  add column if not exists google_calendar_last_error text;

create index if not exists bookings_google_calendar_event_id_idx
  on public.bookings (google_calendar_event_id)
  where google_calendar_event_id is not null;

-- ---------------------------------------------------------------------------
-- Queue helpers
-- ---------------------------------------------------------------------------

create or replace function public._has_active_google_calendar_connection(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.google_calendar_connections gcc
    where gcc.business_id = p_business_id
      and gcc.sync_enabled = true
      and gcc.disconnected_at is null
      and coalesce(length(trim(gcc.refresh_token_encrypted)), 0) > 0
  );
$$;

create or replace function public.enqueue_calendar_sync_job(
  p_business_id uuid,
  p_booking_id uuid,
  p_operation text,
  p_event_type text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_business_id is null or p_booking_id is null or p_operation is null or p_event_type is null then
    return;
  end if;

  if not public._has_active_google_calendar_connection(p_business_id) then
    return;
  end if;

  if exists (
    select 1
    from public.calendar_sync_jobs csj
    where csj.booking_id = p_booking_id
      and csj.operation = p_operation
      and csj.status in ('pending', 'processing')
  ) then
    return;
  end if;

  insert into public.calendar_sync_jobs (
    business_id,
    booking_id,
    operation,
    event_type,
    metadata
  ) values (
    p_business_id,
    p_booking_id,
    p_operation,
    p_event_type,
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

create or replace function public.enqueue_calendar_sync_jobs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  job_metadata jsonb;
begin
  if new.business_id is null then
    return new;
  end if;

  if not public._has_active_google_calendar_connection(new.business_id) then
    return new;
  end if;

  job_metadata := jsonb_build_object(
    'status', new.status,
    'date', new.date,
    'time', new.time,
    'client_name', new.client_name,
    'service', new.service,
    'booking_source', coalesce(new.booking_source, 'owner'),
    'google_calendar_event_id', new.google_calendar_event_id
  );

  if tg_op = 'INSERT' then
    if new.status = 'confirmed' then
      perform public.enqueue_calendar_sync_job(
        new.business_id,
        new.id,
        'create',
        'booking_confirmed',
        job_metadata
      );
    end if;

    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.status is distinct from new.status
      and new.status = 'confirmed'
      and coalesce(old.status, '') <> 'confirmed' then
      perform public.enqueue_calendar_sync_job(
        new.business_id,
        new.id,
        'create',
        'booking_confirmed',
        job_metadata
      );
    end if;

    if new.status = 'confirmed'
      and old.status = 'confirmed'
      and (
        old.date is distinct from new.date
        or old.time is distinct from new.time
      ) then
      perform public.enqueue_calendar_sync_job(
        new.business_id,
        new.id,
        'update',
        'booking_rescheduled',
        job_metadata || jsonb_build_object(
          'old_date', old.date,
          'old_time', old.time
        )
      );
    end if;

    if old.status is distinct from new.status
      and new.status = 'cancelled' then
      perform public.enqueue_calendar_sync_job(
        new.business_id,
        new.id,
        'delete',
        'booking_cancelled',
        job_metadata || jsonb_build_object(
          'old_status', old.status,
          'google_calendar_event_id', coalesce(new.google_calendar_event_id, old.google_calendar_event_id)
        )
      );
    end if;

    return new;
  end if;

  return new;
end;
$$;

create or replace function public.enqueue_calendar_sync_jobs_on_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  job_metadata jsonb;
begin
  if old.business_id is null then
    return old;
  end if;

  if not public._has_active_google_calendar_connection(old.business_id) then
    return old;
  end if;

  if coalesce(length(trim(old.google_calendar_event_id)), 0) = 0 then
    return old;
  end if;

  job_metadata := jsonb_build_object(
    'status', old.status,
    'date', old.date,
    'time', old.time,
    'client_name', old.client_name,
    'service', old.service,
    'booking_source', coalesce(old.booking_source, 'owner'),
    'google_calendar_event_id', old.google_calendar_event_id
  );

  perform public.enqueue_calendar_sync_job(
    old.business_id,
    old.id,
    'delete',
    'booking_deleted',
    job_metadata
  );

  return old;
end;
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

drop trigger if exists on_booking_calendar_sync_enqueue on public.bookings;
create trigger on_booking_calendar_sync_enqueue
after insert or update on public.bookings
for each row
execute function public.enqueue_calendar_sync_jobs();

drop trigger if exists on_booking_calendar_sync_delete_enqueue on public.bookings;
create trigger on_booking_calendar_sync_delete_enqueue
before delete on public.bookings
for each row
execute function public.enqueue_calendar_sync_jobs_on_delete();
