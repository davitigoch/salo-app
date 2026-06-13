import { parseBookingDateTime } from './bookings';

const VISIT_STATUSES = new Set(['pending', 'confirmed', 'completed']);
const REVENUE_STATUSES = new Set(['confirmed', 'completed']);

function normalizeClientName(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

export function formatBookingLabel(booking) {
  if (!booking?.date) {
    return 'None scheduled';
  }

  return `${booking.date} at ${booking.time || '--:--'}`;
}

export function getClientBookingsForClient(client, bookings) {
  const clientName = normalizeClientName(client?.client_name);

  if (!clientName) {
    return [];
  }

  return (bookings || []).filter(
    (booking) => normalizeClientName(booking.client_name) === clientName
  );
}

export function getClientCrmStats(client, bookings, now = new Date()) {
  const clientBookings = getClientBookingsForClient(client, bookings);
  const nowMs = now.getTime();

  const visitBookings = clientBookings.filter((booking) =>
    VISIT_STATUSES.has(booking.status || 'confirmed')
  );

  const lifetimeRevenue = clientBookings
    .filter((booking) => REVENUE_STATUSES.has(booking.status || 'confirmed'))
    .reduce((sum, booking) => sum + Number(booking.price || 0), 0);

  const datedBookings = clientBookings
    .map((booking) => ({
      booking,
      appointmentDate: parseBookingDateTime(booking),
    }))
    .filter((entry) => entry.appointmentDate);

  const pastBookings = datedBookings
    .filter((entry) => entry.appointmentDate.getTime() < nowMs)
    .sort((first, second) => second.appointmentDate.getTime() - first.appointmentDate.getTime())
    .map((entry) => entry.booking);

  const upcomingAppointments = datedBookings
    .filter(
      (entry) =>
        entry.appointmentDate.getTime() >= nowMs
        && (entry.booking.status || 'confirmed') !== 'cancelled'
        && (entry.booking.status || 'confirmed') !== 'no_show'
    )
    .sort((first, second) => first.appointmentDate.getTime() - second.appointmentDate.getTime())
    .map((entry) => entry.booking);

  const lastVisit = pastBookings[0] || null;
  const nextAppointment = upcomingAppointments[0] || null;

  return {
    totalVisits: visitBookings.length,
    lifetimeRevenue,
    lastVisit,
    lastVisitLabel: lastVisit ? formatBookingLabel(lastVisit) : 'No visits yet',
    nextAppointment,
    nextAppointmentLabel: nextAppointment ? formatBookingLabel(nextAppointment) : 'None scheduled',
    upcomingAppointments,
    appointmentHistory: pastBookings,
  };
}

export function getClientVisitStats(client, bookings) {
  const stats = getClientCrmStats(client, bookings);

  return {
    visitCount: stats.totalVisits,
    lastVisitLabel: stats.lastVisitLabel,
  };
}

export function filterClients(clients, query) {
  const normalizedQuery = String(query || '').trim().toLowerCase();

  if (!normalizedQuery) {
    return clients;
  }

  return clients.filter((client) => {
    const searchable = [client.client_name, client.phone, client.email, client.notes];

    return searchable.some((value) =>
      String(value || '').toLowerCase().includes(normalizedQuery)
    );
  });
}

export function shouldSyncClientOnConfirm(previousBooking, updatedBooking) {
  if (!updatedBooking || updatedBooking.status !== 'confirmed') {
    return false;
  }

  if (!previousBooking || previousBooking.status !== 'pending') {
    return false;
  }

  return updatedBooking.booking_source === 'public';
}

export async function syncClientFromConfirmedPublicBooking({
  booking,
  clients,
  addClient,
  updateClient,
}) {
  const email = normalizeEmail(booking?.customer_email);
  const phone = normalizePhone(booking?.customer_phone);
  const clientName = String(booking?.client_name || '').trim();
  const bookingNotes = String(booking?.notes || '').trim();

  if (!clientName && !email && !phone) {
    return { error: null };
  }

  let existingClient = null;

  if (email) {
    existingClient = clients.find((client) => normalizeEmail(client.email) === email) || null;
  }

  if (!existingClient && phone) {
    existingClient = clients.find((client) => normalizePhone(client.phone) === phone) || null;
  }

  if (existingClient) {
    const updates = {};

    if (!String(existingClient.phone || '').trim() && booking.customer_phone?.trim()) {
      updates.phone = booking.customer_phone.trim();
    }

    if (!String(existingClient.email || '').trim() && booking.customer_email?.trim()) {
      updates.email = booking.customer_email.trim();
    }

    if (!String(existingClient.client_name || '').trim() && clientName) {
      updates.client_name = clientName;
    }

    if (!String(existingClient.notes || '').trim() && bookingNotes) {
      updates.notes = bookingNotes;
    }

    if (!Object.keys(updates).length) {
      return { error: null };
    }

    return updateClient(existingClient.id, updates);
  }

  return addClient({
    client_name: clientName || 'Guest',
    phone: String(booking.customer_phone || '').trim(),
    email: String(booking.customer_email || '').trim(),
    notes: bookingNotes,
  });
}
