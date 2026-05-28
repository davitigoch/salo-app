import React from 'react';
import { Alert, TouchableOpacity, View, Text } from 'react-native';

import PrimaryButton from '../components/PrimaryButton';
import ScreenContainer from '../components/ScreenContainer';
import { COLORS } from '../constants/colors';
import { useBookings } from '../context/BookingsContext';
import { ROUTES } from '../constants/routes';

const STATUS_OPTIONS = ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'];

function getStatusLabel(status) {
  switch (status) {
    case 'pending':
      return 'Pending';
    case 'confirmed':
      return 'Confirmed';
    case 'completed':
      return 'Completed';
    case 'cancelled':
      return 'Cancelled';
    case 'no_show':
      return 'No-show';
    default:
      return 'Confirmed';
  }
}

function getStatusStyles(status) {
  switch (status) {
    case 'pending':
      return { background: '#2B2310', text: '#FDE68A', border: '#5B4B1A' };
    case 'confirmed':
      return { background: '#122A42', text: '#93C5FD', border: '#25476B' };
    case 'completed':
      return { background: '#153325', text: '#86EFAC', border: '#1F4A34' };
    case 'cancelled':
      return { background: '#342023', text: '#FCA5A5', border: '#5A252A' };
    case 'no_show':
      return { background: '#301F35', text: '#D8B4FE', border: '#5B2C69' };
    default:
      return { background: '#122A42', text: '#93C5FD', border: '#25476B' };
  }
}

export default function BookingsScreen({ navigation }) {
  const { bookings, isBookingsLoading, bookingsError, deleteBooking, updateBooking } = useBookings();

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
        Bookings
      </Text>

      <PrimaryButton
        title="+ New Booking"
        onPress={() => navigation.navigate(ROUTES.AddBooking)}
        style={{
          marginTop: 16,
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

      {bookings.map((booking) => {
        const status = booking.status || 'confirmed';
        const statusStyles = getStatusStyles(status);
        const isMuted = status === 'cancelled' || status === 'no_show';

        return (
        <View
          key={booking.id}
          style={{
            backgroundColor: isMuted ? '#171419' : COLORS.card,
            padding: 18,
            borderRadius: 18,
            marginTop: 16,
            borderWidth: 1,
            borderColor: statusStyles.border,
          }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text
            style={{
              color: COLORS.textPrimary,
              fontSize: 18,
              opacity: isMuted ? 0.8 : 1,
            }}
          >
            {booking.service} - {booking.time}
          </Text>

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

          <Text
            style={{
              color: COLORS.textSecondary,
              marginTop: 4,
              opacity: isMuted ? 0.85 : 1,
            }}
          >
            {booking.client_name} • {booking.date}
          </Text>

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
        </View>
      );})}
    </ScreenContainer>
  );
}
