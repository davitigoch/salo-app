import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, ScrollView, Text, TouchableOpacity, View } from 'react-native';

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
  const [clientContact, setClientContact] = useState({ phone: '', email: '' });
  const [isLoading, setIsLoading] = useState(true);
  const [isStatusUpdating, setIsStatusUpdating] = useState(false);
  const [error, setError] = useState('');

  const fetchBooking = useCallback(async () => {
    setIsLoading(true);
    setError('');

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

      const { data: clientRows, error: clientError } = await supabase
        .from('clients')
        .select('phone, email, created_at')
        .eq('user_id', data.user_id)
        .eq('client_name', data.client_name)
        .order('created_at', { ascending: false })
        .limit(1);

      if (!clientError && Array.isArray(clientRows) && clientRows.length) {
        const matched = clientRows[0] || {};
        setClientContact({
          phone: String(matched.phone || '').trim(),
          email: String(matched.email || '').trim(),
        });
      } else {
        setClientContact({ phone: '', email: '' });
      }
    }

    setIsLoading(false);
  }, [bookingId]);

  useEffect(() => {
    fetchBooking();
  }, [fetchBooking]);

  const updateBookingStatus = async (nextStatus) => {
    if (!booking?.id) {
      return;
    }

    setIsStatusUpdating(true);

    const { data: updatedBooking, error: updateError } = await supabase
      .from('bookings')
      .update({
        status: nextStatus,
      })
      .eq('id', booking.id)
      .select('id, client_name, service, date, time, status, price, notes, staff_member_id, booking_metadata, user_id, created_at')
      .single();

    setIsStatusUpdating(false);

    if (updateError || !updatedBooking) {
      Alert.alert('Status update failed', updateError?.message || 'Could not update booking status.');
      return;
    }

    setBooking(updatedBooking);
  };

  const confirmStatusChange = ({ title, message, status, destructive = false }) => {
    Alert.alert(
      title,
      message,
      [
        { text: 'Keep Current', style: 'cancel' },
        {
          text: 'Confirm',
          style: destructive ? 'destructive' : 'default',
          onPress: () => updateBookingStatus(status),
        },
      ]
    );
  };

  const openContactUrl = async (url, unavailableMessage) => {
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (!canOpen) {
        Alert.alert('Unavailable', unavailableMessage);
        return;
      }
      await Linking.openURL(url);
    } catch (_error) {
      Alert.alert('Unavailable', unavailableMessage);
    }
  };

  const onCallClient = () => {
    const phone = String(clientContact.phone || '').trim();
    if (!phone) {
      Alert.alert('No phone number', 'No client phone number is available for this booking.');
      return;
    }
    openContactUrl(`tel:${phone}`, 'Unable to start a phone call on this device.');
  };

  const onTextClient = () => {
    const phone = String(clientContact.phone || '').trim();
    if (!phone) {
      Alert.alert('No phone number', 'No client phone number is available for this booking.');
      return;
    }
    openContactUrl(`sms:${phone}`, 'Unable to open texting on this device.');
  };

  const onEmailClient = () => {
    const email = String(clientContact.email || '').trim();
    if (!email) {
      Alert.alert('No email address', 'No client email is available for this booking.');
      return;
    }
    openContactUrl(`mailto:${email}`, 'Unable to open email on this device.');
  };

  const onRetry = () => {
    fetchBooking();
  };

  const statusStyles = getStatusStyles(booking?.status);
  const statusLabel = getStatusLabel(booking?.status);
  const staffName = booking?.booking_metadata?.staff_member_name || null;
  const hasPhone = Boolean(clientContact.phone);
  const hasEmail = Boolean(clientContact.email);

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
              <TouchableOpacity
                onPress={onRetry}
                style={{
                  marginTop: 12,
                  backgroundColor: '#15151B',
                  borderWidth: 1,
                  borderColor: '#2D2D38',
                  borderRadius: 10,
                  paddingHorizontal: 12,
                  paddingVertical: 9,
                  alignSelf: 'flex-start',
                }}
              >
                <Text style={{ color: COLORS.textPrimary, fontWeight: '700' }}>Retry</Text>
              </TouchableOpacity>
          </View>
        ) : booking ? (
          <>
            <View style={{ flexDirection: 'row', marginBottom: 20, marginTop: 4 }}>
              <View
                style={{
                  backgroundColor: statusStyles.background,
                  borderColor: statusStyles.border,
                  borderWidth: 1,
                  borderRadius: 999,
                  paddingHorizontal: 16,
                  paddingVertical: 6,
                }}
              >
                <Text style={{ color: statusStyles.text, fontWeight: '700', fontSize: 13 }}>
                  {statusLabel.toUpperCase()}
                </Text>
              </View>
            </View>

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
              <Text style={{ color: COLORS.textPrimary, fontSize: 22, fontWeight: '800', marginBottom: 16 }}>
                {booking.client_name}
              </Text>
              <DetailRow label="Service" value={booking.service} />
              <DetailRow label="Client" value={booking.client_name} />
              <DetailRow label="Date" value={booking.date} />
              <DetailRow label="Time" value={booking.time} />
              <DetailRow label="Staff Member" value={staffName || 'Unassigned'} />
              <DetailRow label="Price" value={booking.price != null ? `$${Number(booking.price).toFixed(2)}` : null} />
              <DetailRow label="Status" value={statusLabel} />
              <DetailRow label="Notes" value={booking.notes} />
            </View>

            <View
              style={{
                backgroundColor: COLORS.card,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: '#2A2A33',
                padding: 14,
                marginBottom: 14,
              }}
            >
              <Text style={{ color: COLORS.textPrimary, fontWeight: '700', fontSize: 16, marginBottom: 10 }}>
                Quick Actions
              </Text>

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 }}>
                <TouchableOpacity
                  onPress={() => navigation.navigate(ROUTES.AddBooking, { bookingId: booking.id })}
                  style={{
                    width: '50%',
                    paddingHorizontal: 4,
                    marginBottom: 8,
                  }}
                >
                  <View
                    style={{
                      backgroundColor: '#1F1A33',
                      borderColor: '#473A77',
                      borderWidth: 1,
                      borderRadius: 12,
                      paddingVertical: 11,
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ color: '#DDD6FE', fontWeight: '700' }}>Edit Booking</Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => navigation.navigate(ROUTES.AddBooking, { bookingId: booking.id })}
                  style={{
                    width: '50%',
                    paddingHorizontal: 4,
                    marginBottom: 8,
                  }}
                >
                  <View
                    style={{
                      backgroundColor: '#141C2A',
                      borderColor: '#2F476A',
                      borderWidth: 1,
                      borderRadius: 12,
                      paddingVertical: 11,
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ color: '#BFDBFE', fontWeight: '700' }}>Reschedule</Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => confirmStatusChange({
                    title: 'Cancel booking?',
                    message: 'This appointment will be marked as cancelled.',
                    status: 'cancelled',
                    destructive: true,
                  })}
                  style={{
                    width: '50%',
                    paddingHorizontal: 4,
                    marginBottom: 8,
                  }}
                >
                  <View
                    style={{
                      backgroundColor: '#2A1618',
                      borderColor: '#5A252A',
                      borderWidth: 1,
                      borderRadius: 12,
                      paddingVertical: 11,
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ color: '#FCA5A5', fontWeight: '700' }}>Cancel Booking</Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => updateBookingStatus('completed')}
                  style={{
                    width: '50%',
                    paddingHorizontal: 4,
                    marginBottom: 8,
                  }}
                  disabled={isStatusUpdating}
                >
                  <View
                    style={{
                      backgroundColor: '#153325',
                      borderColor: '#24543A',
                      borderWidth: 1,
                      borderRadius: 12,
                      paddingVertical: 11,
                      alignItems: 'center',
                      opacity: isStatusUpdating ? 0.7 : 1,
                    }}
                  >
                    <Text style={{ color: '#86EFAC', fontWeight: '700' }}>Mark Completed</Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => confirmStatusChange({
                    title: 'Mark as no-show?',
                    message: 'This appointment will be marked as no-show.',
                    status: 'no_show',
                    destructive: true,
                  })}
                  style={{
                    width: '100%',
                    paddingHorizontal: 4,
                    marginBottom: 2,
                  }}
                >
                  <View
                    style={{
                      backgroundColor: '#251A2F',
                      borderColor: '#4D2C63',
                      borderWidth: 1,
                      borderRadius: 12,
                      paddingVertical: 11,
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ color: '#D8B4FE', fontWeight: '700' }}>Mark No Show</Text>
                  </View>
                </TouchableOpacity>
              </View>
            </View>

            <View
              style={{
                backgroundColor: COLORS.card,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: '#2A2A33',
                padding: 14,
              }}
            >
              <Text style={{ color: COLORS.textPrimary, fontWeight: '700', fontSize: 16, marginBottom: 10 }}>
                Contact Client
              </Text>

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 }}>
                <TouchableOpacity
                  onPress={onCallClient}
                  disabled={!hasPhone}
                  style={{ width: '33.33%', paddingHorizontal: 4 }}
                >
                  <View
                    style={{
                      backgroundColor: '#171723',
                      borderColor: '#2F476A',
                      borderWidth: 1,
                      borderRadius: 12,
                      paddingVertical: 10,
                      alignItems: 'center',
                      opacity: hasPhone ? 1 : 0.5,
                    }}
                  >
                    <Text style={{ color: '#93C5FD', fontWeight: '700', fontSize: 12 }}>Call Client</Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={onTextClient}
                  disabled={!hasPhone}
                  style={{ width: '33.33%', paddingHorizontal: 4 }}
                >
                  <View
                    style={{
                      backgroundColor: '#171723',
                      borderColor: '#2F476A',
                      borderWidth: 1,
                      borderRadius: 12,
                      paddingVertical: 10,
                      alignItems: 'center',
                      opacity: hasPhone ? 1 : 0.5,
                    }}
                  >
                    <Text style={{ color: '#93C5FD', fontWeight: '700', fontSize: 12 }}>Text Client</Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={onEmailClient}
                  disabled={!hasEmail}
                  style={{ width: '33.33%', paddingHorizontal: 4 }}
                >
                  <View
                    style={{
                      backgroundColor: '#171723',
                      borderColor: '#2F476A',
                      borderWidth: 1,
                      borderRadius: 12,
                      paddingVertical: 10,
                      alignItems: 'center',
                      opacity: hasEmail ? 1 : 0.5,
                    }}
                  >
                    <Text style={{ color: '#93C5FD', fontWeight: '700', fontSize: 12 }}>Email Client</Text>
                  </View>
                </TouchableOpacity>
              </View>

              {!hasPhone && !hasEmail ? (
                <Text style={{ color: COLORS.textSecondary, marginTop: 10, fontSize: 12 }}>
                  Contact information is not available for this client.
                </Text>
              ) : null}
            </View>
          </>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}
