import React from 'react';
import { View, Text } from 'react-native';

import PrimaryButton from '../components/PrimaryButton';
import ScreenContainer from '../components/ScreenContainer';
import { COLORS } from '../constants/colors';
import { ROUTES } from '../constants/routes';
import { useBookings } from '../context/BookingsContext';
import { useClients } from '../context/ClientsContext';

function parseBookingDateTime(booking) {
  const dateParts = String(booking.date || '').split('-').map(Number);
  const timeParts = String(booking.time || '').split(':').map(Number);

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

function getBookingPrice(booking) {
  const parsed = Number(booking.price);
  if (Number.isNaN(parsed)) {
    return 0;
  }
  return parsed;
}

function isRevenueEligible(booking) {
  return (booking.status || 'confirmed') !== 'cancelled';
}

function toDateKey(dateValue) {
  const year = dateValue.getFullYear();
  const month = String(dateValue.getMonth() + 1).padStart(2, '0');
  const day = String(dateValue.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function HomeScreen({ navigation }) {
  const { bookings, isBookingsLoading } = useBookings();
  const { clients, isClientsLoading } = useClients();

  const now = new Date();
  const todayKey = toDateKey(now);

  const todaysAppointments = bookings.filter(
    (booking) => booking.date === todayKey
  ).length;

  const startOfWeek = (() => {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    const diffToMonday = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - diffToMonday);
    return date;
  })();
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(endOfWeek.getDate() + 7);

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const todayRevenue = bookings
    .filter((booking) => booking.date === todayKey && isRevenueEligible(booking))
    .reduce((sum, booking) => sum + getBookingPrice(booking), 0);

  const weeklyRevenue = bookings
    .filter((booking) => {
      const date = parseBookingDateTime(booking);
      return date && date >= startOfWeek && date < endOfWeek && isRevenueEligible(booking);
    })
    .reduce((sum, booking) => sum + getBookingPrice(booking), 0);

  const monthlyRevenue = bookings
    .filter((booking) => {
      const date = parseBookingDateTime(booking);
      return date && date >= startOfMonth && date < endOfMonth && isRevenueEligible(booking);
    })
    .reduce((sum, booking) => sum + getBookingPrice(booking), 0);

  const upcomingBookings = bookings
    .filter((booking) => {
      const appointmentDate = parseBookingDateTime(booking);
      return appointmentDate && appointmentDate >= now;
    })
    .sort((a, b) => {
      const first = parseBookingDateTime(a);
      const second = parseBookingDateTime(b);
      if (!first || !second) {
        return 0;
      }
      return first.getTime() - second.getTime();
    });

  const upcomingCount = upcomingBookings.length;

  return (
    <ScreenContainer
      style={{
        padding: 24,
        paddingTop: 70,
      }}
    >
      <Text
        style={{
          color: COLORS.textPrimary,
          fontSize: 32,
          fontWeight: '700',
        }}
      >
        Dashboard
      </Text>

      <Text
        style={{
          color: COLORS.textSecondary,
          marginTop: 8,
          marginBottom: 20,
        }}
      >
        Today's salon overview
      </Text>

      <View
        style={{
          backgroundColor: COLORS.card,
          padding: 20,
          borderRadius: 22,
          marginBottom: 12,
        }}
      >
        <Text
          style={{
            color: COLORS.textPrimary,
            fontSize: 20,
            fontWeight: '700',
          }}
        >
          {bookings.length} Total Appointments
        </Text>

        <Text
          style={{
            color: COLORS.textSecondary,
            marginTop: 6,
          }}
        >
          {todaysAppointments} appointment{todaysAppointments === 1 ? '' : 's'} today
        </Text>
      </View>

      <View
        style={{
          flexDirection: 'row',
          marginBottom: 12,
        }}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: COLORS.card,
            borderRadius: 18,
            padding: 16,
            marginRight: 8,
          }}
        >
          <Text style={{ color: COLORS.textSecondary, fontSize: 12 }}>
            TOTAL CLIENTS
          </Text>
          <Text
            style={{
              color: COLORS.textPrimary,
              fontSize: 24,
              fontWeight: '700',
              marginTop: 6,
            }}
          >
            {clients.length}
          </Text>
        </View>

        <View
          style={{
            flex: 1,
            backgroundColor: COLORS.card,
            borderRadius: 18,
            padding: 16,
            marginLeft: 8,
          }}
        >
          <Text style={{ color: COLORS.textSecondary, fontSize: 12 }}>
            UPCOMING
          </Text>
          <Text
            style={{
              color: COLORS.textPrimary,
              fontSize: 24,
              fontWeight: '700',
              marginTop: 6,
            }}
          >
            {upcomingCount}
          </Text>
        </View>
      </View>

      <View
        style={{
          backgroundColor: COLORS.card,
          borderRadius: 18,
          padding: 16,
          marginBottom: 12,
        }}
      >
        <Text
          style={{
            color: COLORS.textPrimary,
            fontWeight: '700',
            fontSize: 16,
          }}
        >
          Next Booking
        </Text>
        <Text style={{ color: COLORS.textSecondary, marginTop: 8 }}>
          {upcomingBookings[0]
            ? `${upcomingBookings[0].service} with ${upcomingBookings[0].client_name} at ${upcomingBookings[0].time}`
            : 'No upcoming bookings scheduled'}
        </Text>
        {isBookingsLoading || isClientsLoading ? (
          <Text style={{ color: COLORS.textSecondary, marginTop: 8, fontSize: 12 }}>
            Syncing latest dashboard stats...
          </Text>
        ) : null}
      </View>

      <View
        style={{
          backgroundColor: COLORS.card,
          borderRadius: 18,
          padding: 16,
          marginBottom: 16,
        }}
      >
        <Text
          style={{
            color: COLORS.textPrimary,
            fontWeight: '700',
            fontSize: 16,
            marginBottom: 10,
          }}
        >
          Revenue Snapshot
        </Text>
        <Text style={{ color: COLORS.textSecondary }}>
          Today: ${todayRevenue.toFixed(2)}
        </Text>
        <Text style={{ color: COLORS.textSecondary, marginTop: 5 }}>
          Weekly: ${weeklyRevenue.toFixed(2)}
        </Text>
        <Text style={{ color: COLORS.textSecondary, marginTop: 5 }}>
          Monthly: ${monthlyRevenue.toFixed(2)}
        </Text>
      </View>

      <PrimaryButton
        title="View Bookings"
        onPress={() => navigation.navigate(ROUTES.Bookings)}
      />

      <PrimaryButton
        title="+ New Booking"
        onPress={() => navigation.navigate(ROUTES.AddBooking)}
        style={{
          marginTop: 12,
        }}
      />
    </ScreenContainer>
  );
}
