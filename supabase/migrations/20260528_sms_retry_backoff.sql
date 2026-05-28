-- SMS retry/backoff migration for existing SALO projects

alter table if exists public.sms_notifications add column if not exists status text;
alter table if exists public.sms_notifications add column if not exists retry_count integer;
alter table if exists public.sms_notifications add column if not exists max_retries integer;
alter table if exists public.sms_notifications add column if not exists next_attempt_at timestamptz;
alter table if exists public.sms_notifications add column if not exists last_error text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'sms_notifications'
      and c.column_name = 'delivery_status'
  ) then
    execute '
      update public.sms_notifications
      set status = case
        when coalesce(delivery_status, ''pending'') = ''sent'' then ''sent''
        when coalesce(delivery_status, ''pending'') = ''pending'' then ''pending''
        else ''failed''
      end
      where status is null
    ';
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'sms_notifications'
      and c.column_name = 'attempt_count'
  ) then
    execute '
      update public.sms_notifications
      set retry_count = coalesce(attempt_count, 0)
      where retry_count is null
    ';
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'sms_notifications'
      and c.column_name = 'error_message'
  ) then
    execute '
      update public.sms_notifications
      set last_error = error_message
      where last_error is null
    ';
  end if;
end;
$$;

update public.sms_notifications
set status = 'pending'
where status is null;

update public.sms_notifications
set retry_count = 0
where retry_count is null;

update public.sms_notifications
set max_retries = 5
where max_retries is null;

update public.sms_notifications
set next_attempt_at = coalesce(queued_at, timezone('utc', now()))
where next_attempt_at is null;

alter table public.sms_notifications
  alter column status set default 'pending',
  alter column status set not null,
  alter column retry_count set default 0,
  alter column retry_count set not null,
  alter column max_retries set default 5,
  alter column max_retries set not null,
  alter column next_attempt_at set default timezone('utc', now()),
  alter column next_attempt_at set not null;

alter table public.sms_notifications
  drop constraint if exists sms_notifications_status_check;

alter table public.sms_notifications
  add constraint sms_notifications_status_check
  check (status in ('pending', 'sent', 'failed'));

drop index if exists public.sms_notifications_delivery_status_idx;
create index if not exists sms_notifications_status_idx on public.sms_notifications (status);
create index if not exists sms_notifications_status_next_attempt_idx on public.sms_notifications (status, next_attempt_at);
