import React, { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native';

import BackButton from '../components/BackButton';
import ScreenContainer from '../components/ScreenContainer';
import { COLORS } from '../constants/colors';
import { ROUTES } from '../constants/routes';
import { supabase } from '../constants/supabase';

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

function DetailRow({ label, value }) {
  if (!value) {
    return null;
  }
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ color: COLORS.textSecondary, fontSize: 12, fontWeight: '600', letterSpacing: 0.5 }}>
        {label.toUpperCase()}
      </Text>
      <Text style={{ color: COLORS.textPrimary, fontSize: 16, marginTop: 3, lineHeight: 22 }}>
        {value}
      </Text>
    </View>
  );
}

export default function BookingDetailScreen({ navigation, route }) {
  const bookingId = route?.params?.bookingId;

  const [booking, setBooking] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchBooking = useCallback(async () => {
    if (!bookingId) {
      setError('No booking ID provided.');
      setIsLoading(false);
      return;
    }

    const { data, error: fetchError } = await supabase
      .from('bookings')
      .select('id, client_name, service, date, time, status, price, notes, staff_member_id, booking_metadata, user_id, created_at')
      .eq('id', bookingId)
      .single();

    if (fetchError) {
      setError(fetchError.message);
    } else {
      setBooking(data);
    }

    setIsLoading(false);
  }, [bookingId]);

  useEffect(() => {
    fetchBooking();
  }, [fetchBooking]);

  const statusStyles = getStatusStyles(booking?.status);

  return (
    <ScreenContainer style={{ padding: 0 }}>
      <BackButton navigation={navigation} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 90, paddingHorizontal: 24, paddingBottom: 60 }}
      >
        <Text
          style={{
            color: COLORS.textPrimary,
            fontSize: 28,
            fontWeight: '700',
            marginBottom: 4,
          }}
        >
          Booking Details
        </Text>

        {isLoading ? (
          <Text style={{ color: COLORS.textSecondary, marginTop: 40, textAlign: 'center' }}>
            Loading booking...
          </Text>
        ) : error ? (
          <View
            style={{
              backgroundColor: '#342023',
              borderColor: '#5A252A',
              borderWidth: 1,
              borderRadius: 14,
              padding: 16,
              marginTop: 20,
            }}
          >
            <Text style={{ color: '#FCA5A5', fontWeight: '700' }}>Unable to load booking</Text>
            <Text style={{ color: '#FCA5A5', marginTop: 4, fontSize: 13 }}>{error}</Text>
          </View>
        ) : booking ? (
          <>
            {/* Status badge */}
            <View style={{ flexDirection: 'row', marginBottom: 20, marginTop: 4 }}>
              <View
                style={{
                  backgroundColor: statusStyles.background,
                  borderColor: statusStyles.border,
                  borderWidth: 1,
                  borderRadius: 999,
                  paddingHorizontal: 14,
                  paddingVertical: 5,
                }}
              >
                <Text style={{ color: statusStyles.text, fontWeight: '700', fontSize: 12 }}>
                  {getStatusLabel(booking.status).toUpperCase()}
                </Text>
              </View>
            </View>

            {/* Detail card */}
            <View
              style={{
                backgroundColor: COLORS.card,
                borderRadius: 18,
                borderWidth: 1,
                borderColor: '#2A2A33',
                padding: 20,
                marginBottom: 14,
              }}
            >
              <DetailRow label="Service" value={booking.service} />
              <DetailRow label="Client" value={booking.client_name} />
              <DetailRow label="Date" value={booking.date} />
              <DetailRow label="Time" value={booking.time} />
              <DetailRow label="Price" value={booking.price != null ? `$${Number(booking.price).toFixed(2)}` : null} />
              <DetailRow label="Notes" value={booking.notes} />
            </View>

            {/* Edit button */}
            <TouchableOpacity
              onPress={() => navigation.navigate(ROUTES.AddBooking, { bookingId: booking.id })}
              activeOpacity={0.85}
              style={{
                backgroundColor: COLORS.accent,
                borderRadius: 14,
                paddingVertical: 14,
                alignItems: 'center',
                marginTop: 4,
              }}
            >
              <Text style={{ color: COLORS.textPrimary, fontWeight: '700', fontSize: 16 }}>
                Edit Booking
              </Text>
            </TouchableOpacity>
          </>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}
