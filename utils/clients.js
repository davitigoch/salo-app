import { parseBookingDateTime } from './bookings';
import { formatTimeDisplay } from '../constants/availability';
import { getStatusLabel, getStatusStyles } from '../constants/bookingStatus';

const VISIT_STATUSES = new Set(['pending', 'confirmed', 'completed']);
const REVENUE_STATUSES = new Set(['confirmed', 'completed']);
const COMPLETED_STATUSES = new Set(['completed']);
const ACTIVE_FUTURE_STATUSES = new Set(['pending', 'confirmed', 'completed']);

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

export function formatShortBookingDate(booking) {
  if (!booking?.date) {
    return '—';
  }

  const appointmentDate = parseBookingDateTime(booking);

  if (!appointmentDate) {
    return booking.date;
  }

  return appointmentDate.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export function formatBookingTime(booking) {
  return formatTimeDisplay(booking?.time);
}

export function formatBookingPrice(booking) {
  return `$${Number(booking?.price || 0).toFixed(0)}`;
}

export function getClientInitials(clientName) {
  const parts = String(clientName || '').trim().split(/\s+/).filter(Boolean);

  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return '?';
}


function formatTimelineDate(booking) {
  const appointmentDate = parseBookingDateTime(booking);

  if (!appointmentDate) {
    return String(booking?.date || 'Unknown date');
  }

  return appointmentDate.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export function getClientTimelineEvents(client, bookings, now = new Date()) {
  const clientBookings = getClientBookingsForClient(client, bookings);

  return clientBookings
    .map((booking) => {
      const appointmentDate = parseBookingDateTime(booking);
      const fallbackDate = booking.created_at ? new Date(booking.created_at) : null;
      const sortDate = appointmentDate || fallbackDate;
      const status = booking.status || 'confirmed';
      const statusStyles = getStatusStyles(status);

      return {
        id: booking.id,
        booking,
        dateLabel: formatTimelineDate(booking),
        timeLabel: formatBookingTime(booking),
        priceLabel: formatBookingPrice(booking),
        serviceLabel: booking.service || 'Appointment',
        status,
        statusLabel: getStatusLabel(status).toUpperCase(),
        statusStyles,
        sortTime: sortDate ? sortDate.getTime() : 0,
      };
    })
    .sort((first, second) => second.sortTime - first.sortTime);
}

export function findClientForBooking(booking, clients) {
  if (!booking || !clients?.length) {
    return null;
  }

  if (booking.client_id) {
    return clients.find((client) => client.id === booking.client_id) || null;
  }

  const email = normalizeEmail(booking.customer_email);
  if (email) {
    const byEmail = clients.find((client) => normalizeEmail(client.email) === email);
    if (byEmail) {
      return byEmail;
    }
  }

  const phone = normalizePhone(booking.customer_phone);
  if (phone) {
    const byPhone = clients.find((client) => normalizePhone(client.phone) === phone);
    if (byPhone) {
      return byPhone;
    }
  }

  const bookingName = normalizeClientName(booking.client_name);
  if (!bookingName) {
    return null;
  }

  return clients.find((client) => normalizeClientName(client.client_name) === bookingName) || null;
}

export function bookingMatchesClient(client, booking) {
  if (!client || !booking) {
    return false;
  }

  if (client.id && booking.client_id) {
    return booking.client_id === client.id;
  }

  if (booking.client_id && client.id && booking.client_id !== client.id) {
    return false;
  }

  const clientEmail = normalizeEmail(client.email);
  const bookingEmail = normalizeEmail(booking.customer_email);
  if (clientEmail && bookingEmail && clientEmail === bookingEmail) {
    return true;
  }

  const clientPhone = normalizePhone(client.phone);
  const bookingPhone = normalizePhone(booking.customer_phone);
  if (clientPhone && bookingPhone && clientPhone === bookingPhone) {
    return true;
  }

  const clientName = normalizeClientName(client.client_name);
  const bookingName = normalizeClientName(booking.client_name);

  return Boolean(clientName && bookingName && clientName === bookingName);
}

function isActiveFutureStatus(status) {
  return ACTIVE_FUTURE_STATUSES.has(status || 'confirmed');
}

export function getUnlinkedBookings(bookings) {
  return (bookings || []).filter((booking) => !booking.client_id);
}

export function getClientBookingsForClient(client, bookings) {
  if (!client) {
    return [];
  }

  return (bookings || []).filter((booking) => bookingMatchesClient(client, booking));
}

export function getClientCrmStats(client, bookings, now = new Date()) {
  const clientBookings = getClientBookingsForClient(client, bookings);
  const nowMs = now.getTime();

  const visitBookings = clientBookings.filter((booking) =>
    VISIT_STATUSES.has(booking.status || 'confirmed')
  );

  const completedVisits = clientBookings.filter((booking) =>
    COMPLETED_STATUSES.has(booking.status || 'confirmed')
  ).length;

  const noShows = clientBookings.filter(
    (booking) => (booking.status || 'confirmed') === 'no_show'
  ).length;

  const lifetimeRevenue = clientBookings
    .filter((booking) => REVENUE_STATUSES.has(booking.status || 'confirmed'))
    .reduce((sum, booking) => sum + Number(booking.price || 0), 0);

  const averageTicket = completedVisits > 0 ? lifetimeRevenue / completedVisits : 0;

  const datedBookings = clientBookings
    .map((booking) => ({
      booking,
      appointmentDate: parseBookingDateTime(booking),
    }))
    .filter((entry) => entry.appointmentDate);

  const pastBookings = datedBookings
    .filter(
      (entry) =>
        entry.appointmentDate.getTime() < nowMs
        && (entry.booking.status || 'confirmed') !== 'cancelled'
        && (entry.booking.status || 'confirmed') !== 'no_show'
    )
    .sort((first, second) => second.appointmentDate.getTime() - first.appointmentDate.getTime())
    .map((entry) => entry.booking);

  const upcomingAppointments = datedBookings
    .filter(
      (entry) =>
        entry.appointmentDate.getTime() >= nowMs
        && isActiveFutureStatus(entry.booking.status)
    )
    .sort((first, second) => first.appointmentDate.getTime() - second.appointmentDate.getTime())
    .map((entry) => entry.booking);

  const lastVisit = pastBookings[0] || null;
  const nextAppointment = upcomingAppointments[0] || null;

  return {
    totalVisits: visitBookings.length,
    completedVisits,
    lifetimeRevenue,
    averageTicket,
    noShows,
    lastVisit,
    lastVisitLabel: lastVisit ? formatShortBookingDate(lastVisit) : 'No visits yet',
    nextAppointment,
    nextAppointmentLabel: nextAppointment ? formatShortBookingDate(nextAppointment) : 'No upcoming appointments.',
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
    return { error: null, clientId: booking?.client_id || null };
  }

  if (booking?.client_id) {
    const linkedClient = clients.find((client) => client.id === booking.client_id) || null;

    if (linkedClient) {
      return { error: null, clientId: linkedClient.id };
    }
  }

  let existingClient = findClientForBooking(booking, clients);

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

    if (Object.keys(updates).length) {
      const { error } = await updateClient(existingClient.id, updates);

      if (error) {
        return { error, clientId: null };
      }
    }

    return { error: null, clientId: existingClient.id };
  }

  const { error, data } = await addClient({
    client_name: clientName || 'Guest',
    phone: String(booking.customer_phone || '').trim(),
    email: String(booking.customer_email || '').trim(),
    notes: bookingNotes,
  });

  if (error) {
    return { error, clientId: null };
  }

  return { error: null, clientId: data?.id || null };
}
