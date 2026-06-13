-- Block anonymous direct public booking inserts when online payment is required.
-- Paid public bookings must be created via finalize-public-booking-payment (service role).

drop policy if exists "Public can create bookings for enabled businesses" on public.bookings;

create policy "Public can create bookings for enabled businesses"
on public.bookings
as permissive
for insert
to anon
with check (
  booking_source = 'public'
  and status = 'pending'
  and business_id is not null
  and user_id is not null
  and exists (
    select 1
    from public.businesses b
    where b.id = bookings.business_id
      and b.public_booking_enabled = true
      and b.owner_user_id = bookings.user_id
      and (bookings.business_slug is null or b.slug = bookings.business_slug)
      and b.require_card_on_booking = false
      and b.deposits_enabled = false
  )
  and (
    bookings.staff_member_id is null
    or exists (
      select 1
      from public.staff_members sm
      where sm.id = bookings.staff_member_id
        and sm.business_id = bookings.business_id
        and sm.is_active = true
    )
  )
);
