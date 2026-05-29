alter table public.bookings
add column if not exists booking_token text;

create or replace function public._salo_generate_booking_token()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  generated text;
begin
  loop
    generated := lower(encode(gen_random_bytes(18), 'hex'));
    exit when not exists (
      select 1
      from public.bookings b
      where b.booking_token = generated
    );
  end loop;

  return generated;
end;
$$;

create or replace function public._salo_time_to_minutes(value text)
returns integer
language plpgsql
immutable
as $$
declare
  h integer;
  m integer;
begin
  if value is null or value !~ '^\d{2}:\d{2}$' then
    return null;
  end if;

  h := split_part(value, ':', 1)::integer;
  m := split_part(value, ':', 2)::integer;

  if h < 0 or h > 23 or m < 0 or m > 59 then
    return null;
  end if;

  return h * 60 + m;
end;
$$;

create or replace function public.ensure_booking_token()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.booking_token is null or length(trim(new.booking_token)) = 0 then
    new.booking_token := public._salo_generate_booking_token();
  end if;

  if new.booking_metadata is null then
    new.booking_metadata := '{}'::jsonb;
  end if;

  if coalesce(new.booking_metadata #>> '{notification_hooks,confirmed_sms}', '') = '' then
    new.booking_metadata := jsonb_set(
      new.booking_metadata,
      '{notification_hooks,confirmed_sms}',
      to_jsonb('pending'::text),
      true
    );
  end if;

  return new;
end;
$$;

drop trigger if exists on_booking_assign_token on public.bookings;
create trigger on_booking_assign_token
before insert or update on public.bookings
for each row
execute procedure public.ensure_booking_token();

update public.bookings
set booking_token = public._salo_generate_booking_token()
where booking_token is null or length(trim(booking_token)) = 0;

alter table public.bookings
alter column booking_token set not null;

create unique index if not exists bookings_booking_token_uidx
on public.bookings (booking_token);

create index if not exists bookings_booking_token_date_idx
on public.bookings (booking_token, date);

create or replace function public.get_appointment_by_token(
  p_booking_token text,
  p_target_date text default null
)
returns table (
  booking_id uuid,
  booking_token text,
  business_id uuid,
  business_name text,
  business_slug text,
  service text,
  service_duration_minutes integer,
  price numeric,
  date text,
  booking_time text,
  status text,
  payment_status text,
  staff_member_id uuid,
  staff_member_name text,
  staff_member_role text,
  booking_metadata jsonb,
  business_hours jsonb,
  staff_members jsonb,
  staff_availability jsonb,
  booked_slots jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings%rowtype;
  v_business public.businesses%rowtype;
  v_payment_status text;
  v_target_date text;
begin
  if p_booking_token is null or length(trim(p_booking_token)) = 0 then
    return;
  end if;

  select *
  into v_booking
  from public.bookings b
  where b.booking_token = trim(p_booking_token)
  limit 1;

  if not found then
    return;
  end if;

  raise notice '[AppointmentPortalTrace][DB] bookings raw values: token=% date=% time=% status=%',
    v_booking.booking_token,
    v_booking.date,
    v_booking.time,
    v_booking.status;

  select *
  into v_business
  from public.businesses bs
  where bs.id = v_booking.business_id
  limit 1;

  if not found then
    return;
  end if;

  v_target_date := coalesce(nullif(trim(p_target_date), ''), v_booking.date);

  select p.status
  into v_payment_status
  from public.payments p
  where p.booking_id = v_booking.id
  order by coalesce(p.updated_at, p.created_at) desc
  limit 1;

  raise notice '[AppointmentPortalTrace][RPC] returning values: date=% booking_time=% target_date=% payment_status=%',
    v_booking.date,
    v_booking.time,
    v_target_date,
    coalesce(v_payment_status, coalesce(v_booking.booking_metadata ->> 'payment_status', 'unpaid'));

  return query
  select
    v_booking.id as booking_id,
    v_booking.booking_token,
    v_business.id as business_id,
    v_business.business_name,
    v_business.slug as business_slug,
    v_booking.service,
    greatest(1, coalesce((v_booking.booking_metadata ->> 'service_duration_minutes')::integer, 60)) as service_duration_minutes,
    v_booking.price,
    v_booking.date,
    v_booking.time as booking_time,
    v_booking.status,
    coalesce(v_payment_status, coalesce(v_booking.booking_metadata ->> 'payment_status', 'unpaid')) as payment_status,
    v_booking.staff_member_id,
    sm.name as staff_member_name,
    sm.role as staff_member_role,
    v_booking.booking_metadata,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'weekday', bh.weekday,
          'is_closed', bh.is_closed,
          'open_time', bh.open_time,
          'close_time', bh.close_time
        )
        order by bh.weekday
      )
      from public.business_hours bh
      where bh.business_id = v_business.id
    ), '[]'::jsonb) as business_hours,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', staff.id,
          'name', staff.name,
          'role', staff.role,
          'color', staff.color,
          'is_active', staff.is_active
        )
        order by staff.created_at asc
      )
      from public.staff_members staff
      where staff.business_id = v_business.id
        and staff.is_active = true
    ), '[]'::jsonb) as staff_members,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'staff_member_id', sa.staff_member_id,
          'weekday', sa.weekday,
          'is_closed', sa.is_closed,
          'open_time', sa.open_time,
          'close_time', sa.close_time
        )
        order by sa.staff_member_id, sa.weekday
      )
      from public.staff_availability sa
      join public.staff_members sm2 on sm2.id = sa.staff_member_id
      where sm2.business_id = v_business.id
        and sm2.is_active = true
    ), '[]'::jsonb) as staff_availability,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', b2.id,
          'time', b2.time,
          'staff_member_id', b2.staff_member_id,
          'booking_metadata', jsonb_build_object(
            'service_duration_minutes', greatest(1, coalesce((b2.booking_metadata ->> 'service_duration_minutes')::integer, 60))
          )
        )
        order by b2.time
      )
      from public.bookings b2
      where b2.business_id = v_business.id
        and b2.date = v_target_date
        and b2.status <> 'cancelled'
    ), '[]'::jsonb) as booked_slots
  from public.staff_members sm
  where sm.id = v_booking.staff_member_id
  union all
  select
    v_booking.id,
    v_booking.booking_token,
    v_business.id,
    v_business.business_name,
    v_business.slug,
    v_booking.service,
    greatest(1, coalesce((v_booking.booking_metadata ->> 'service_duration_minutes')::integer, 60)),
    v_booking.price,
    v_booking.date,
    v_booking.time as booking_time,
    v_booking.status,
    coalesce(v_payment_status, coalesce(v_booking.booking_metadata ->> 'payment_status', 'unpaid')),
    v_booking.staff_member_id,
    null,
    null,
    v_booking.booking_metadata,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'weekday', bh.weekday,
          'is_closed', bh.is_closed,
          'open_time', bh.open_time,
          'close_time', bh.close_time
        )
        order by bh.weekday
      )
      from public.business_hours bh
      where bh.business_id = v_business.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', staff.id,
          'name', staff.name,
          'role', staff.role,
          'color', staff.color,
          'is_active', staff.is_active
        )
        order by staff.created_at asc
      )
      from public.staff_members staff
      where staff.business_id = v_business.id
        and staff.is_active = true
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'staff_member_id', sa.staff_member_id,
          'weekday', sa.weekday,
          'is_closed', sa.is_closed,
          'open_time', sa.open_time,
          'close_time', sa.close_time
        )
        order by sa.staff_member_id, sa.weekday
      )
      from public.staff_availability sa
      join public.staff_members sm2 on sm2.id = sa.staff_member_id
      where sm2.business_id = v_business.id
        and sm2.is_active = true
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', b2.id,
          'time', b2.time,
          'staff_member_id', b2.staff_member_id,
          'booking_metadata', jsonb_build_object(
            'service_duration_minutes', greatest(1, coalesce((b2.booking_metadata ->> 'service_duration_minutes')::integer, 60))
          )
        )
        order by b2.time
      )
      from public.bookings b2
      where b2.business_id = v_business.id
        and b2.date = v_target_date
        and b2.status <> 'cancelled'
    ), '[]'::jsonb)
  where v_booking.staff_member_id is null
  limit 1;
end;
$$;

revoke all on function public.get_appointment_by_token(text, text) from public;
grant execute on function public.get_appointment_by_token(text, text) to anon;
grant execute on function public.get_appointment_by_token(text, text) to authenticated;

create or replace function public.cancel_appointment_by_token(
  p_booking_token text
)
returns table (
  success boolean,
  message text,
  booking_token text,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings%rowtype;
  v_metadata jsonb;
  v_rows_updated integer := 0;
begin
  if p_booking_token is null or length(trim(p_booking_token)) = 0 then
    return query select false, 'Missing booking token.', null::text, null::text;
    return;
  end if;

  select *
  into v_booking
  from public.bookings b
  where b.booking_token = trim(p_booking_token)
  limit 1;

  if not found then
    return query select false, 'Appointment not found.', null::text, null::text;
    return;
  end if;

  if v_booking.status = 'cancelled' then
    return query select true, 'Your appointment was cancelled.', v_booking.booking_token, v_booking.status;
    return;
  end if;

  if v_booking.status in ('completed', 'no_show') then
    return query select false, 'This appointment can no longer be cancelled.', v_booking.booking_token, v_booking.status;
    return;
  end if;

  v_metadata := coalesce(v_booking.booking_metadata, '{}'::jsonb);
  v_metadata := jsonb_set(v_metadata, '{cancelled_at}', to_jsonb(timezone('utc', now())::text), true);
  v_metadata := jsonb_set(v_metadata, '{notification_hooks,cancelled_sms}', to_jsonb('pending'::text), true);

  update public.bookings
  set status = 'cancelled',
      booking_metadata = v_metadata
  where id = v_booking.id;

  get diagnostics v_rows_updated = row_count;

  if v_rows_updated = 0 then
    return query select false, 'Unable to cancel appointment.', v_booking.booking_token, v_booking.status;
    return;
  end if;

  return query select true, 'Your appointment was cancelled.', v_booking.booking_token, 'cancelled'::text;
exception
  when others then
    return query select false, coalesce(SQLERRM, 'Unable to cancel appointment.'), null::text, null::text;
end;
$$;

revoke all on function public.cancel_appointment_by_token(text) from public;
grant execute on function public.cancel_appointment_by_token(text) to anon;
grant execute on function public.cancel_appointment_by_token(text) to authenticated;

create or replace function public.reschedule_appointment_by_token(
  p_booking_token text,
  p_new_date text,
  p_new_time text
)
returns table (
  success boolean,
  message text,
  booking_token text,
  date text,
  time text,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings%rowtype;
  v_business_hours public.business_hours%rowtype;
  v_staff_rule public.staff_availability%rowtype;
  v_duration integer;
  v_start integer;
  v_end integer;
  v_open integer;
  v_close integer;
  v_staff_open integer;
  v_staff_close integer;
  v_weekday integer;
  v_staff_id uuid;
  v_staff_candidate record;
  v_staff_available boolean := false;
  v_metadata jsonb;
begin
  if p_booking_token is null or length(trim(p_booking_token)) = 0 then
    return query select false, 'Missing booking token.', null::text, null::text, null::text, null::text;
    return;
  end if;

  if p_new_date is null or p_new_date !~ '^\d{4}-\d{2}-\d{2}$' then
    return query select false, 'Invalid date format.', null::text, null::text, null::text, null::text;
    return;
  end if;

  if p_new_time is null or p_new_time !~ '^\d{2}:\d{2}$' then
    return query select false, 'Invalid time format.', null::text, null::text, null::text, null::text;
    return;
  end if;

  select *
  into v_booking
  from public.bookings b
  where b.booking_token = trim(p_booking_token)
  limit 1;

  if not found then
    return query select false, 'Appointment not found.', null::text, null::text, null::text, null::text;
    return;
  end if;

  if v_booking.status = 'cancelled' then
    return query select false, 'This appointment is cancelled.', v_booking.booking_token, v_booking.date, v_booking.time, v_booking.status;
    return;
  end if;

  if v_booking.status in ('completed', 'no_show') then
    return query select false, 'This appointment can no longer be rescheduled.', v_booking.booking_token, v_booking.date, v_booking.time, v_booking.status;
    return;
  end if;

  v_start := public._salo_time_to_minutes(p_new_time);
  v_duration := greatest(1, coalesce((v_booking.booking_metadata ->> 'service_duration_minutes')::integer, 60));
  v_end := v_start + v_duration;
  v_weekday := extract(dow from to_date(p_new_date, 'YYYY-MM-DD'))::integer;

  select *
  into v_business_hours
  from public.business_hours bh
  where bh.business_id = v_booking.business_id
    and bh.weekday = v_weekday
  limit 1;

  if not found then
    return query select false, 'Business hours are unavailable for this date.', v_booking.booking_token, v_booking.date, v_booking.time, v_booking.status;
    return;
  end if;

  if v_business_hours.is_closed then
    return query select false, 'No available times for this date.', v_booking.booking_token, v_booking.date, v_booking.time, v_booking.status;
    return;
  end if;

  v_open := public._salo_time_to_minutes(v_business_hours.open_time);
  v_close := public._salo_time_to_minutes(v_business_hours.close_time);

  if v_open is null or v_close is null or v_close <= v_open then
    return query select false, 'Business hours are invalid for this date.', v_booking.booking_token, v_booking.date, v_booking.time, v_booking.status;
    return;
  end if;

  if v_start < v_open or v_end > v_close then
    return query select false, 'No available times for this date.', v_booking.booking_token, v_booking.date, v_booking.time, v_booking.status;
    return;
  end if;

  if v_booking.staff_member_id is not null then
    v_staff_id := v_booking.staff_member_id;

    if not exists (
      select 1
      from public.staff_members sm
      where sm.id = v_staff_id
        and sm.business_id = v_booking.business_id
        and sm.is_active = true
    ) then
      return query select false, 'Assigned staff member is unavailable.', v_booking.booking_token, v_booking.date, v_booking.time, v_booking.status;
      return;
    end if;

    select *
    into v_staff_rule
    from public.staff_availability sa
    where sa.staff_member_id = v_staff_id
      and sa.weekday = v_weekday
    limit 1;

    v_staff_open := v_open;
    v_staff_close := v_close;

    if found then
      if v_staff_rule.is_closed then
        return query select false, 'No available times for this date.', v_booking.booking_token, v_booking.date, v_booking.time, v_booking.status;
        return;
      end if;

      v_staff_open := greatest(v_staff_open, public._salo_time_to_minutes(v_staff_rule.open_time));
      v_staff_close := least(v_staff_close, public._salo_time_to_minutes(v_staff_rule.close_time));
    end if;

    if v_start < v_staff_open or v_end > v_staff_close then
      return query select false, 'No available times for this date.', v_booking.booking_token, v_booking.date, v_booking.time, v_booking.status;
      return;
    end if;

    if exists (
      select 1
      from public.bookings b2
      where b2.business_id = v_booking.business_id
        and b2.date = p_new_date
        and b2.status <> 'cancelled'
        and b2.id <> v_booking.id
        and (
          b2.staff_member_id is null
          or b2.staff_member_id = v_staff_id
        )
        and public._salo_time_to_minutes(b2.time) < v_end
        and (
          public._salo_time_to_minutes(b2.time)
          + greatest(1, coalesce((b2.booking_metadata ->> 'service_duration_minutes')::integer, 60))
        ) > v_start
    ) then
      return query select false, 'No available times for this date.', v_booking.booking_token, v_booking.date, v_booking.time, v_booking.status;
      return;
    end if;
  else
    for v_staff_candidate in
      select sm.id
      from public.staff_members sm
      where sm.business_id = v_booking.business_id
        and sm.is_active = true
    loop
      select *
      into v_staff_rule
      from public.staff_availability sa
      where sa.staff_member_id = v_staff_candidate.id
        and sa.weekday = v_weekday
      limit 1;

      v_staff_open := v_open;
      v_staff_close := v_close;

      if found then
        if v_staff_rule.is_closed then
          continue;
        end if;

        v_staff_open := greatest(v_staff_open, public._salo_time_to_minutes(v_staff_rule.open_time));
        v_staff_close := least(v_staff_close, public._salo_time_to_minutes(v_staff_rule.close_time));
      end if;

      if v_start < v_staff_open or v_end > v_staff_close then
        continue;
      end if;

      if exists (
        select 1
        from public.bookings b2
        where b2.business_id = v_booking.business_id
          and b2.date = p_new_date
          and b2.status <> 'cancelled'
          and b2.id <> v_booking.id
          and (
            b2.staff_member_id is null
            or b2.staff_member_id = v_staff_candidate.id
          )
          and public._salo_time_to_minutes(b2.time) < v_end
          and (
            public._salo_time_to_minutes(b2.time)
            + greatest(1, coalesce((b2.booking_metadata ->> 'service_duration_minutes')::integer, 60))
          ) > v_start
      ) then
        continue;
      end if;

      v_staff_available := true;
      exit;
    end loop;

    if not v_staff_available then
      return query select false, 'No available times for this date.', v_booking.booking_token, v_booking.date, v_booking.time, v_booking.status;
      return;
    end if;
  end if;

  v_metadata := coalesce(v_booking.booking_metadata, '{}'::jsonb);
  v_metadata := jsonb_set(v_metadata, '{previous_date}', to_jsonb(v_booking.date), true);
  v_metadata := jsonb_set(v_metadata, '{previous_time}', to_jsonb(v_booking.time), true);
  v_metadata := jsonb_set(v_metadata, '{rescheduled_at}', to_jsonb(timezone('utc', now())::text), true);
  v_metadata := jsonb_set(v_metadata, '{notification_hooks,rescheduled_sms}', to_jsonb('pending'::text), true);

  update public.bookings
  set date = p_new_date,
      time = p_new_time,
      booking_metadata = v_metadata
  where id = v_booking.id;

  return query select true, 'Your appointment was rescheduled.', v_booking.booking_token, p_new_date, p_new_time, v_booking.status;
end;
$$;

revoke all on function public.reschedule_appointment_by_token(text, text, text) from public;
grant execute on function public.reschedule_appointment_by_token(text, text, text) to anon;
grant execute on function public.reschedule_appointment_by_token(text, text, text) to authenticated;
