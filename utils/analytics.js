import { isPendingPublicRequest } from '../constants/bookingStatus';
import { computeOnlinePaymentAnalytics } from './stripePayments';
import { parseBookingDateTime } from './bookings';

const REVENUE_STATUSES = new Set(['confirmed', 'completed']);

function toDateKey(dateValue) {
  const year = dateValue.getFullYear();
  const month = String(dateValue.getMonth() + 1).padStart(2, '0');
  const day = String(dateValue.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getBookingPrice(booking) {
  const parsed = Number(booking?.price);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function getWeekRange(now) {
  const startOfWeek = new Date(now);
  startOfWeek.setHours(0, 0, 0, 0);
  const diffToMonday = (startOfWeek.getDay() + 6) % 7;
  startOfWeek.setDate(startOfWeek.getDate() - diffToMonday);

  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(endOfWeek.getDate() + 7);

  return { startOfWeek, endOfWeek };
}

function getMonthRange(now) {
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  return { startOfMonth, endOfMonth };
}

function isWithinRange(booking, rangeStart, rangeEnd) {
  const appointmentDate = parseBookingDateTime(booking);

  if (!appointmentDate) {
    return false;
  }

  return appointmentDate >= rangeStart && appointmentDate < rangeEnd;
}

export function isRevenueEligibleBooking(booking) {
  return REVENUE_STATUSES.has(booking?.status || 'confirmed');
}

function sumRevenue(bookings) {
  return bookings.reduce((sum, booking) => sum + getBookingPrice(booking), 0);
}

function getTopEntry(countsMap, fallbackLabel = 'None yet') {
  let topLabel = fallbackLabel;
  let topCount = 0;

  countsMap.forEach((count, label) => {
    if (count > topCount) {
      topCount = count;
      topLabel = label;
    }
  });

  return {
    label: topLabel,
    count: topCount,
  };
}

export function computeOwnerAnalytics({
  bookings = [],
  clients = [],
  staff = [],
  payments = [],
  now = new Date(),
}) {
  const todayKey = toDateKey(now);
  const { startOfWeek, endOfWeek } = getWeekRange(now);
  const { startOfMonth, endOfMonth } = getMonthRange(now);

  const revenueToday = sumRevenue(
    bookings.filter(
      (booking) => booking.date === todayKey && isRevenueEligibleBooking(booking)
    )
  );

  const revenueThisWeek = sumRevenue(
    bookings.filter(
      (booking) =>
        isWithinRange(booking, startOfWeek, endOfWeek) && isRevenueEligibleBooking(booking)
    )
  );

  const revenueThisMonth = sumRevenue(
    bookings.filter(
      (booking) =>
        isWithinRange(booking, startOfMonth, endOfMonth) && isRevenueEligibleBooking(booking)
    )
  );

  const appointmentsToday = bookings.filter((booking) => booking.date === todayKey).length;

  const appointmentsThisWeek = bookings.filter((booking) =>
    isWithinRange(booking, startOfWeek, endOfWeek)
  ).length;

  const pendingRequests = bookings.filter(isPendingPublicRequest).length;

  const newClientsThisMonth = clients.filter((client) => {
    const createdAt = new Date(client.created_at || 0);
    return createdAt >= startOfMonth && createdAt < endOfMonth;
  }).length;

  const totalClients = clients.length;

  const serviceCounts = new Map();
  bookings.forEach((booking) => {
    const serviceName = String(booking.service || '').trim() || 'Unknown service';
    serviceCounts.set(serviceName, (serviceCounts.get(serviceName) || 0) + 1);
  });

  const staffLookup = new Map((staff || []).map((member) => [member.id, member.name]));
  const staffCounts = new Map();

  bookings.forEach((booking) => {
    const staffName =
      staffLookup.get(booking.staff_member_id)
      || booking.booking_metadata?.staff_member_name
      || 'Unassigned';

    staffCounts.set(staffName, (staffCounts.get(staffName) || 0) + 1);
  });

  const topService = getTopEntry(serviceCounts);
  const topStaff = getTopEntry(staffCounts);
  const { revenueCollectedOnline, depositRevenue } = computeOnlinePaymentAnalytics(payments);

  return {
    hasData: bookings.length > 0 || payments.length > 0,
    revenueToday,
    revenueThisWeek,
    revenueThisMonth,
    revenueCollectedOnline,
    depositRevenue,
    appointmentsToday,
    appointmentsThisWeek,
    pendingRequests,
    newClientsThisMonth,
    totalClients,
    topService,
    topStaff,
  };
}
