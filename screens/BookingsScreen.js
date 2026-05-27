import React from 'react';
import { Alert, TouchableOpacity, View, Text } from 'react-native';

import PrimaryButton from '../components/PrimaryButton';
import ScreenContainer from '../components/ScreenContainer';
import { COLORS } from '../constants/colors';
import { useBookings } from '../context/BookingsContext';
import { ROUTES } from '../constants/routes';

export default function BookingsScreen({ navigation }) {
  const { bookings, isBookingsLoading, bookingsError, deleteBooking } = useBookings();

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

      {bookings.map((booking) => (
        <View
          key={booking.id}
          style={{
            backgroundColor: COLORS.card,
            padding: 18,
            borderRadius: 18,
            marginTop: 16,
          }}
        >
          <Text
            style={{
              color: COLORS.textPrimary,
              fontSize: 18,
            }}
          >
            {booking.service} - {booking.time}
          </Text>

          <Text
            style={{
              color: COLORS.textSecondary,
              marginTop: 4,
            }}
          >
            {booking.client_name} • {booking.date}
          </Text>

          <Text
            style={{
              color: COLORS.textSecondary,
              marginTop: 4,
              fontSize: 12,
            }}
          >
            {booking.notes || 'Customer appointment'}
          </Text>

          <Text
            style={{
              color: COLORS.accent,
              marginTop: 8,
              fontWeight: '700',
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
      ))}
    </ScreenContainer>
  );
}
