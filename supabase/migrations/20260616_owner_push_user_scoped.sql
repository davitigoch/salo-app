-- Owner push notifications scoped to auth.users + bookings only.
-- Does not require public.businesses or public.notification_preferences.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'bookings'
  ) then
    raise exception 'Required table public.bookings does not exist.';
  end if;
end;
$$;

create table if not exists public.owner_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  expo_push_token text not null,
  device_name text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, expo_push_token)
);

create index if not exists owner_push_tokens_user_id_idx on public.owner_push_tokens (user_id);

alter table public.owner_push_tokens enable row level security;

drop policy if exists "Owners can read own push tokens" on public.owner_push_tokens;
create policy "Owners can read own push tokens"
on public.owner_push_tokens
for select
using (auth.uid() = user_id);

drop policy if exists "Owners can insert own push tokens" on public.owner_push_tokens;
create policy "Owners can insert own push tokens"
on public.owner_push_tokens
for insert
with check (auth.uid() = user_id);

drop policy if exists "Owners can update own push tokens" on public.owner_push_tokens;
create policy "Owners can update own push tokens"
on public.owner_push_tokens
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Owners can delete own push tokens" on public.owner_push_tokens;
create policy "Owners can delete own push tokens"
on public.owner_push_tokens
for delete
using (auth.uid() = user_id);

create table if not exists public.owner_push_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  event_type text not null,
  title text not null,
  body text not null,
  push_data jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  retry_count integer not null default 0,
  max_retries integer not null default 5,
  next_attempt_at timestamptz not null default timezone('utc', now()),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table if exists public.owner_push_notifications
  drop constraint if exists owner_push_notifications_business_id_fkey;

create index if not exists owner_push_notifications_user_id_idx on public.owner_push_notifications (user_id);
create index if not exists owner_push_notifications_booking_id_idx on public.owner_push_notifications (booking_id);
create index if not exists owner_push_notifications_status_idx on public.owner_push_notifications (status);
create index if not exists owner_push_notifications_status_next_attempt_idx
  on public.owner_push_notifications (status, next_attempt_at);

create unique index if not exists owner_push_notifications_active_dedup_idx
  on public.owner_push_notifications (booking_id, event_type)
  where status in ('pending', 'sent');

alter table public.owner_push_notifications
  drop constraint if exists owner_push_notifications_status_check;

alter table public.owner_push_notifications
  add constraint owner_push_notifications_status_check
  check (status in ('pending', 'sent', 'failed'));

alter table public.owner_push_notifications enable row level security;

drop policy if exists "Owners can read own push notifications" on public.owner_push_notifications;
create policy "Owners can read own push notifications"
on public.owner_push_notifications
for select
using (auth.uid() = user_id);

create or replace function public._format_owner_push_date(p_date text)
returns text
language plpgsql
immutable
as $$
declare
  parsed date;
begin
  if p_date is null or trim(p_date) = '' then
    return 'Unknown date';
  end if;

  parsed := to_date(p_date, 'YYYY-MM-DD');
  return to_char(parsed, 'Mon DD');
exception
  when others then
    return p_date;
end;
$$;

create or replace function public._format_owner_push_time(p_time text)
returns text
language plpgsql
immutable
as $$
declare
  parts text[];
  hour24 integer;
  minute_text text;
  suffix text;
  hour12 integer;
begin
  if p_time is null or trim(p_time) = '' then
    return '--:--';
  end if;

  parts := string_to_array(p_time, ':');
  if array_length(parts, 1) < 2 then
    return p_time;
  end if;

  hour24 := parts[1]::integer;
  minute_text := lpad(parts[2], 2, '0');
  suffix := case when hour24 >= 12 then 'PM' else 'AM' end;
  hour12 := case
    when hour24 % 12 = 0 then 12
    else hour24 % 12
  end;

  return hour12::text || ':' || minute_text || ' ' || suffix;
exception
  when others then
    return p_time;
end;
$$;

create or replace function public.enqueue_owner_push_notification(
  p_user_id uuid,
  p_booking_id uuid,
  p_event_type text,
  p_title text,
  p_body text,
  p_push_data jsonb default '{}'::jsonb,
  p_business_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null or p_booking_id is null or p_event_type is null then
    return;
  end if;

  if exists (
    select 1
    from public.owner_push_notifications
    where booking_id = p_booking_id
      and event_type = p_event_type
      and status in ('pending', 'sent')
  ) then
    return;
  end if;

  insert into public.owner_push_notifications (
    user_id,
    business_id,
    booking_id,
    event_type,
    title,
    body,
    push_data
  ) values (
    p_user_id,
    p_business_id,
    p_booking_id,
    p_event_type,
    p_title,
    p_body,
    coalesce(p_push_data, '{}'::jsonb)
  );
end;
$$;

do $$
declare
  has_booking_source boolean;
  has_booking_business_id boolean;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'bookings'
      and column_name = 'booking_source'
  ) into has_booking_source;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'bookings'
      and column_name = 'business_id'
  ) into has_booking_business_id;

  if has_booking_source and has_booking_business_id then
    execute $fn$
      create or replace function public.enqueue_owner_push_notifications()
      returns trigger
      language plpgsql
      security definer
      set search_path = public
      as $body$
      declare
        formatted_date text;
        formatted_time text;
        push_title text;
        push_body text;
        is_public_booking boolean;
      begin
        if new.user_id is null then
          return new;
        end if;

        formatted_date := public._format_owner_push_date(new.date);
        formatted_time := public._format_owner_push_time(new.time);
        is_public_booking := coalesce(new.booking_source, 'owner') = 'public';

        if tg_op = 'INSERT' then
          if is_public_booking and new.status = 'pending' then
            push_title := 'New booking request';
            push_body := new.client_name || ' requested ' || new.service
              || ' on ' || formatted_date || ' at ' || formatted_time;

            perform public.enqueue_owner_push_notification(
              new.user_id,
              new.id,
              'public_booking_request',
              push_title,
              push_body,
              jsonb_build_object(
                'bookingId', new.id,
                'eventType', 'public_booking_request',
                'type', 'owner-booking-event'
              ),
              new.business_id
            );
          end if;

          return new;
        end if;

        if tg_op = 'UPDATE' then
          if (old.date is distinct from new.date) or (old.time is distinct from new.time) then
            push_title := 'Booking rescheduled';
            push_body := new.client_name || ' moved ' || new.service
              || ' to ' || formatted_date || ' at ' || formatted_time;

            perform public.enqueue_owner_push_notification(
              new.user_id,
              new.id,
              'booking_rescheduled',
              push_title,
              push_body,
              jsonb_build_object(
                'bookingId', new.id,
                'eventType', 'booking_rescheduled',
                'type', 'owner-booking-event'
              ),
              new.business_id
            );
          end if;

          if old.status is distinct from new.status and new.status = 'cancelled' then
            push_title := 'Booking cancelled';
            push_body := new.client_name || ' cancelled ' || new.service
              || ' on ' || formatted_date || ' at ' || formatted_time;

            perform public.enqueue_owner_push_notification(
              new.user_id,
              new.id,
              'booking_cancelled',
              push_title,
              push_body,
              jsonb_build_object(
                'bookingId', new.id,
                'eventType', 'booking_cancelled',
                'type', 'owner-booking-event'
              ),
              new.business_id
            );
          end if;

          return new;
        end if;

        return new;
      end;
      $body$;
    $fn$;
  elsif has_booking_source then
    execute $fn$
      create or replace function public.enqueue_owner_push_notifications()
      returns trigger
      language plpgsql
      security definer
      set search_path = public
      as $body$
      declare
        formatted_date text;
        formatted_time text;
        push_title text;
        push_body text;
        is_public_booking boolean;
      begin
        if new.user_id is null then
          return new;
        end if;

        formatted_date := public._format_owner_push_date(new.date);
        formatted_time := public._format_owner_push_time(new.time);
        is_public_booking := coalesce(new.booking_source, 'owner') = 'public';

        if tg_op = 'INSERT' then
          if is_public_booking and new.status = 'pending' then
            push_title := 'New booking request';
            push_body := new.client_name || ' requested ' || new.service
              || ' on ' || formatted_date || ' at ' || formatted_time;

            perform public.enqueue_owner_push_notification(
              new.user_id,
              new.id,
              'public_booking_request',
              push_title,
              push_body,
              jsonb_build_object(
                'bookingId', new.id,
                'eventType', 'public_booking_request',
                'type', 'owner-booking-event'
              ),
              null
            );
          end if;

          return new;
        end if;

        if tg_op = 'UPDATE' then
          if (old.date is distinct from new.date) or (old.time is distinct from new.time) then
            push_title := 'Booking rescheduled';
            push_body := new.client_name || ' moved ' || new.service
              || ' to ' || formatted_date || ' at ' || formatted_time;

            perform public.enqueue_owner_push_notification(
              new.user_id,
              new.id,
              'booking_rescheduled',
              push_title,
              push_body,
              jsonb_build_object(
                'bookingId', new.id,
                'eventType', 'booking_rescheduled',
                'type', 'owner-booking-event'
              ),
              null
            );
          end if;

          if old.status is distinct from new.status and new.status = 'cancelled' then
            push_title := 'Booking cancelled';
            push_body := new.client_name || ' cancelled ' || new.service
              || ' on ' || formatted_date || ' at ' || formatted_time;

            perform public.enqueue_owner_push_notification(
              new.user_id,
              new.id,
              'booking_cancelled',
              push_title,
              push_body,
              jsonb_build_object(
                'bookingId', new.id,
                'eventType', 'booking_cancelled',
                'type', 'owner-booking-event'
              ),
              null
            );
          end if;

          return new;
        end if;

        return new;
      end;
      $body$;
    $fn$;
  else
    execute $fn$
      create or replace function public.enqueue_owner_push_notifications()
      returns trigger
      language plpgsql
      security definer
      set search_path = public
      as $body$
      declare
        formatted_date text;
        formatted_time text;
        push_title text;
        push_body text;
      begin
        if new.user_id is null then
          return new;
        end if;

        formatted_date := public._format_owner_push_date(new.date);
        formatted_time := public._format_owner_push_time(new.time);

        if tg_op = 'INSERT' and new.status = 'pending' then
          push_title := 'New booking request';
          push_body := new.client_name || ' requested ' || new.service
            || ' on ' || formatted_date || ' at ' || formatted_time;

          perform public.enqueue_owner_push_notification(
            new.user_id,
            new.id,
            'public_booking_request',
            push_title,
            push_body,
            jsonb_build_object(
              'bookingId', new.id,
              'eventType', 'public_booking_request',
              'type', 'owner-booking-event'
            ),
            null
          );
        end if;

        if tg_op = 'UPDATE' then
          if (old.date is distinct from new.date) or (old.time is distinct from new.time) then
            push_title := 'Booking rescheduled';
            push_body := new.client_name || ' moved ' || new.service
              || ' to ' || formatted_date || ' at ' || formatted_time;

            perform public.enqueue_owner_push_notification(
              new.user_id,
              new.id,
              'booking_rescheduled',
              push_title,
              push_body,
              jsonb_build_object(
                'bookingId', new.id,
                'eventType', 'booking_rescheduled',
                'type', 'owner-booking-event'
              ),
              null
            );
          end if;

          if old.status is distinct from new.status and new.status = 'cancelled' then
            push_title := 'Booking cancelled';
            push_body := new.client_name || ' cancelled ' || new.service
              || ' on ' || formatted_date || ' at ' || formatted_time;

            perform public.enqueue_owner_push_notification(
              new.user_id,
              new.id,
              'booking_cancelled',
              push_title,
              push_body,
              jsonb_build_object(
                'bookingId', new.id,
                'eventType', 'booking_cancelled',
                'type', 'owner-booking-event'
              ),
              null
            );
          end if;
        end if;

        return new;
      end;
      $body$;
    $fn$;
  end if;
end;
$$;

drop trigger if exists on_booking_owner_push_enqueue on public.bookings;

create trigger on_booking_owner_push_enqueue
after insert or update on public.bookings
for each row
execute procedure public.enqueue_owner_push_notifications();
