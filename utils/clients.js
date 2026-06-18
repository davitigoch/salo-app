import { parseBookingDateTime } from './bookings';
import { formatTimeDisplay } from '../constants/availability';
import { getStatusLabel, getStatusStyles } from '../constants/bookingStatus';
import { getClientDisplayName } from './clientProfiles';

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

export function getClientInitials(clientNameOrClient) {
  const clientName =
    typeof clientNameOrClient === 'string'
      ? clientNameOrClient
      : getClientDisplayName(clientNameOrClient);
  const parts = String(clientName || '').trim().split(/\s+/).filter(Boolean);

  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return '?';
}

function formatProfileDateLabel(value) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function hasRpcProfileStats(client) {
  return (
    client &&
    (client.lifetime_bookings !== undefined ||
      client.lifetime_revenue !== undefined ||
      client.last_visit_at !== undefined ||
      client.next_appointment_at !== undefined)
  );
}

function getClientsForBooking(booking, clients) {
  if (!booking || !clients?.length) {
    return [];
  }

  if (booking.business_id) {
    return clients.filter((client) => client.business_id === booking.business_id);
  }

  return clients;
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
    .map((booking) => buildBookingTimelineEvent(booking, now))
    .sort((first, second) => second.sortTime - first.sortTime);
}

export function buildBookingTimelineEvent(booking, now = new Date()) {
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
}

export function findClientForBooking(booking, clients) {
  if (!booking || !clients?.length) {
    return null;
  }

  const scopedClients = getClientsForBooking(booking, clients);

  if (booking.client_id) {
    return scopedClients.find((client) => client.id === booking.client_id) || null;
  }

  const email = normalizeEmail(booking.customer_email);
  if (email) {
    const byEmail = scopedClients.find((client) => normalizeEmail(client.email) === email);
    if (byEmail) {
      return byEmail;
    }
  }

  const phone = normalizePhone(booking.customer_phone);
  if (phone) {
    const byPhone = scopedClients.find((client) => normalizePhone(client.phone) === phone);
    if (byPhone) {
      return byPhone;
    }
  }

  const bookingName = normalizeClientName(booking.client_name);
  if (!bookingName) {
    return null;
  }

  return (
    scopedClients.find((client) => normalizeClientName(getClientDisplayName(client)) === bookingName) ||
    scopedClients.find((client) => normalizeClientName(client.client_name) === bookingName) ||
    null
  );
}

export function bookingMatchesClient(client, booking) {
  if (!client || !booking) {
    return false;
  }

  if (client.id && booking.client_id) {
    return booking.client_id === client.id;
  }

  if (
    booking.business_id &&
    client.business_id &&
    booking.business_id !== client.business_id
  ) {
    return false;
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

  const clientName = normalizeClientName(getClientDisplayName(client));
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
  if (hasRpcProfileStats(client)) {
    return {
      totalVisits: Number(client.lifetime_bookings || 0),
      completedVisits: Number(client.lifetime_bookings || 0),
      lifetimeRevenue: Number(client.lifetime_revenue || 0),
      averageTicket: Number(client.average_spend || 0),
      noShows: Number(client.no_show_count || 0),
      cancellationCount: Number(client.cancellation_count || 0),
      rescheduledCount: Number(client.rescheduled_count || 0),
      lastVisit: null,
      lastVisitLabel: client.last_visit_at
        ? formatProfileDateLabel(client.last_visit_at)
        : 'No visits yet',
      nextAppointment: null,
      nextAppointmentLabel: client.next_appointment_at
        ? formatProfileDateLabel(client.next_appointment_at)
        : 'No upcoming appointments.',
      upcomingAppointments: [],
      appointmentHistory: [],
    };
  }

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

  const cancellationCount = clientBookings.filter(
    (booking) => (booking.status || 'confirmed') === 'cancelled'
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
    cancellationCount,
    rescheduledCount: 0,
    lastVisit,
    lastVisitLabel: lastVisit ? formatShortBookingDate(lastVisit) : 'No visits yet',
    nextAppointment,
    nextAppointmentLabel: nextAppointment ? formatShortBookingDate(nextAppointment) : 'No upcoming appointments.',
    upcomingAppointments,
    appointmentHistory: pastBookings,
  };
}

export function getClientVisitStats(client, bookings) {
  if (hasRpcProfileStats(client)) {
    return {
      visitCount: Number(client.lifetime_bookings || 0),
      lastVisitLabel: client.last_visit_at
        ? formatProfileDateLabel(client.last_visit_at)
        : 'No visits yet',
    };
  }

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
    const searchable = [
      getClientDisplayName(client),
      client.client_name,
      client.first_name,
      client.last_name,
      client.phone,
      client.email,
      client.notes,
    ];

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

export async function syncClientFromBookingContact({
  booking,
  clients,
  addClient,
  updateClient,
  source = 'owner_created',
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
      const updates = {};

      if (!String(linkedClient.phone || '').trim() && booking.customer_phone?.trim()) {
        updates.phone = booking.customer_phone.trim();
      }

      if (!String(linkedClient.email || '').trim() && booking.customer_email?.trim()) {
        updates.email = booking.customer_email.trim();
      }

      if (!String(linkedClient.client_name || '').trim() && clientName) {
        updates.client_name = clientName;
      }

      if (!String(linkedClient.notes || '').trim() && bookingNotes) {
        updates.notes = bookingNotes;
      }

      if (Object.keys(updates).length) {
        const { error } = await updateClient(linkedClient.id, updates);

        if (error) {
          return { error, clientId: null };
        }
      }

      return { error: null, clientId: linkedClient.id };
    }
  }

  const existingClient = findClientForBooking(booking, clients);

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
    source,
    business_id: booking.business_id || null,
  });

  if (error) {
    return { error, clientId: null };
  }

  return { error: null, clientId: data?.id || null };
}

export async function syncClientFromConfirmedPublicBooking(args) {
  return syncClientFromBookingContact({
    ...args,
    source: 'public_booking',
  });
}

export async function syncClientFromOwnerBooking(args) {
  return syncClientFromBookingContact({
    ...args,
    source: 'owner_created',
  });
}
