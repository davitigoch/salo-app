export function parseBookingDateTime(booking) {
  const dateParts = String(booking?.date || '').split('-').map(Number);
  const timeParts = String(booking?.time || '').split(':').map(Number);

  if (
    dateParts.length !== 3 ||
    timeParts.length < 2 ||
    dateParts.some((value) => Number.isNaN(value)) ||
    Number.isNaN(timeParts[0]) ||
    Number.isNaN(timeParts[1])
  ) {
    return null;
  }

  return new Date(
    dateParts[0],
    dateParts[1] - 1,
    dateParts[2],
    timeParts[0],
    timeParts[1],
    0,
    0
  );
}

function compareAppointments(first, second) {
  const firstDate = parseBookingDateTime(first);
  const secondDate = parseBookingDateTime(second);

  if (!firstDate && !secondDate) {
    return 0;
  }

  if (!firstDate) {
    return 1;
  }

  if (!secondDate) {
    return -1;
  }

  return firstDate.getTime() - secondDate.getTime();
}

export function sortBookingsByAppointment(bookings, { now = new Date() } = {}) {
  const nowMs = now.getTime();
  const upcoming = [];
  const past = [];
  const invalid = [];

  (bookings || []).forEach((booking) => {
    const appointmentDate = parseBookingDateTime(booking);

    if (!appointmentDate) {
      invalid.push(booking);
      return;
    }

    if (appointmentDate.getTime() >= nowMs) {
      upcoming.push(booking);
      return;
    }

    past.push(booking);
  });

  upcoming.sort(compareAppointments);
  past.sort((first, second) => compareAppointments(second, first));
  invalid.sort((first, second) => {
    const firstCreated = new Date(first.created_at || 0).getTime();
    const secondCreated = new Date(second.created_at || 0).getTime();
    return secondCreated - firstCreated;
  });

  return [...upcoming, ...past, ...invalid];
}

export function normalizeSearchQuery(query) {
  return String(query || '').trim().toLowerCase();
}

function getStaffSearchLabel(booking, staffById) {
  const staffMemberId = booking.staff_member_id || booking.booking_metadata?.staff_member_id;
  const staffFromContext = staffMemberId ? staffById?.[staffMemberId] : null;
  const staffName = staffFromContext?.name || booking.booking_metadata?.staff_member_name || '';

  return String(staffName).toLowerCase();
}

export function matchesBooking(booking, query, staffById = {}) {
  const normalizedQuery = normalizeSearchQuery(query);

  if (!normalizedQuery) {
    return true;
  }

  const searchableValues = [
    booking.client_name,
    booking.service,
    booking.notes,
    booking.date,
    booking.time,
    booking.status,
    getStaffSearchLabel(booking, staffById),
  ];

  return searchableValues.some((value) =>
    String(value || '').toLowerCase().includes(normalizedQuery)
  );
}

export function filterBookings(bookings, query, staffById = {}) {
  const normalizedQuery = normalizeSearchQuery(query);

  if (!normalizedQuery) {
    return bookings;
  }

  return bookings.filter((booking) => matchesBooking(booking, normalizedQuery, staffById));
}
