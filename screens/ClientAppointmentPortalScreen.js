import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';

import BackButton from '../components/BackButton';
import PrimaryButton from '../components/PrimaryButton';
import ScreenContainer from '../components/ScreenContainer';
import {
  formatDateValue,
  generateAvailableTimeSlots,
} from '../constants/bookingSlots';
import { COLORS } from '../constants/colors';
import { supabase } from '../constants/supabase';

function parseDateValue(value) {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return new Date();
  }
  return parsed;
}

function formatPortalDate(dateValue) {
  return dateValue.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
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

function getPaymentStyles(status) {
  switch (status) {
    case 'succeeded':
    case 'paid':
      return { background: '#153325', text: '#86EFAC', border: '#1F4A34', label: 'Paid' };
    case 'pending':
      return { background: '#2B2310', text: '#FDE68A', border: '#5B4B1A', label: 'Pending' };
    case 'failed':
      return { background: '#342023', text: '#FCA5A5', border: '#5A252A', label: 'Failed' };
    case 'refunded':
      return { background: '#122A42', text: '#93C5FD', border: '#25476B', label: 'Refunded' };
    default:
      return { background: '#16161D', text: '#D4D4D8', border: '#2D2D38', label: 'Unpaid' };
  }
}

export default function ClientAppointmentPortalScreen({ route, navigation }) {
  const bookingToken = route?.params?.booking_token;

  const [appointment, setAppointment] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedSlotTime, setSelectedSlotTime] = useState('');
  const [isDateInitialized, setIsDateInitialized] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [isRescheduling, setIsRescheduling] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  const loadAppointment = async ({ targetDate = null, initializeDate = false } = {}) => {
    if (!bookingToken) {
      setError('Invalid appointment link.');
      setIsLoading(false);
      return;
    }

    setError('');

    const { data, error: rpcError } = await supabase.rpc('get_appointment_by_token', {
      p_booking_token: bookingToken,
      p_target_date: targetDate,
    });

    if (rpcError) {
      setError(rpcError.message || 'Unable to load appointment.');
      setIsLoading(false);
      return;
    }

    const row = Array.isArray(data) ? data[0] : null;
    if (!row) {
      setError('Appointment not found. Please check your link.');
      setIsLoading(false);
      return;
    }

    setAppointment(row);

    if (initializeDate) {
      const appointmentDate = parseDateValue(row.date);
      setSelectedDate(appointmentDate);
      setIsDateInitialized(true);
    }

    setIsLoading(false);
  };

  useEffect(() => {
    setIsLoading(true);
    loadAppointment({ initializeDate: true });
  }, [bookingToken]);

  useEffect(() => {
    if (!isDateInitialized) {
      return;
    }

    loadAppointment({ targetDate: formatDateValue(selectedDate), initializeDate: false });
  }, [isDateInitialized, selectedDate]);

  const serviceDuration = Number(appointment?.service_duration_minutes || 0);
  const staffMembers = useMemo(() => appointment?.staff_members || [], [appointment?.staff_members]);
  const businessHours = useMemo(() => appointment?.business_hours || [], [appointment?.business_hours]);
  const staffAvailability = useMemo(() => appointment?.staff_availability || [], [appointment?.staff_availability]);
  const bookedSlots = useMemo(() => appointment?.booked_slots || [], [appointment?.booked_slots]);

  const slotsResult = generateAvailableTimeSlots({
    businessHours,
    date: selectedDate,
    serviceDurationMinutes: serviceDuration,
    existingBookings: bookedSlots,
    staffMembers,
    selectedStaffId: appointment?.staff_member_id || '',
    staffAvailability,
    stepMinutes: 15,
    excludeBookingId: appointment?.booking_id,
  });

  useEffect(() => {
    if (!slotsResult.slots.length) {
      setSelectedSlotTime('');
      return;
    }

    if (!slotsResult.slots.some((slot) => slot.value === selectedSlotTime)) {
      setSelectedSlotTime(slotsResult.slots[0].value);
    }
  }, [selectedSlotTime, slotsResult.slots]);

  const onCancelAppointment = () => {
    if (!appointment) {
      return;
    }

    Alert.alert(
      'Cancel appointment?',
      'This will cancel your appointment and keep the link active for reference.',
      [
        { text: 'Keep Appointment', style: 'cancel' },
        {
          text: 'Cancel Appointment',
          style: 'destructive',
          onPress: async () => {
            setIsCancelling(true);
            const { data, error: cancelError } = await supabase.rpc('cancel_appointment_by_token', {
              p_booking_token: bookingToken,
            });
            setIsCancelling(false);

            if (cancelError) {
              Alert.alert('Cancel failed', cancelError.message);
              return;
            }

            const result = Array.isArray(data) ? data[0] : null;
            if (!result?.success) {
              Alert.alert('Cancel failed', result?.message || 'Unable to cancel appointment.');
              return;
            }

            setNotice('Your appointment was cancelled');
            await loadAppointment({ targetDate: formatDateValue(selectedDate) });
          },
        },
      ]
    );
  };

  const onReschedule = async () => {
    if (!selectedSlotTime) {
      Alert.alert('No time selected', 'Please choose an available time slot first.');
      return;
    }

    setIsRescheduling(true);

    const { data, error: rescheduleError } = await supabase.rpc('reschedule_appointment_by_token', {
      p_booking_token: bookingToken,
      p_new_date: formatDateValue(selectedDate),
      p_new_time: selectedSlotTime,
    });

    setIsRescheduling(false);

    if (rescheduleError) {
      Alert.alert('Reschedule failed', rescheduleError.message);
      return;
    }

    const result = Array.isArray(data) ? data[0] : null;

    if (!result?.success) {
      const message = result?.message || 'Unable to reschedule appointment.';
      Alert.alert('Reschedule failed', message);
      if (message.toLowerCase().includes('no available times')) {
        setNotice('No available times for this date');
      }
      return;
    }

    setNotice('Your appointment was rescheduled');
    await loadAppointment({ targetDate: formatDateValue(selectedDate) });
  };

  if (isLoading) {
    return (
      <ScreenContainer centered style={{ padding: 24 }}>
        <Text style={{ color: COLORS.textSecondary }}>Loading appointment...</Text>
      </ScreenContainer>
    );
  }

  if (error) {
    return (
      <ScreenContainer centered style={{ padding: 24 }}>
        <Text style={{ color: COLORS.textPrimary, fontSize: 28, fontWeight: '700' }}>SALO</Text>
        <Text style={{ color: COLORS.textSecondary, textAlign: 'center', marginTop: 10 }}>{error}</Text>
      </ScreenContainer>
    );
  }

  const statusStyles = getStatusStyles(appointment?.status || 'confirmed');
  const paymentStyles = getPaymentStyles(appointment?.payment_status || 'unpaid');

  return (
    <ScreenContainer style={{ paddingTop: 0 }}>
      <BackButton navigation={navigation} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 88, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
        >
          <Text style={{ color: COLORS.textPrimary, fontSize: 30, fontWeight: '700' }}>Manage Appointment</Text>
          <Text style={{ color: COLORS.textSecondary, marginTop: 8 }}>
            {appointment?.business_name || 'SALO'}
          </Text>

          {notice ? (
            <View
              style={{
                marginTop: 16,
                backgroundColor: '#13231B',
                borderColor: '#1F4A34',
                borderWidth: 1,
                borderRadius: 14,
                padding: 12,
              }}
            >
              <Text style={{ color: '#BBF7D0' }}>{notice}</Text>
            </View>
          ) : null}

          <View
            style={{
              marginTop: 16,
              backgroundColor: COLORS.card,
              borderColor: '#2A2A33',
              borderWidth: 1,
              borderRadius: 18,
              padding: 16,
            }}
          >
            <Text style={{ color: COLORS.textPrimary, fontSize: 20, fontWeight: '700' }}>
              {appointment?.service}
            </Text>
            <Text style={{ color: COLORS.textSecondary, marginTop: 4 }}>
              {appointment?.date} at {appointment?.time}
            </Text>
            <Text style={{ color: COLORS.textSecondary, marginTop: 4 }}>
              Duration: {serviceDuration} mins
            </Text>
            <Text style={{ color: COLORS.accent, marginTop: 6, fontWeight: '700' }}>
              ${Number(appointment?.price || 0).toFixed(2)}
            </Text>

            <View style={{ flexDirection: 'row', marginTop: 12, flexWrap: 'wrap' }}>
              <View
                style={{
                  backgroundColor: statusStyles.background,
                  borderColor: statusStyles.border,
                  borderWidth: 1,
                  borderRadius: 999,
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  marginRight: 8,
                  marginBottom: 8,
                }}
              >
                <Text style={{ color: statusStyles.text, fontSize: 11, fontWeight: '700' }}>
                  {String(appointment?.status || 'confirmed').replace('_', ' ').toUpperCase()}
                </Text>
              </View>

              <View
                style={{
                  backgroundColor: paymentStyles.background,
                  borderColor: paymentStyles.border,
                  borderWidth: 1,
                  borderRadius: 999,
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  marginBottom: 8,
                }}
              >
                <Text style={{ color: paymentStyles.text, fontSize: 11, fontWeight: '700' }}>
                  PAYMENT {paymentStyles.label.toUpperCase()}
                </Text>
              </View>
            </View>

            <Text style={{ color: COLORS.textSecondary, marginTop: 2 }}>
              Staff: {appointment?.staff_member_name || 'No preference'}
            </Text>
          </View>

          <View style={{ marginTop: 14 }}>
            <PrimaryButton title="Add to Calendar (Soon)" onPress={() => Alert.alert('Coming soon', 'Calendar export will be available soon.')} />
          </View>

          <View
            style={{
              marginTop: 14,
              backgroundColor: '#13131C',
              borderColor: '#2A2A33',
              borderWidth: 1,
              borderRadius: 18,
              padding: 16,
            }}
          >
            <Text style={{ color: COLORS.textPrimary, fontSize: 18, fontWeight: '700' }}>Reschedule</Text>
            <Text style={{ color: COLORS.textSecondary, marginTop: 5, marginBottom: 10 }}>
              Pick a new date and available time.
            </Text>

            <TouchableOpacity
              onPress={() => setShowDatePicker(true)}
              style={{
                backgroundColor: '#15151B',
                borderColor: '#2D2D38',
                borderWidth: 1,
                borderRadius: 12,
                paddingHorizontal: 14,
                paddingVertical: 12,
                marginBottom: 10,
              }}
            >
              <Text style={{ color: COLORS.textPrimary }}>{formatPortalDate(selectedDate)}</Text>
            </TouchableOpacity>

            {showDatePicker ? (
              <View
                style={{
                  backgroundColor: COLORS.card,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: '#27272A',
                  marginBottom: 10,
                }}
              >
                <DateTimePicker
                  value={selectedDate}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={(_event, selectedValue) => {
                    if (Platform.OS !== 'ios') {
                      setShowDatePicker(false);
                    }
                    if (selectedValue) {
                      setSelectedDate(selectedValue);
                    }
                  }}
                  themeVariant="dark"
                />
              </View>
            ) : null}

            {Platform.OS === 'ios' && showDatePicker ? (
              <PrimaryButton
                title="Done"
                onPress={() => setShowDatePicker(false)}
                style={{ marginBottom: 10 }}
              />
            ) : null}

            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {slotsResult.slots.map((slot) => {
                const isSelected = selectedSlotTime === slot.value;
                return (
                  <TouchableOpacity
                    key={slot.value}
                    onPress={() => setSelectedSlotTime(slot.value)}
                    style={{
                      backgroundColor: isSelected ? '#231B3A' : '#15151B',
                      borderColor: isSelected ? COLORS.accent : '#2D2D38',
                      borderWidth: 1,
                      borderRadius: 12,
                      paddingHorizontal: 14,
                      paddingVertical: 10,
                      marginRight: 8,
                      marginBottom: 8,
                    }}
                  >
                    <Text style={{ color: COLORS.textPrimary, fontWeight: '600' }}>{slot.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {!slotsResult.slots.length ? (
              <Text style={{ color: '#FCA5A5', marginTop: 2 }}>
                {slotsResult.reason || 'No available times for this date'}
              </Text>
            ) : null}

            <PrimaryButton
              title={isRescheduling ? 'Rescheduling...' : 'Reschedule Appointment'}
              onPress={onReschedule}
              style={{ marginTop: 10 }}
            />
          </View>

          <View style={{ marginTop: 14 }}>
            <PrimaryButton
              title={isCancelling ? 'Cancelling...' : 'Cancel Appointment'}
              onPress={onCancelAppointment}
              style={{ backgroundColor: '#2A1618' }}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}
