import React from 'react';
import { ScrollView, View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import ScreenContainer from '../components/ScreenContainer';
import { isPendingPublicRequest } from '../constants/bookingStatus';
import { COLORS } from '../constants/colors';
import { ROUTES } from '../constants/routes';
import { useBookings } from '../context/BookingsContext';
import { useClients } from '../context/ClientsContext';
import { useAuth } from '../context/AuthContext';

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

function formatTimeLabel(timeValue) {
  const parts = String(timeValue || '').split(':').map(Number);
  if (parts.length < 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) {
    return String(timeValue || '--:--');
  }

  const hours24 = parts[0];
  const minutes = String(parts[1]).padStart(2, '0');
  const period = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 || 12;
  return `${hours12}:${minutes} ${period}`;
}

function getGreetingLabel(dateValue) {
  const hour = dateValue.getHours();
  if (hour < 12) {
    return 'Good Morning';
  }
  if (hour < 18) {
    return 'Good Afternoon';
  }
  return 'Good Evening';
}

function getStatusBadgeStyles(status) {
  const normalized = String(status || 'confirmed').toLowerCase();
  if (normalized === 'pending') {
    return { backgroundColor: '#2E2412', borderColor: '#6B4C1A', textColor: '#FDE68A' };
  }
  if (normalized === 'cancelled') {
    return { backgroundColor: '#341D22', borderColor: '#5F2A33', textColor: '#FCA5A5' };
  }
  if (normalized === 'completed') {
    return { backgroundColor: '#173325', borderColor: '#24543A', textColor: '#86EFAC' };
  }
  return { backgroundColor: '#1C1C29', borderColor: '#3D3D62', textColor: '#C4B5FD' };
}

function getQuickActionAccent(label) {
  if (label === 'New Booking') {
    return { icon: '#A78BFA', border: '#3F3563' };
  }
  if (label === 'Calendar') {
    return { icon: '#93C5FD', border: '#2E4E75' };
  }
  if (label === 'Clients') {
    return { icon: '#86EFAC', border: '#2D5A46' };
  }
  return { icon: '#D4D4D8', border: '#4B4B55' };
}

export default function HomeScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { bookings, isBookingsLoading } = useBookings();
  const { clients, isClientsLoading } = useClients();
  const { business } = useAuth();

  const now = new Date();
  const todayKey = toDateKey(now);
  const greeting = getGreetingLabel(now);

  const todaysAppointments = bookings.filter(
    (booking) => booking.date === todayKey
  ).length;

  const upcomingToday = bookings.filter((booking) => {
    if (booking.date !== todayKey) {
      return false;
    }
    const appointmentDate = parseBookingDateTime(booking);
    return appointmentDate && appointmentDate >= now;
  }).length;

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
  const nextBooking = upcomingBookings[0] || null;
  const pendingApprovalCount = bookings.filter(isPendingPublicRequest).length;

  const recentActivity = [...bookings]
    .sort((a, b) => {
      const first = parseBookingDateTime(a);
      const second = parseBookingDateTime(b);
      if (!first || !second) {
        return 0;
      }
      return second.getTime() - first.getTime();
    })
    .slice(0, 3);

  return (
    <ScreenContainer
      style={{
        paddingHorizontal: 22,
      }}
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: 128 }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <View>
            <Text
              style={{
                color: COLORS.textSecondary,
                fontSize: 15,
                letterSpacing: 0.4,
                fontWeight: '600',
              }}
            >
              {greeting}
            </Text>
            <Text
              style={{
                color: COLORS.textPrimary,
                fontSize: 25,
                fontWeight: '700',
                marginTop: 6,
              }}
            >
              {business?.business_name || 'SALO'}
            </Text>
            <Text
              style={{
                color: '#8B8BA2',
                fontSize: 12,
                marginTop: 4,
                letterSpacing: 0.25,
              }}
            >
              Owner Dashboard
            </Text>
          </View>
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: '#353548',
              backgroundColor: '#151521',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="sparkles" size={18} color={COLORS.accent} />
          </View>
        </View>

        <Text
          style={{
            color: COLORS.textSecondary,
            marginTop: 12,
            marginBottom: 24,
            fontSize: 13,
          }}
        >
          {clients.length} clients in your roster • {bookings.length} total appointments
        </Text>

        {pendingApprovalCount > 0 ? (
          <TouchableOpacity
            onPress={() =>
              navigation.navigate(ROUTES.Bookings, {
                statusFilter: 'pending',
              })
            }
            activeOpacity={0.9}
            style={{
              backgroundColor: '#2B2310',
              borderColor: '#6B4C1A',
              borderWidth: 1,
              borderRadius: 14,
              paddingHorizontal: 14,
              paddingVertical: 12,
              marginBottom: 20,
            }}
          >
            <Text style={{ color: '#FDE68A', fontWeight: '700', fontSize: 14 }}>
              {pendingApprovalCount} {pendingApprovalCount === 1 ? 'booking needs' : 'bookings need'} approval
            </Text>
            <Text style={{ color: '#D6C089', marginTop: 4, fontSize: 12 }}>
              Review public booking requests
            </Text>
          </TouchableOpacity>
        ) : null}

        <Text style={{ color: COLORS.textPrimary, fontSize: 17, fontWeight: '700', marginBottom: 12 }}>
          Today Overview
        </Text>

        <View style={{ flexDirection: 'row', marginBottom: 24 }}>
          <View
            style={{
              flex: 1,
              backgroundColor: COLORS.card,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: '#3B325B',
              paddingHorizontal: 12,
              paddingVertical: 14,
              minHeight: 116,
              marginRight: 6,
              shadowColor: '#000',
              shadowOpacity: 0.22,
              shadowRadius: 8,
              shadowOffset: { width: 0, height: 6 },
              elevation: 3,
            }}
          >
            <Text style={{ color: '#8B8BA2', fontSize: 10, letterSpacing: 0.35 }}>REVENUE TODAY</Text>
            <Text style={{ color: COLORS.textPrimary, fontSize: 24, fontWeight: '800', marginTop: 14 }}>
              ${todayRevenue.toFixed(0)}
            </Text>
            <Text style={{ color: '#8B8BA2', fontSize: 11, marginTop: 10 }}>
              Wk ${weeklyRevenue.toFixed(0)}
            </Text>
          </View>

          <View
            style={{
              flex: 1,
              backgroundColor: COLORS.card,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: '#324665',
              paddingHorizontal: 12,
              paddingVertical: 14,
              minHeight: 116,
              marginHorizontal: 3,
              shadowColor: '#000',
              shadowOpacity: 0.22,
              shadowRadius: 8,
              shadowOffset: { width: 0, height: 6 },
              elevation: 3,
            }}
          >
            <Text style={{ color: '#8B8BA2', fontSize: 10, letterSpacing: 0.35 }}>APPOINTMENTS TODAY</Text>
            <Text style={{ color: COLORS.textPrimary, fontSize: 24, fontWeight: '800', marginTop: 14 }}>
              {todaysAppointments}
            </Text>
            <Text style={{ color: '#8B8BA2', fontSize: 11, marginTop: 10 }}>
              Today
            </Text>
          </View>

          <View
            style={{
              flex: 1,
              backgroundColor: COLORS.card,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: '#355248',
              paddingHorizontal: 12,
              paddingVertical: 14,
              minHeight: 116,
              marginLeft: 6,
              shadowColor: '#000',
              shadowOpacity: 0.22,
              shadowRadius: 8,
              shadowOffset: { width: 0, height: 6 },
              elevation: 3,
            }}
          >
            <Text style={{ color: '#8B8BA2', fontSize: 10, letterSpacing: 0.35 }}>UPCOMING TODAY</Text>
            <Text style={{ color: COLORS.textPrimary, fontSize: 24, fontWeight: '800', marginTop: 14 }}>
              {upcomingToday}
            </Text>
            <Text style={{ color: '#8B8BA2', fontSize: 11, marginTop: 10 }}>
              Queue
            </Text>
          </View>
        </View>

        <Text style={{ color: COLORS.textPrimary, fontSize: 17, fontWeight: '700', marginBottom: 12 }}>
          Next Appointment
        </Text>
        <View
          style={{
            backgroundColor: '#141420',
            borderWidth: 1,
            borderColor: '#2A2A3D',
            borderRadius: 18,
            padding: 16,
            marginBottom: 24,
            shadowColor: '#000',
            shadowOpacity: 0.24,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 7 },
            elevation: 3,
          }}
        >
          {nextBooking ? (
            <>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: COLORS.textPrimary, fontSize: 19, fontWeight: '700' }}>
                  {nextBooking.client_name || 'Walk-in Client'}
                </Text>
                {(() => {
                  const badge = getStatusBadgeStyles(nextBooking.status);
                  return (
                    <View
                      style={{
                        backgroundColor: badge.backgroundColor,
                        borderColor: badge.borderColor,
                        borderWidth: 1,
                        borderRadius: 999,
                        paddingHorizontal: 10,
                        paddingVertical: 4,
                      }}
                    >
                      <Text style={{ color: badge.textColor, fontSize: 11, fontWeight: '700' }}>
                        {String(nextBooking.status || 'confirmed').replace('_', ' ').toUpperCase()}
                      </Text>
                    </View>
                  );
                })()}
              </View>
              <Text style={{ color: COLORS.textSecondary, marginTop: 5, fontSize: 14 }}>
                {nextBooking.service}
              </Text>
              <Text style={{ color: '#C4B5FD', marginTop: 10, fontWeight: '700' }}>
                {nextBooking.date} • {formatTimeLabel(nextBooking.time)}
              </Text>
            </>
          ) : (
            <View style={{ alignItems: 'flex-start' }}>
              <Text style={{ color: COLORS.textPrimary, fontSize: 15, fontWeight: '600' }}>
                You are all caught up for now.
              </Text>
              <Text style={{ color: COLORS.textSecondary, marginTop: 6, lineHeight: 20 }}>
                Create your next appointment to keep today's calendar flowing.
              </Text>
              <TouchableOpacity
                onPress={() => navigation.navigate(ROUTES.AddBooking)}
                activeOpacity={0.9}
                style={{
                  marginTop: 12,
                  backgroundColor: '#221D36',
                  borderWidth: 1,
                  borderColor: '#4C3A7E',
                  borderRadius: 10,
                  paddingHorizontal: 14,
                  paddingVertical: 9,
                }}
              >
                <Text style={{ color: '#DDD6FE', fontWeight: '700', fontSize: 12 }}>
                  Create Booking
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {isBookingsLoading || isClientsLoading ? (
            <Text style={{ color: '#8B8BA2', marginTop: 10, fontSize: 12 }}>
              Syncing latest dashboard stats...
            </Text>
          ) : null}
        </View>

        <Text style={{ color: COLORS.textPrimary, fontSize: 17, fontWeight: '700', marginBottom: 12 }}>
          Quick Actions
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4, marginBottom: 24 }}>
          {[
            { label: 'New Booking', icon: 'add-circle-outline', route: ROUTES.AddBooking },
            { label: 'Calendar', icon: 'calendar-outline', route: ROUTES.WeeklyCalendar },
            { label: 'Clients', icon: 'people-outline', route: ROUTES.Clients },
            { label: 'Settings', icon: 'settings-outline', route: ROUTES.Settings },
          ].map((action) => (
            <TouchableOpacity
              key={action.label}
              onPress={() => navigation.navigate(action.route)}
              activeOpacity={0.9}
              style={{
                width: '50%',
                paddingHorizontal: 4,
                marginBottom: 8,
              }}
            >
              {(() => {
                const accent = getQuickActionAccent(action.label);
                return (
              <View
                style={{
                  backgroundColor: COLORS.card,
                  borderWidth: 1,
                  borderColor: accent.border,
                  borderRadius: 16,
                  minHeight: 92,
                  padding: 14,
                  justifyContent: 'space-between',
                  shadowColor: '#000',
                  shadowOpacity: 0.2,
                  shadowRadius: 8,
                  shadowOffset: { width: 0, height: 6 },
                  elevation: 3,
                }}
              >
                <Ionicons name={action.icon} size={24} color={accent.icon} />
                <Text style={{ color: COLORS.textPrimary, fontWeight: '700' }}>{action.label}</Text>
              </View>
                );
              })()}
            </TouchableOpacity>
          ))}
        </View>

        <Text style={{ color: COLORS.textPrimary, fontSize: 17, fontWeight: '700', marginBottom: 12 }}>
          Recent Activity
        </Text>
        <View
          style={{
            backgroundColor: COLORS.card,
            borderWidth: 1,
            borderColor: '#2A2A38',
            borderRadius: 18,
            paddingHorizontal: 14,
            paddingVertical: 10,
          }}
        >
          {recentActivity.length ? (
            recentActivity.map((booking, index) => (
              <View
                key={`${booking.id || booking.client_name || 'booking'}-${index}`}
                style={{
                  paddingVertical: 14,
                  borderBottomWidth: index === recentActivity.length - 1 ? 0 : 1,
                  borderBottomColor: '#303042',
                }}
              >
                <Text style={{ color: COLORS.textPrimary, fontWeight: '700', fontSize: 15 }}>
                  {booking.client_name || 'Unknown client'}
                </Text>
                <Text style={{ color: COLORS.textSecondary, marginTop: 6, fontSize: 13, lineHeight: 18 }}>
                  {booking.service} • {booking.date} at {formatTimeLabel(booking.time)}
                </Text>
              </View>
            ))
          ) : (
            <Text style={{ color: COLORS.textSecondary, paddingVertical: 12 }}>
              No recent booking activity yet.
            </Text>
          )}
        </View>

        <Text style={{ color: '#8B8BA2', fontSize: 12, marginTop: 12 }}>
          Monthly revenue: ${monthlyRevenue.toFixed(2)} • Upcoming total: {upcomingCount}
        </Text>
      </ScrollView>
    </ScreenContainer>
  );
}
