import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  Share,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';

import PrimaryButton from '../components/PrimaryButton';
import ScreenContainer from '../components/ScreenContainer';
import {
  useNavigation,
} from '@react-navigation/native';

import {
  formatDateValue,
  generateAvailableTimeSlots,
} from '../constants/bookingSlots';
import { COLORS } from '../constants/colors';
import { supabase } from '../constants/supabase';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

const TRACE_PREFIX = '[AppointmentPortalTrace]';

function parseIsoDateParts(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  return { year, month, day };
}

function parseTimeParts(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    return null;
  }

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return { hours, minutes };
}

function parseDateValue(value) {
  const parts = parseIsoDateParts(value);
  if (!parts) {
    console.log(`${TRACE_PREFIX} parseDateValue received invalid date`, { input: value });
    return new Date();
  }

  const constructorArgs = {
    year: parts.year,
    monthIndex: parts.month - 1,
    day: parts.day,
    hours: 0,
    minutes: 0,
    seconds: 0,
    milliseconds: 0,
  };
  const parsed = new Date(
    constructorArgs.year,
    constructorArgs.monthIndex,
    constructorArgs.day,
    constructorArgs.hours,
    constructorArgs.minutes,
    constructorArgs.seconds,
    constructorArgs.milliseconds
  );

  console.log(`${TRACE_PREFIX} value passed into Date constructor`, {
    source: 'parseDateValue',
    input: value,
    constructorArgs,
    parsedIso: parsed.toISOString(),
  });

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

function formatPortalAppointmentDateTime(dateText, bookingTimeText) {
  const dateParts = parseIsoDateParts(dateText);
  const timeParts = parseTimeParts(bookingTimeText);

  if (!dateParts) {
    return `${dateText || 'Unknown date'} at ${bookingTimeText || 'Unknown time'}`;
  }

  const constructorArgs = {
    year: dateParts.year,
    monthIndex: dateParts.month - 1,
    day: dateParts.day,
    hours: timeParts?.hours || 0,
    minutes: timeParts?.minutes || 0,
    seconds: 0,
    milliseconds: 0,
  };

  const parsed = new Date(
    constructorArgs.year,
    constructorArgs.monthIndex,
    constructorArgs.day,
    constructorArgs.hours,
    constructorArgs.minutes,
    constructorArgs.seconds,
    constructorArgs.milliseconds
  );

  console.log(`${TRACE_PREFIX} value passed into Date constructor`, {
    source: 'formatPortalAppointmentDateTime',
    input: { dateText, bookingTimeText },
    constructorArgs,
    parsedIso: parsed.toISOString(),
  });

  if (Number.isNaN(parsed.getTime())) {
    return `${dateText || 'Unknown date'} at ${bookingTimeText || 'Unknown time'}`;
  }

  const formattedDate = parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const formattedTime = parsed.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return `${formattedDate} at ${formattedTime}`;
}

function formatUtcForCalendar(dateValue) {
  return dateValue
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

function formatFloatingForIcs(dateValue) {
  const year = dateValue.getFullYear();
  const month = String(dateValue.getMonth() + 1).padStart(2, '0');
  const day = String(dateValue.getDate()).padStart(2, '0');
  const hours = String(dateValue.getHours()).padStart(2, '0');
  const minutes = String(dateValue.getMinutes()).padStart(2, '0');
  const seconds = String(dateValue.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}T${hours}${minutes}${seconds}`;
}

function sanitizeIcsText(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function createIcsEventContent({
  uid,
  summary,
  description,
  location,
  startDate,
  endDate,
}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'PRODID:-//SALO//Appointment Portal//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${formatUtcForCalendar(new Date())}`,
    `DTSTART:${formatFloatingForIcs(startDate)}`,
    `DTEND:${formatFloatingForIcs(endDate)}`,
    `SUMMARY:${sanitizeIcsText(summary)}`,
    `DESCRIPTION:${sanitizeIcsText(description)}`,
    `LOCATION:${sanitizeIcsText(location)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return `${lines.join('\r\n')}\r\n`;
}

function buildGoogleCalendarLink({ title, description, location, startDate, endDate }) {
  const query = [
    ['action', 'TEMPLATE'],
    ['text', title],
    ['details', description],
    ['location', location],
    ['dates', `${formatUtcForCalendar(startDate)}/${formatUtcForCalendar(endDate)}`],
  ]
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');

  return `https://calendar.google.com/calendar/render?${query}`;
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

export default function ClientAppointmentPortalScreen({ route }) {
  const navigation = useNavigation();
  const bookingToken = route?.params?.bookingToken || route?.params?.booking_token;

  useEffect(() => {
    console.log('[ClientAppointmentPortal] route params', {
      routeParams: route?.params || null,
      bookingToken,
    });
  }, [route?.params, bookingToken]);

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

  // Silently register customer push token so reminders and lifecycle
  // events can be delivered to this device.  Failures are swallowed —
  // push is best-effort and must never block the portal UI.
  const registerCustomerPushToken = useCallback(async (token) => {
    if (!token) {
      return;
    }
    try {
      const projectId =
        Constants?.expoConfig?.extra?.eas?.projectId ||
        Constants?.easConfig?.projectId ||
        null;
      if (!projectId) {
        return;
      }
      const permResult = await Notifications.getPermissionsAsync();
      let permStatus = permResult.status;
      if (permStatus !== 'granted') {
        const requested = await Notifications.requestPermissionsAsync({
          ios: { allowAlert: true, allowBadge: true, allowSound: true },
        });
        permStatus = requested.status;
      }
      if (permStatus !== 'granted') {
        return;
      }
      const tokenResponse = await Notifications.getExpoPushTokenAsync({ projectId });
      const expoPushToken = tokenResponse?.data;
      if (!expoPushToken || typeof expoPushToken !== 'string') {
        return;
      }
      await supabase.rpc('register_customer_push_token', {
        p_booking_token: token,
        p_expo_push_token: expoPushToken,
      });
    } catch (_err) {
      // Intentionally silent — push is best-effort.
    }
  }, []);

  useEffect(() => {
    if (bookingToken) {
      registerCustomerPushToken(bookingToken);
    }
  }, [bookingToken, registerCustomerPushToken]);

  const appointmentDate = appointment?.date || '';
  const appointmentTime = appointment?.booking_time || '';
  const appointmentDateTimeLabel = useMemo(
    () => formatPortalAppointmentDateTime(appointmentDate, appointmentTime),
    [appointmentDate, appointmentTime]
  );

  const loadFallbackSchedulingData = async ({ businessId, targetDate }) => {
    if (!businessId || !targetDate) {
      return null;
    }

    const [staffResult, availabilityResult, hoursResult, bookedSlotsResult] = await Promise.all([
      supabase.rpc('get_public_staff_members', {
        target_business_id: businessId,
      }),
      supabase.rpc('get_public_staff_availability', {
        target_business_id: businessId,
      }),
      supabase
        .from('business_hours')
        .select('weekday, is_closed, open_time, close_time')
        .eq('business_id', businessId)
        .order('weekday', { ascending: true }),
      supabase.rpc('get_business_booked_slots', {
        target_business_id: businessId,
        target_date: targetDate,
      }),
    ]);

    if (staffResult.error || availabilityResult.error || hoursResult.error || bookedSlotsResult.error) {
      console.log(`${TRACE_PREFIX} fallback scheduling data load failed`, {
        businessId,
        targetDate,
        staffError: staffResult.error?.message || null,
        availabilityError: availabilityResult.error?.message || null,
        hoursError: hoursResult.error?.message || null,
        bookedSlotsError: bookedSlotsResult.error?.message || null,
      });
      return null;
    }

    return {
      staff_members: Array.isArray(staffResult.data) ? staffResult.data : [],
      staff_availability: Array.isArray(availabilityResult.data) ? availabilityResult.data : [],
      business_hours: Array.isArray(hoursResult.data) ? hoursResult.data : [],
      booked_slots: (bookedSlotsResult.data || []).map((item) => ({
        id: item.id,
        time: item.booking_time,
        staff_member_id: item.staff_member_id,
        booking_metadata: {
          service_duration_minutes: item.duration_minutes,
        },
      })),
    };
  };

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
    console.log(`${TRACE_PREFIX} value returned by RPC`, {
      bookingToken,
      targetDate,
      row,
    });

    if (!row) {
      setError('Appointment not found. Please check your link.');
      setIsLoading(false);
      return;
    }

    const rpcDateValue = row.date || null;
    const rpcBookingTimeValue = row.booking_time || null;

    if (!rpcDateValue || !rpcBookingTimeValue) {
      setError('Appointment data is invalid. Please contact support.');
      setIsLoading(false);
      return;
    }

    console.log(`${TRACE_PREFIX} trace values`, {
      rawDateFromDatabase: rpcDateValue,
      rawBookingTimeFromDatabase: rpcBookingTimeValue,
      valueReturnedByRpc: {
        date: rpcDateValue,
        booking_time: rpcBookingTimeValue,
      },
      valueReceivedByFrontend: {
        date: rpcDateValue,
        booking_time: rpcBookingTimeValue,
      },
    });

    let appointmentRow = {
      ...row,
      date: rpcDateValue,
      booking_time: rpcBookingTimeValue,
    };

    const hasSchedulingData =
      Array.isArray(appointmentRow.staff_members)
      && appointmentRow.staff_members.length > 0
      && Array.isArray(appointmentRow.staff_availability)
      && Array.isArray(appointmentRow.business_hours)
      && appointmentRow.business_hours.length > 0
      && Array.isArray(appointmentRow.booked_slots);

    if (!hasSchedulingData && appointmentRow.business_id) {
      const fallback = await loadFallbackSchedulingData({
        businessId: appointmentRow.business_id,
        targetDate: targetDate || appointmentRow.date,
      });

      if (fallback) {
        appointmentRow = {
          ...appointmentRow,
          ...fallback,
        };
      }
    }

    setAppointment(appointmentRow);

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
  const selectedStaffIdForReschedule = useMemo(() => {
    if (!appointment?.staff_member_id) {
      return '';
    }

    const assignedStaffIsActive = staffMembers.some(
      (member) => member.id === appointment.staff_member_id && member.is_active !== false
    );

    return assignedStaffIsActive ? appointment.staff_member_id : '';
  }, [appointment?.staff_member_id, staffMembers]);

  const slotsResult = generateAvailableTimeSlots({
    businessHours,
    date: selectedDate,
    serviceDurationMinutes: serviceDuration,
    existingBookings: bookedSlots,
    staffMembers,
    selectedStaffId: selectedStaffIdForReschedule,
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

            console.log('[CANCEL] RPC response data', data);
            console.log('[CANCEL] RPC response error', cancelError);

            if (cancelError) {
              console.log('[CANCEL] Supabase error', {
                message: cancelError.message,
                details: cancelError.details,
                hint: cancelError.hint,
                code: cancelError.code,
              });
              Alert.alert('Cancel failed', cancelError.message || 'Unable to cancel appointment.');
              return;
            }

            const result = Array.isArray(data) ? data[0] : data;
            console.log('[CANCEL] parsed result', result);

            const isSuccess =
              result === true ||
              result?.success === true ||
              String(result?.status || '').toLowerCase() === 'cancelled';

            if (!isSuccess) {
              Alert.alert('Cancel failed', result?.message || 'Unable to cancel appointment.');
              return;
            }

            const successMessage = (typeof result === 'object' && result?.message)
              ? result.message
              : 'Your appointment was cancelled.';

            setNotice(successMessage);
            setAppointment((prev) => prev ? { ...prev, status: 'cancelled' } : prev);
            await loadAppointment({ targetDate: formatDateValue(selectedDate) });
          },
        },
      ]
    );
  };

  const onReschedule = async () => {
    const selectedTime = selectedSlotTime;

    console.log('[RESCHEDULE] button pressed');
    console.log('[RESCHEDULE] bookingToken', bookingToken);
    console.log('[RESCHEDULE] selectedDate', selectedDate);
    console.log('[RESCHEDULE] selectedTime', selectedTime);

    if (!selectedSlotTime) {
      Alert.alert('No time selected', 'Please choose an available time slot first.');
      return;
    }

    const reschedulePayload = {
      p_booking_token: bookingToken,
      p_new_date: formatDateValue(selectedDate),
      p_new_time: selectedSlotTime,
    };

    console.log(`${TRACE_PREFIX} reschedule request`, {
      rpcName: 'reschedule_appointment_by_token',
      bookingToken,
      selectedDate: formatDateValue(selectedDate),
      selectedTime: selectedSlotTime,
      payload: reschedulePayload,
    });

    setIsRescheduling(true);
    console.log('[RESCHEDULE] calling RPC reschedule_appointment_by_token');

    const { data, error: rescheduleError } = await supabase.rpc(
      'reschedule_appointment_by_token',
      reschedulePayload
    );

    console.log('[RESCHEDULE] RPC data', data);
    console.log('[RESCHEDULE] RPC error', rescheduleError);

    setIsRescheduling(false);

    console.log(`${TRACE_PREFIX} reschedule response`, {
      rpcName: 'reschedule_appointment_by_token',
      fullResponse: { data, error: rescheduleError },
      data,
      error: rescheduleError,
      errorMessage: rescheduleError?.message || null,
      errorDetails: rescheduleError?.details || null,
      errorHint: rescheduleError?.hint || null,
      errorCode: rescheduleError?.code || null,
    });

    if (rescheduleError) {
      Alert.alert('Reschedule failed', rescheduleError.message);
      return;
    }

    const result = Array.isArray(data) ? data[0] : data;

    console.log(`${TRACE_PREFIX} reschedule parsed result`, {
      rpcName: 'reschedule_appointment_by_token',
      result,
    });

    if (result === true) {
      setNotice('Your appointment was rescheduled.');
      setSelectedSlotTime('');
      await loadAppointment({ targetDate: formatDateValue(selectedDate) });
      return;
    }

    if (!result) {
      Alert.alert('Reschedule failed', 'No response received from reschedule function.');
      return;
    }

    if (!result?.success) {
      const message = result?.message || 'Unable to reschedule appointment.';
      Alert.alert('Reschedule failed', message);
      if (message.toLowerCase().includes('no available times')) {
        setNotice('No available times for this date');
      }
      return;
    }

    const successMessage = result?.message || 'Your appointment was rescheduled.';
    setNotice(successMessage);
    setSelectedSlotTime('');
    await loadAppointment({ targetDate: formatDateValue(selectedDate) });
  };

  const onAddToCalendar = async () => {
    const dateParts = parseIsoDateParts(appointmentDate);
    const timeParts = parseTimeParts(appointmentTime);

    if (!dateParts || !timeParts) {
      Alert.alert('Calendar unavailable', 'Appointment date/time is missing or invalid.');
      return;
    }

    const durationMinutes = Number(appointment?.service_duration_minutes || 60);
    const safeDuration = Number.isFinite(durationMinutes) && durationMinutes > 0
      ? durationMinutes
      : 60;

    const startDate = new Date(
      dateParts.year,
      dateParts.month - 1,
      dateParts.day,
      timeParts.hours,
      timeParts.minutes,
      0,
      0
    );
    const endDate = new Date(startDate.getTime() + safeDuration * 60 * 1000);

    const businessName = appointment?.business_name || 'SALO';
    const title = `${appointment?.service || 'Appointment'} - ${businessName}`;
    const descriptionParts = [
      `Service: ${appointment?.service || 'Appointment'}`,
      `When: ${appointmentDateTimeLabel}`,
      `Duration: ${safeDuration} mins`,
      `Business: ${businessName}`,
      appointment?.notes ? `Notes: ${appointment.notes}` : null,
    ].filter(Boolean);
    const description = descriptionParts.join('\n');

    const uid = `${appointment?.booking_id || bookingToken || Date.now()}@salo.app`;
    const icsContent = createIcsEventContent({
      uid,
      summary: title,
      description,
      location: businessName,
      startDate,
      endDate,
    });
    const googleCalendarLink = buildGoogleCalendarLink({
      title,
      description,
      location: businessName,
      startDate,
      endDate,
    });

    try {
      await Share.share({
        title: 'Add to Calendar',
        message: `${title}\n\nGoogle Calendar:\n${googleCalendarLink}\n\nICS:\n${icsContent}`,
      });
    } catch (shareError) {
      const fallbackMessage = shareError instanceof Error
        ? shareError.message
        : 'Unable to open share sheet.';
      console.log(`${TRACE_PREFIX} add to calendar share failed`, { fallbackMessage });

      const canOpenGoogle = await Linking.canOpenURL(googleCalendarLink);
      if (canOpenGoogle) {
        await Linking.openURL(googleCalendarLink);
        return;
      }

      Alert.alert('Calendar unavailable', fallbackMessage);
    }
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
  const isCancelled = String(appointment?.status || '').toLowerCase() === 'cancelled';
  const businessSlug = appointment?.business_slug || null;

  return (
    <ScreenContainer style={{ paddingTop: 66 }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 40 }}
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
              {appointmentDateTimeLabel}
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

          {isCancelled ? (
            <View
              style={{
                marginTop: 14,
                backgroundColor: '#26151A',
                borderColor: '#5A252A',
                borderWidth: 1,
                borderRadius: 18,
                padding: 16,
              }}
            >
              <Text style={{ color: '#FCA5A5', fontWeight: '700' }}>
                This appointment has been cancelled.
              </Text>
              <PrimaryButton
                title="Book New Appointment"
                onPress={() => {
                  if (!businessSlug) {
                    Alert.alert('Booking unavailable', 'Business details are unavailable for rebooking.');
                    return;
                  }

                  navigation.navigate('PublicBooking', { businessSlug });
                }}
                style={{ marginTop: 12 }}
              />
            </View>
          ) : (
            <>
              <View style={{ marginTop: 14 }}>
                <PrimaryButton title="Add to Calendar" onPress={onAddToCalendar} />
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
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}
