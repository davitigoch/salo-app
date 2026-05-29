create table if not exists public.notification_outbox (
  id bigserial primary key,
  event_type text not null,
  booking_id uuid references public.bookings(id) on delete set null,
  business_id uuid references public.businesses(id) on delete set null,
  payload jsonb not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  available_at timestamptz not null default timezone('utc', now()),
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.notification_outbox
  drop constraint if exists notification_outbox_event_type_check;

alter table public.notification_outbox
  add constraint notification_outbox_event_type_check
  check (event_type in ('booking.created', 'booking.rescheduled', 'booking.cancelled'));

alter table public.notification_outbox
  drop constraint if exists notification_outbox_status_check;

alter table public.notification_outbox
  add constraint notification_outbox_status_check
  check (status in ('pending', 'processing', 'processed', 'failed'));

create index if not exists notification_outbox_status_available_idx
  on public.notification_outbox (status, available_at, created_at);

create index if not exists notification_outbox_booking_event_idx
  on public.notification_outbox (booking_id, event_type, created_at desc);

create or replace function public.enqueue_notification_outbox_event(
  p_event_type text,
  p_booking_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings%rowtype;
  v_manage_appointment_url text;
begin
  if p_event_type is null or p_booking_id is null then
    return;
  end if;

  select *
  into v_booking
  from public.bookings b
  where b.id = p_booking_id
  limit 1;

  if not found then
    return;
  end if;

  if v_booking.booking_token is null or length(trim(v_booking.booking_token)) = 0 then
    return;
  end if;

  v_manage_appointment_url := 'https://salo.app/appointment/' || trim(v_booking.booking_token);

  insert into public.notification_outbox (
    event_type,
    booking_id,
    business_id,
    payload
  ) values (
    p_event_type,
    v_booking.id,
    v_booking.business_id,
    jsonb_build_object(
      'booking_id', v_booking.id,
      'booking_token', v_booking.booking_token,
      'business_id', v_booking.business_id,
      'customer_name', v_booking.client_name,
      'customer_email', v_booking.customer_email,
      'customer_phone', v_booking.customer_phone,
      'service', v_booking.service,
      'date', v_booking.date,
      'time', v_booking.time,
      'manage_appointment_url', v_manage_appointment_url
    )
  );
end;
$$;

create or replace function public.enqueue_booking_lifecycle_outbox_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(new.booking_source, 'owner') = 'public' then
      perform public.enqueue_notification_outbox_event('booking.created', new.id);
    end if;

    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.status is distinct from new.status and new.status = 'cancelled' then
      perform public.enqueue_notification_outbox_event('booking.cancelled', new.id);
    end if;

    if old.date is distinct from new.date or old.time is distinct from new.time then
      perform public.enqueue_notification_outbox_event('booking.rescheduled', new.id);
    end if;

    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists on_booking_lifecycle_outbox_enqueue on public.bookings;

create trigger on_booking_lifecycle_outbox_enqueue
after insert or update on public.bookings
for each row
execute procedure public.enqueue_booking_lifecycle_outbox_events();

revoke all on table public.notification_outbox from public;
revoke all on function public.enqueue_notification_outbox_event(text, uuid) from public;
revoke all on function public.enqueue_booking_lifecycle_outbox_events() from public;
