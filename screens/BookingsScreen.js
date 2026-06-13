import React, { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import PrimaryButton from '../components/PrimaryButton';
import ScreenContainer from '../components/ScreenContainer';
import SearchField from '../components/SearchField';
import {
  getStatusLabel,
  getStatusStyles,
  isPendingPublicRequest,
  matchesStatusFilter,
  STATUS_FILTER_OPTIONS,
  STATUS_OPTIONS,
} from '../constants/bookingStatus';
import { COLORS } from '../constants/colors';
import { ROUTES } from '../constants/routes';
import { useBookings } from '../context/BookingsContext';
import { useStaff } from '../context/StaffContext';
import {
  filterBookings,
  normalizeSearchQuery,
  sortBookingsByAppointment,
} from '../utils/bookings';

export default function BookingsScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const { bookings, isBookingsLoading, bookingsError, deleteBooking, updateBooking } = useBookings();
  const { staff } = useStaff();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    const nextFilter = route.params?.statusFilter;

    if (nextFilter) {
      setStatusFilter(nextFilter);
    }
  }, [route.params?.statusFilter]);

  const staffById = useMemo(
    () => Object.fromEntries((staff || []).map((member) => [member.id, member])),
    [staff]
  );

  const pendingApprovalCount = useMemo(
    () => bookings.filter(isPendingPublicRequest).length,
    [bookings]
  );

  const pendingStatusCount = useMemo(
    () => bookings.filter((booking) => (booking.status || 'confirmed') === 'pending').length,
    [bookings]
  );

  const sortedBookings = useMemo(
    () => sortBookingsByAppointment(bookings),
    [bookings]
  );

  const statusFilteredBookings = useMemo(
    () => sortedBookings.filter((booking) => matchesStatusFilter(booking, statusFilter)),
    [sortedBookings, statusFilter]
  );

  const visibleBookings = useMemo(
    () => filterBookings(statusFilteredBookings, searchQuery, staffById),
    [statusFilteredBookings, searchQuery, staffById]
  );

  const hasSearchQuery = Boolean(normalizeSearchQuery(searchQuery));
  const hasActiveStatusFilter = statusFilter !== 'all';
  const hasBookings = bookings.length > 0;
  const showNoSearchResults =
    hasBookings && (hasSearchQuery || hasActiveStatusFilter) && !visibleBookings.length;
  const showEmptyBookings = !isBookingsLoading && !bookingsError && !hasBookings;

  const onDeleteBooking = (bookingId) => {
    Alert.alert('Delete booking?', 'This action cannot be undone.', [
      {
        text: 'Cancel',
        style: 'cancel',
      },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const { error } = await deleteBooking(bookingId);
          if (error) {
            Alert.alert('Delete failed', error.message);
          }
        },
      },
    ]);
  };

  const onChangeStatus = (booking) => {
    Alert.alert(
      'Update status',
      'Choose a new booking status.',
      [
        ...STATUS_OPTIONS.map((statusOption) => ({
          text: getStatusLabel(statusOption),
          onPress: async () => {
            const { error } = await updateBooking(booking.id, { status: statusOption });
            if (error) {
              Alert.alert('Status update failed', error.message);
            }
          },
        })),
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  return (
    <ScreenContainer
      style={{
        padding: 24,
        paddingTop: insets.top + 10,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <Text
          style={{
            color: COLORS.textPrimary,
            fontSize: 32,
            fontWeight: '700',
          }}
        >
          Bookings
        </Text>

        {pendingStatusCount > 0 ? (
          <View
            style={{
              backgroundColor: '#2B2310',
              borderColor: '#5B4B1A',
              borderWidth: 1,
              borderRadius: 999,
              paddingHorizontal: 10,
              paddingVertical: 5,
              marginBottom: 4,
            }}
          >
            <Text style={{ color: '#FDE68A', fontSize: 12, fontWeight: '700' }}>
              {pendingStatusCount} pending
            </Text>
          </View>
        ) : null}
      </View>

      {pendingApprovalCount > 0 ? (
        <Text style={{ color: '#FDE68A', marginTop: 8, fontSize: 13, fontWeight: '600' }}>
          {pendingApprovalCount} public {pendingApprovalCount === 1 ? 'request needs' : 'requests need'} approval
        </Text>
      ) : null}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 14, paddingBottom: 4 }}
      >
        {STATUS_FILTER_OPTIONS.map((option) => {
          const isSelected = statusFilter === option.key;

          return (
            <TouchableOpacity
              key={option.key}
              onPress={() => setStatusFilter(option.key)}
              style={{
                backgroundColor: isSelected ? '#231B3A' : '#15151B',
                borderColor: isSelected ? COLORS.accent : '#2D2D38',
                borderWidth: 1,
                borderRadius: 999,
                paddingHorizontal: 14,
                paddingVertical: 8,
                marginRight: 8,
              }}
            >
              <Text
                style={{
                  color: isSelected ? COLORS.textPrimary : COLORS.textSecondary,
                  fontWeight: '600',
                  fontSize: 13,
                }}
              >
                {option.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <SearchField
        value={searchQuery}
        onChangeText={setSearchQuery}
        placeholder="Search by client, service, date, or status"
        style={{ marginTop: 12 }}
      />

      <PrimaryButton
        title="+ New Booking"
        onPress={() => navigation.navigate(ROUTES.AddBooking)}
        style={{
          marginTop: 12,
        }}
      />

      <PrimaryButton
        title="Weekly Calendar"
        onPress={() => navigation.navigate(ROUTES.WeeklyCalendar)}
        style={{
          marginTop: 10,
        }}
      />

      <PrimaryButton
        title="Daily Schedule"
        onPress={() => navigation.navigate(ROUTES.DailySchedule)}
        style={{
          marginTop: 10,
        }}
      />

      {isBookingsLoading ? (
        <Text
          style={{
            color: COLORS.textSecondary,
            marginTop: 16,
          }}
        >
          Loading bookings...
        </Text>
      ) : null}

      {bookingsError ? (
        <Text
          style={{
            color: '#FCA5A5',
            marginTop: 12,
          }}
        >
          {bookingsError}
        </Text>
      ) : null}

      {showNoSearchResults ? (
        <View
          style={{
            marginTop: 16,
            backgroundColor: COLORS.card,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: '#2A2A33',
            padding: 18,
          }}
        >
          <Text style={{ color: COLORS.textPrimary, fontSize: 16, fontWeight: '700' }}>
            No bookings match your filters
          </Text>
          <Text style={{ color: COLORS.textSecondary, marginTop: 6, lineHeight: 20 }}>
            {hasSearchQuery
              ? 'Try a different client name, service, date, or status.'
              : 'Try another status filter or create a new booking.'}
          </Text>
        </View>
      ) : null}

      {showEmptyBookings ? (
        <View
          style={{
            marginTop: 16,
            backgroundColor: COLORS.card,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: '#2A2A33',
            padding: 18,
          }}
        >
          <Text style={{ color: COLORS.textPrimary, fontSize: 16, fontWeight: '700' }}>
            No bookings yet
          </Text>
          <Text style={{ color: COLORS.textSecondary, marginTop: 6, lineHeight: 20 }}>
            Create your first appointment to start managing your calendar.
          </Text>
        </View>
      ) : null}

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: tabBarHeight + insets.bottom + 24 }}
        keyboardShouldPersistTaps="handled"
      >
        {visibleBookings.map((booking) => {
          const status = booking.status || 'confirmed';
          const statusStyles = getStatusStyles(status);
          const isMuted = status === 'cancelled' || status === 'no_show';
          const showPublicRequestBadge = isPendingPublicRequest(booking);
          const customerPhone = String(booking.customer_phone || '').trim();
          const customerEmail = String(booking.customer_email || '').trim();

          return (
            <TouchableOpacity
              key={booking.id}
              activeOpacity={0.96}
              onPress={() =>
                navigation.navigate(ROUTES.BookingDetail, {
                  bookingId: booking.id,
                })
              }
              style={{
                backgroundColor: isMuted ? '#171419' : COLORS.card,
                padding: 18,
                borderRadius: 18,
                marginTop: 16,
                borderWidth: 1,
                borderColor: showPublicRequestBadge ? '#6B4C1A' : statusStyles.border,
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <Text
                  style={{
                    color: COLORS.textPrimary,
                    fontSize: 18,
                    flex: 1,
                    paddingRight: 10,
                    opacity: isMuted ? 0.8 : 1,
                  }}
                >
                  {booking.service} - {booking.time}
                </Text>

                <View style={{ alignItems: 'flex-end' }}>
                  {showPublicRequestBadge ? (
                    <View
                      style={{
                        backgroundColor: '#3A2A10',
                        borderColor: '#8B6914',
                        borderWidth: 1,
                        borderRadius: 999,
                        paddingHorizontal: 10,
                        paddingVertical: 4,
                        marginBottom: 6,
                      }}
                    >
                      <Text style={{ color: '#FCD34D', fontSize: 10, fontWeight: '700' }}>
                        PUBLIC REQUEST
                      </Text>
                    </View>
                  ) : null}

                  <View
                    style={{
                      backgroundColor: statusStyles.background,
                      borderColor: statusStyles.border,
                      borderWidth: 1,
                      borderRadius: 999,
                      paddingHorizontal: 10,
                      paddingVertical: 4,
                    }}
                  >
                    <Text style={{ color: statusStyles.text, fontSize: 11, fontWeight: '700' }}>
                      {getStatusLabel(status).toUpperCase()}
                    </Text>
                  </View>
                </View>
              </View>

              <Text
                style={{
                  color: COLORS.textSecondary,
                  marginTop: 4,
                  opacity: isMuted ? 0.85 : 1,
                }}
              >
                {booking.client_name} • {booking.date}
              </Text>

              {showPublicRequestBadge && (customerPhone || customerEmail) ? (
                <View style={{ marginTop: 8 }}>
                  {customerPhone ? (
                    <Text style={{ color: '#FDE68A', fontSize: 13, marginBottom: 2 }}>
                      Phone: {customerPhone}
                    </Text>
                  ) : null}
                  {customerEmail ? (
                    <Text style={{ color: '#FDE68A', fontSize: 13 }}>
                      Email: {customerEmail}
                    </Text>
                  ) : null}
                </View>
              ) : null}

              <Text
                style={{
                  color: COLORS.textSecondary,
                  marginTop: 4,
                  fontSize: 12,
                  opacity: isMuted ? 0.85 : 1,
                }}
              >
                {booking.notes || 'Customer appointment'}
              </Text>

              <Text
                style={{
                  color: COLORS.accent,
                  marginTop: 8,
                  fontWeight: '700',
                  opacity: isMuted ? 0.85 : 1,
                }}
              >
                ${Number(booking.price || 0).toFixed(2)}
              </Text>

              <View
                style={{
                  flexDirection: 'row',
                  marginTop: 14,
                }}
              >
                <TouchableOpacity
                  onPress={() =>
                    navigation.navigate(ROUTES.AddBooking, {
                      bookingId: booking.id,
                    })
                  }
                  style={{
                    backgroundColor: COLORS.accent,
                    paddingVertical: 10,
                    paddingHorizontal: 18,
                    borderRadius: 12,
                    marginRight: 10,
                  }}
                >
                  <Text
                    style={{
                      color: COLORS.textPrimary,
                      fontWeight: '600',
                    }}
                  >
                    Edit
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => onChangeStatus(booking)}
                  style={{
                    backgroundColor: '#15151B',
                    borderColor: '#2D2D38',
                    borderWidth: 1,
                    paddingVertical: 10,
                    paddingHorizontal: 14,
                    borderRadius: 12,
                    marginRight: 10,
                  }}
                >
                  <Text
                    style={{
                      color: COLORS.textPrimary,
                      fontWeight: '600',
                    }}
                  >
                    Status
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => onDeleteBooking(booking.id)}
                  style={{
                    backgroundColor: '#2A1618',
                    borderColor: '#5A252A',
                    borderWidth: 1,
                    paddingVertical: 10,
                    paddingHorizontal: 18,
                    borderRadius: 12,
                  }}
                >
                  <Text
                    style={{
                      color: '#FCA5A5',
                      fontWeight: '600',
                    }}
                  >
                    Delete
                  </Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </ScreenContainer>
  );
}
