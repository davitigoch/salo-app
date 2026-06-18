-- PR4 Phase 4.2: Wire notification event emission into existing backend flows.
-- SQL triggers only; push behavior unchanged. emit_notification_event remains service_role for direct RPC.

-- ---------------------------------------------------------------------------
-- Booking lifecycle → notification_events
-- ---------------------------------------------------------------------------

create or replace function public.emit_booking_notification_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_formatted_date text;
  v_formatted_time text;
  v_is_public boolean;
  v_client_name text;
  v_service text;
  v_title text;
  v_body text;
  v_metadata jsonb;
begin
  if new.user_id is null or new.business_id is null then
    return new;
  end if;

  v_formatted_date := public._format_owner_push_date(new.date);
  v_formatted_time := public._format_owner_push_time(new.time);
  v_is_public := coalesce(new.booking_source, 'owner') = 'public';
  v_client_name := coalesce(nullif(trim(new.client_name), ''), 'Client');
  v_service := coalesce(nullif(trim(new.service), ''), 'Appointment');

  v_metadata := jsonb_build_object(
    'booking_id', new.id,
    'client_name', v_client_name,
    'service', v_service,
    'date', new.date,
    'time', new.time,
    'status', new.status,
    'booking_source', coalesce(new.booking_source, 'owner')
  );

  if tg_op = 'INSERT' then
    if v_is_public and new.status = 'pending' then
      v_title := 'New booking request';
      v_body := v_client_name || ' requested ' || v_service
        || ' on ' || v_formatted_date || ' at ' || v_formatted_time;

      perform public.emit_notification_event(
        p_business_id => new.business_id,
        p_user_id => new.user_id,
        p_event_type => 'public_booking_request',
        p_title => v_title,
        p_body => v_body,
        p_entity_type => 'booking',
        p_entity_id => new.id,
        p_metadata => v_metadata,
        p_dedupe_key => 'booking:' || new.id::text || ':public_booking_request',
        p_severity => 'info'
      );
    end if;

    if not v_is_public then
      v_title := 'New appointment';
      v_body := v_client_name || ' — ' || v_service
        || ' on ' || v_formatted_date || ' at ' || v_formatted_time;

      perform public.emit_notification_event(
        p_business_id => new.business_id,
        p_user_id => new.user_id,
        p_event_type => 'booking_created',
        p_title => v_title,
        p_body => v_body,
        p_entity_type => 'booking',
        p_entity_id => new.id,
        p_metadata => v_metadata,
        p_dedupe_key => 'booking:' || new.id::text || ':created',
        p_severity => 'info'
      );
    end if;

    if new.status = 'confirmed' then
      v_title := 'Appointment confirmed';
      v_body := v_client_name || ' — ' || v_service
        || ' on ' || v_formatted_date || ' at ' || v_formatted_time;

      perform public.emit_notification_event(
        p_business_id => new.business_id,
        p_user_id => new.user_id,
        p_event_type => 'booking_confirmed',
        p_title => v_title,
        p_body => v_body,
        p_entity_type => 'booking',
        p_entity_id => new.id,
        p_metadata => v_metadata,
        p_dedupe_key => 'booking:' || new.id::text || ':confirmed',
        p_severity => 'info'
      );
    end if;

    return new;
  end if;

  if tg_op = 'UPDATE' then
    if (old.date is distinct from new.date) or (old.time is distinct from new.time) then
      v_title := 'Appointment rescheduled';
      v_body := v_client_name || ' — ' || v_service
        || ' moved to ' || v_formatted_date || ' at ' || v_formatted_time;

      perform public.emit_notification_event(
        p_business_id => new.business_id,
        p_user_id => new.user_id,
        p_event_type => 'booking_rescheduled',
        p_title => v_title,
        p_body => v_body,
        p_entity_type => 'booking',
        p_entity_id => new.id,
        p_metadata => v_metadata || jsonb_build_object(
          'old_date', old.date,
          'old_time', old.time
        ),
        p_dedupe_key => 'booking:' || new.id::text || ':rescheduled:'
          || coalesce(new.date, '') || ':' || coalesce(new.time, ''),
        p_severity => 'info'
      );
    end if;

    if old.status is distinct from new.status and new.status = 'cancelled' then
      v_title := 'Appointment cancelled';
      v_body := v_client_name || ' — ' || v_service
        || ' on ' || v_formatted_date || ' at ' || v_formatted_time;

      perform public.emit_notification_event(
        p_business_id => new.business_id,
        p_user_id => new.user_id,
        p_event_type => 'booking_cancelled',
        p_title => v_title,
        p_body => v_body,
        p_entity_type => 'booking',
        p_entity_id => new.id,
        p_metadata => v_metadata,
        p_dedupe_key => 'booking:' || new.id::text || ':cancelled',
        p_severity => 'info'
      );
    end if;

    if old.status is distinct from new.status and new.status = 'confirmed' then
      v_title := 'Appointment confirmed';
      v_body := v_client_name || ' — ' || v_service
        || ' on ' || v_formatted_date || ' at ' || v_formatted_time;

      perform public.emit_notification_event(
        p_business_id => new.business_id,
        p_user_id => new.user_id,
        p_event_type => 'booking_confirmed',
        p_title => v_title,
        p_body => v_body,
        p_entity_type => 'booking',
        p_entity_id => new.id,
        p_metadata => v_metadata,
        p_dedupe_key => 'booking:' || new.id::text || ':confirmed',
        p_severity => 'info'
      );
    end if;

    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists on_booking_notification_events on public.bookings;

create trigger on_booking_notification_events
after insert or update on public.bookings
for each row
execute procedure public.emit_booking_notification_events();

-- ---------------------------------------------------------------------------
-- Payment succeeded → payment_received
-- ---------------------------------------------------------------------------

create or replace function public.emit_payment_notification_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_user_id uuid;
  v_client_name text;
  v_amount_label text;
  v_title text;
  v_body text;
  v_metadata jsonb;
begin
  if new.status <> 'succeeded' or new.business_id is null or new.booking_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status = 'succeeded' then
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

  v_amount_label := to_char(new.amount, 'FM$999,999,990.00');
  v_title := 'Payment received';
  v_body := v_amount_label || ' received for ' || v_client_name;

  v_metadata := jsonb_build_object(
    'payment_id', new.id,
    'booking_id', new.booking_id,
    'amount', new.amount,
    'amount_cents', round(new.amount * 100),
    'currency', new.currency,
    'client_name', v_client_name,
    'provider_event_id', new.provider_event_id
  );

  perform public.emit_notification_event(
    p_business_id => new.business_id,
    p_user_id => v_owner_user_id,
    p_event_type => 'payment_received',
    p_title => v_title,
    p_body => v_body,
    p_entity_type => 'payment',
    p_entity_id => new.id,
    p_metadata => v_metadata,
    p_dedupe_key => 'payment:' || new.id::text || ':received',
    p_severity => 'success'
  );

  return new;
end;
$$;

drop trigger if exists on_payment_notification_event on public.payments;

create trigger on_payment_notification_event
after insert or update on public.payments
for each row
execute procedure public.emit_payment_notification_event();

-- ---------------------------------------------------------------------------
-- SMS delivery exhausted → message_delivery_failed
-- (skipped if sms_notifications table not yet provisioned on this project)
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
    'event_type', new.event_type,
    'customer_phone', new.customer_phone,
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
    select 1
    from information_schema.tables
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

-- ---------------------------------------------------------------------------
-- Calendar sync terminal failure → calendar_sync_failed
-- ---------------------------------------------------------------------------

create or replace function public.emit_calendar_sync_failed_notification()
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
  v_entity_id uuid;
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

  v_entity_id := new.booking_id;

  if v_entity_id is not null then
    select coalesce(nullif(trim(bk.client_name), ''), 'Client')
    into v_client_name
    from public.bookings bk
    where bk.id = v_entity_id;
  else
    v_client_name := coalesce(
      nullif(trim(coalesce(new.metadata ->> 'client_name', '')), ''),
      'Client'
    );
  end if;

  v_title := 'Google Calendar sync failed';
  v_body := 'Could not sync appointment for ' || coalesce(v_client_name, 'Client') || '.';

  v_metadata := jsonb_build_object(
    'booking_id', new.booking_id,
    'calendar_sync_job_id', new.id,
    'client_name', v_client_name,
    'operation', new.operation,
    'event_type', new.event_type,
    'error_summary', coalesce(new.last_error, 'Sync failed')
  );

  perform public.emit_notification_event(
    p_business_id => new.business_id,
    p_user_id => v_owner_user_id,
    p_event_type => 'calendar_sync_failed',
    p_title => v_title,
    p_body => v_body,
    p_entity_type => 'booking',
    p_entity_id => v_entity_id,
    p_metadata => v_metadata,
    p_dedupe_key => 'calendar_sync:job:' || new.id::text || ':failed',
    p_severity => 'warning'
  );

  return new;
end;
$$;

drop trigger if exists on_calendar_sync_failed_notification on public.calendar_sync_jobs;

create trigger on_calendar_sync_failed_notification
after insert or update on public.calendar_sync_jobs
for each row
execute procedure public.emit_calendar_sync_failed_notification();
