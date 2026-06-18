-- Fix schedule_booking_sms_reminders: use boolean prefs instead of composite type.
-- Resolves: cannot cast type record to notification_preferences

create or replace function public.schedule_booking_sms_reminders(
  p_booking public.bookings,
  p_timezone text,
  p_send_reminder_24h_sms boolean default true,
  p_send_reminder_2h_sms boolean default true
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

  if coalesce(p_send_reminder_24h_sms, true)
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

  if coalesce(p_send_reminder_2h_sms, true)
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
  send_reminder_24h boolean;
  send_reminder_2h boolean;
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

  if prefs is null or prefs.enable_customer_sms = false or not phone_present then
    return new;
  end if;

  send_reminder_24h := coalesce(prefs.send_reminder_24h_sms, true);
  send_reminder_2h := coalesce(prefs.send_reminder_2h_sms, true);

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
      perform public.schedule_booking_sms_reminders(
        new,
        business_tz,
        send_reminder_24h,
        send_reminder_2h
      );
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
      perform public.schedule_booking_sms_reminders(
        new,
        business_tz,
        send_reminder_24h,
        send_reminder_2h
      );
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
      perform public.schedule_booking_sms_reminders(
        new,
        business_tz,
        send_reminder_24h,
        send_reminder_2h
      );
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
