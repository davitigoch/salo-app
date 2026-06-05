import React, { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  Share,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ExpoLinking from 'expo-linking';
import * as Clipboard from 'expo-clipboard';

import PrimaryButton from '../components/PrimaryButton';
import {
  formatDateValue,
  generateAvailableTimeSlots,
} from '../constants/bookingSlots';
import ScreenContainer from '../components/ScreenContainer';
import { COLORS } from '../constants/colors';
import { ROUTES } from '../constants/routes';
import { supabase } from '../constants/supabase';

const STRIPE_FUNCTION_NAME = 'create-stripe-checkout-session';
const DISABLE_STRIPE = String(process.env.EXPO_PUBLIC_DISABLE_STRIPE || '').toLowerCase() === 'true';
const APP_ENV = String(process.env.APP_ENV || '').toLowerCase();
const PENDING_BOOKING_DRAFT_STORAGE_KEY = 'salo.publicBooking.pendingDraft';

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
  keyboardType = 'default',
}) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text
        style={{
          color: COLORS.textSecondary,
          marginBottom: 8,
          fontSize: 13,
          letterSpacing: 0.3,
        }}
      >
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={COLORS.textSecondary}
        multiline={multiline}
        keyboardType={keyboardType}
        style={{
          backgroundColor: COLORS.card,
          color: COLORS.textPrimary,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: '#27272A',
          paddingHorizontal: 14,
          paddingVertical: 12,
          minHeight: multiline ? 110 : 50,
          textAlignVertical: multiline ? 'top' : 'center',
          fontSize: 15,
        }}
      />
    </View>
  );
}

function PickerField({ label, value, onPress }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text
        style={{
          color: COLORS.textSecondary,
          marginBottom: 8,
          fontSize: 13,
          letterSpacing: 0.3,
        }}
      >
        {label}
      </Text>
      <TouchableOpacity
        onPress={onPress}
        style={{
          backgroundColor: COLORS.card,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: '#27272A',
          paddingHorizontal: 14,
          minHeight: 50,
          justifyContent: 'center',
        }}
      >
        <Text
          style={{
            color: COLORS.textPrimary,
            fontSize: 15,
          }}
        >
          {value}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function formatCurrency(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function parseDateValue(value) {
  if (!value) {
    return new Date();
  }

  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return new Date();
  }

  return parsed;
}

function isValidBookingDateText(value) {
  if (typeof value !== 'string') {
    return false;
  }

  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }

  if (year < 2000 || year > 2100) {
    return false;
  }

  const parsed = new Date(year, month - 1, day, 0, 0, 0, 0);
  return parsed.getFullYear() === year
    && parsed.getMonth() === month - 1
    && parsed.getDate() === day;
}

function generateSecureBookingToken() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID().replace(/-/g, '');
  }

  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 14)}`;
}

function getPublicAppointmentUrl(bookingToken) {
  if (!bookingToken) {
    return '';
  }

  if (APP_ENV === 'production') {
    return `https://salo.app/appointment/${encodeURIComponent(bookingToken)}`;
  }

  if (APP_ENV === 'development' || __DEV__) {
    return ExpoLinking.createURL(`appointment/${bookingToken}`);
  }

  return ExpoLinking.createURL(`appointment/${bookingToken}`);
}

function parseIsoDateParts(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function parseTimeParts(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const match = value.trim().match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  return {
    hours: Number(match[1]),
    minutes: Number(match[2]),
  };
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

function createIcsEventContent({ uid, summary, description, location, startDate, endDate }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'PRODID:-//SALO//Public Booking//EN',
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

function formatSummaryDateTime(dateText, timeText) {
  const dateParts = parseIsoDateParts(dateText);
  const timeParts = parseTimeParts(timeText);
  if (!dateParts || !timeParts) {
    return `${dateText || 'Unknown date'} at ${timeText || 'Unknown time'}`;
  }

  const parsed = new Date(
    dateParts.year,
    dateParts.month - 1,
    dateParts.day,
    timeParts.hours,
    timeParts.minutes,
    0,
    0
  );

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

async function extractEdgeFunctionErrorMessage(checkoutError, checkoutData) {
  if (checkoutData?.error) {
    return checkoutData.error;
  }

  if (!checkoutError) {
    return 'Unknown payment initialization error.';
  }

  if (checkoutError?.message && checkoutError.message !== 'Edge Function returned a non-2xx status code') {
    return checkoutError.message;
  }

  try {
    const response = checkoutError?.context;
    if (response && typeof response.clone === 'function') {
      const cloned = response.clone();
      const text = await cloned.text();
      if (text) {
        try {
          const parsed = JSON.parse(text);
          if (parsed?.error) {
            return parsed.error;
          }
          return text;
        } catch (_jsonError) {
          return text;
        }
      }
    }
  } catch (_contextError) {
    // Ignore parse failures and fall back below.
  }

  if (checkoutError?.status === 404 || checkoutError?.context?.status === 404) {
    return 'Edge Function create-stripe-checkout-session is not deployed.';
  }

  return checkoutError?.message || 'Edge Function returned a non-2xx status code.';
}

export default function PublicBookingScreen({ route }) {
  const navigation = useNavigation();
  const businessSlug = route?.params?.businessSlug || route?.params?.slug;
  const isPaymentCallbackRoute = route?.name === ROUTES.PublicBookingPaymentCallback;
  const [business, setBusiness] = useState(null);
  const [services, setServices] = useState([]);
  const [staffMembers, setStaffMembers] = useState([]);
  const [staffAvailability, setStaffAvailability] = useState([]);
  const [businessHours, setBusinessHours] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedService, setSelectedService] = useState(null);
  const [clientName, setClientName] = useState('');
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [dateValue, setDateValue] = useState(new Date());
  const [bookedSlots, setBookedSlots] = useState([]);
  const [selectedSlotTime, setSelectedSlotTime] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [isSlotsLoading, setIsSlotsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [manageAppointmentUrl, setManageAppointmentUrl] = useState('');
  const [successBookingSummary, setSuccessBookingSummary] = useState(null);
  const [checkoutUrl, setCheckoutUrl] = useState('');
  const [pendingBookingDraft, setPendingBookingDraft] = useState(null);

  useEffect(() => {
    async function loadBusiness() {
      if (!businessSlug) {
        if (isPaymentCallbackRoute) {
          setError('');
          setIsLoading(false);
          return;
        }

        setError('Missing business link.');
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError('');

      const { data, error: businessError } = await supabase
        .from('businesses')
        .select('id, owner_user_id, business_name, slug, description, timezone, public_booking_enabled, deposits_enabled, deposit_percentage, require_card_on_booking')
        .eq('slug', businessSlug)
        .eq('public_booking_enabled', true)
        .single();

      if (businessError) {
        setError('This booking page was not found or is unavailable.');
        setBusiness(null);
        setServices([]);
        setIsLoading(false);
        return;
      }

      const { data: servicesData, error: servicesError } = await supabase
        .from('services')
        .select('id, name, description, duration_minutes, price, category, color, is_active')
        .eq('business_id', data.id)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });

      if (servicesError) {
        setError('Services are currently unavailable for this business.');
        setBusiness(data);
        setServices([]);
        setSelectedService(null);
        setIsLoading(false);
        return;
      }

      const availableServices = Array.isArray(servicesData) ? servicesData : [];

      const { data: staffData, error: staffError } = await supabase.rpc(
        'get_public_staff_members',
        {
          target_business_id: data.id,
        }
      );

      if (staffError) {
        setError('Team availability is currently unavailable.');
        setBusiness(data);
        setServices(availableServices);
        setStaffMembers([]);
        setBusinessHours([]);
        setSelectedService(availableServices.length ? availableServices[0] : null);
        setIsLoading(false);
        return;
      }

      const { data: staffAvailabilityData, error: staffAvailabilityError } = await supabase.rpc(
        'get_public_staff_availability',
        {
          target_business_id: data.id,
        }
      );

      if (staffAvailabilityError) {
        setError('Staff availability is currently unavailable.');
        setBusiness(data);
        setServices(availableServices);
        setStaffMembers(Array.isArray(staffData) ? staffData : []);
        setStaffAvailability([]);
        setBusinessHours([]);
        setSelectedService(availableServices.length ? availableServices[0] : null);
        setIsLoading(false);
        return;
      }

      const { data: hoursData, error: hoursError } = await supabase
        .from('business_hours')
        .select('weekday, is_closed, open_time, close_time')
        .eq('business_id', data.id)
        .order('weekday', { ascending: true });

      if (hoursError) {
        setError('Business availability is currently unavailable.');
        setBusiness(data);
        setServices(availableServices);
        setBusinessHours([]);
        setSelectedService(availableServices.length ? availableServices[0] : null);
        setIsLoading(false);
        return;
      }

      setBusiness(data);
      setServices(availableServices);
      setStaffMembers(Array.isArray(staffData) ? staffData : []);
      setStaffAvailability(Array.isArray(staffAvailabilityData) ? staffAvailabilityData : []);
      setBusinessHours(Array.isArray(hoursData) ? hoursData : []);
      setSelectedService(availableServices.length ? availableServices[0] : null);
      setIsLoading(false);
    }

    loadBusiness();
  }, [businessSlug, isPaymentCallbackRoute]);

  const savePendingBookingDraft = async (draft) => {
    try {
      await AsyncStorage.setItem(PENDING_BOOKING_DRAFT_STORAGE_KEY, JSON.stringify(draft));
      return true;
    } catch (_storageError) {
      return false;
    }
  };

  const loadPendingBookingDraft = async () => {
    try {
      const serializedDraft = await AsyncStorage.getItem(PENDING_BOOKING_DRAFT_STORAGE_KEY);
      if (!serializedDraft) {
        return null;
      }

      const parsedDraft = JSON.parse(serializedDraft);
      return parsedDraft && typeof parsedDraft === 'object' ? parsedDraft : null;
    } catch (_storageError) {
      return null;
    }
  };

  const clearPendingBookingDraft = async () => {
    try {
      await AsyncStorage.removeItem(PENDING_BOOKING_DRAFT_STORAGE_KEY);
    } catch (_storageError) {
      // Ignore storage cleanup failures and continue UI flow.
    }
  };

  const onAddToCalendar = async () => {
    if (!successBookingSummary) {
      Alert.alert('Calendar unavailable', 'Appointment details are not available yet.');
      return;
    }

    const dateParts = parseIsoDateParts(successBookingSummary.date);
    const timeParts = parseTimeParts(successBookingSummary.time);
    if (!dateParts || !timeParts) {
      Alert.alert('Calendar unavailable', 'Appointment date/time is missing or invalid.');
      return;
    }

    const duration = Number(successBookingSummary.durationMinutes || 60);
    const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 60;
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

    const title = `${successBookingSummary.service} - ${successBookingSummary.businessName}`;
    const description = [
      `Service: ${successBookingSummary.service}`,
      `When: ${formatSummaryDateTime(successBookingSummary.date, successBookingSummary.time)}`,
      `Duration: ${safeDuration} mins`,
      `Business: ${successBookingSummary.businessName}`,
      successBookingSummary.notes ? `Notes: ${successBookingSummary.notes}` : null,
    ].filter(Boolean).join('\n');

    const googleLink = buildGoogleCalendarLink({
      title,
      description,
      location: successBookingSummary.businessName,
      startDate,
      endDate,
    });

    const icsContent = createIcsEventContent({
      uid: `${successBookingSummary.bookingToken || Date.now()}@salo.app`,
      summary: title,
      description,
      location: successBookingSummary.businessName,
      startDate,
      endDate,
    });

    try {
      await Share.share({
        title: 'Add to Calendar',
        message: `${title}\n\nGoogle Calendar:\n${googleLink}\n\nICS:\n${icsContent}`,
      });
    } catch (shareError) {
      const fallbackMessage = shareError instanceof Error
        ? shareError.message
        : 'Unable to open share sheet.';

      const canOpenGoogle = await Linking.canOpenURL(googleLink);
      if (canOpenGoogle) {
        await Linking.openURL(googleLink);
        return;
      }

      Alert.alert('Calendar unavailable', fallbackMessage);
    }
  };

  useEffect(() => {
    async function loadBookedSlots() {
      if (!business?.id) {
        setBookedSlots([]);
        return;
      }

      setIsSlotsLoading(true);

      const { data, error: slotsError } = await supabase.rpc('get_business_booked_slots', {
        target_business_id: business.id,
        target_date: formatDateValue(dateValue),
      });

      if (slotsError) {
        setBookedSlots([]);
        setIsSlotsLoading(false);
        return;
      }

      setBookedSlots(
        (data || []).map((item) => ({
          id: item.id,
          time: item.booking_time,
          staff_member_id: item.staff_member_id,
          booking_metadata: {
            service_duration_minutes: item.duration_minutes,
          },
        }))
      );
      setIsSlotsLoading(false);
    }

    loadBookedSlots();
  }, [business?.id, dateValue]);

  const slotsResult = generateAvailableTimeSlots({
    businessHours,
    date: dateValue,
    serviceDurationMinutes: Number(selectedService?.duration_minutes || 0),
    existingBookings: bookedSlots,
    staffMembers,
    selectedStaffId,
    staffAvailability,
    stepMinutes: 15,
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

  const selectedStaff = staffMembers.find((member) => member.id === selectedStaffId) || null;

  const resetBookingForm = () => {
    setClientName('');
    setEmail('');
    setPhone('');
    setNotes('');
  };

  const appendLocalBookedSlot = () => {
    setBookedSlots((previous) => [
      ...previous,
      {
        id: `local-${Date.now()}`,
        time: selectedSlotTime,
        staff_member_id: selectedStaff?.id || null,
        booking_metadata: {
          service_duration_minutes: selectedService?.duration_minutes,
        },
      },
    ]);
  };

  const createPublicBookingWithoutPayment = async (payload) => {
    const { error: insertError } = await supabase.from('bookings').insert(payload);

    if (insertError) {
      return { error: insertError };
    }

    return { error: null };
  };

  useEffect(() => {
    const handleIncomingLink = async (incomingUrl) => {
      const parsed = ExpoLinking.parse(incomingUrl || '');
      const path = String(parsed.path || '');

      if (path !== 'public-booking-payment') {
        return;
      }

      const status = String(parsed.queryParams?.status || '');
      const sessionId = String(parsed.queryParams?.session_id || '');

      if (status === 'cancel') {
        setIsSubmitting(false);
        Alert.alert('Payment canceled', 'You can resume checkout when ready.');
        return;
      }

      if (status !== 'success' || !sessionId) {
        return;
      }

      let effectivePendingDraft = pendingBookingDraft;
      if (!effectivePendingDraft) {
        effectivePendingDraft = await loadPendingBookingDraft();
        if (effectivePendingDraft) {
          setPendingBookingDraft(effectivePendingDraft);
        }
      }

      if (!effectivePendingDraft) {
        Alert.alert('Payment received', 'Unable to find your pending booking details. Please try again.');
        return;
      }

      setIsSubmitting(true);

      const { data, error: finalizeError } = await supabase.functions.invoke(
        'finalize-public-booking-payment',
        {
          body: {
            checkoutSessionId: sessionId,
            bookingDraft: effectivePendingDraft,
          },
        }
      );

      setIsSubmitting(false);

      if (finalizeError) {
        Alert.alert('Finalize failed', finalizeError.message);
        return;
      }

      if (data?.error) {
        Alert.alert('Finalize failed', data.error);
        return;
      }

  const finalizedToken = data?.bookingToken || effectivePendingDraft?.booking_token || '';
      const finalizedStatus = data?.bookingStatus || 'confirmed';
      const finalizedLink = getPublicAppointmentUrl(finalizedToken);

      setSuccessMessage(
        finalizedStatus === 'pending'
          ? 'Your appointment is pending review.'
          : 'Your appointment is confirmed.'
      );
      setManageAppointmentUrl(finalizedLink);
      setSuccessBookingSummary({
        service: selectedService?.name || 'Appointment',
        date: effectivePendingDraft?.date || formatDateValue(dateValue),
        time: effectivePendingDraft?.time || selectedSlotTime,
        durationMinutes: selectedService?.duration_minutes || 60,
        businessName: business?.business_name || 'SALO',
        notes: effectivePendingDraft?.notes || notes,
        bookingToken: finalizedToken,
      });
      await clearPendingBookingDraft();
      setPendingBookingDraft(null);
      setCheckoutUrl('');
      resetBookingForm();
      appendLocalBookedSlot();
    };

    const subscription = Linking.addEventListener('url', ({ url }) => {
      handleIncomingLink(url);
    });

    Linking.getInitialURL().then((initialUrl) => {
      if (initialUrl) {
        handleIncomingLink(initialUrl);
      }
    });

    return () => {
      subscription.remove();
    };
  }, [pendingBookingDraft, selectedService?.duration_minutes, selectedSlotTime, selectedStaff?.id]);

  const onSubmit = async () => {
    if (!business) {
      Alert.alert('Unavailable', 'This booking page is not ready yet.');
      return;
    }

    const normalizedDate = formatDateValue(dateValue);

    if (!clientName.trim() || !selectedService || !normalizedDate || !selectedSlotTime) {
      Alert.alert('Missing details', 'Please fill your name and choose a service, date, and time slot.');
      return;
    }

    if (!isValidBookingDateText(normalizedDate)) {
      Alert.alert('Invalid date', 'Please choose a valid appointment date.');
      return;
    }

    if (!slotsResult.slots.some((slot) => slot.value === selectedSlotTime)) {
      Alert.alert('Unavailable slot', 'Please choose one of the available slots.');
      return;
    }

    setIsSubmitting(true);
    setSuccessMessage('');
    setManageAppointmentUrl('');
    setSuccessBookingSummary(null);

    const bookingToken = generateSecureBookingToken();

    const basePayload = {
      client_name: clientName.trim(),
      service: selectedService.name,
      price: Number(selectedService.price || 0),
      date: normalizedDate,
      time: selectedSlotTime,
      notes: notes.trim(),
      customer_email: email.trim(),
      customer_phone: phone.trim(),
      staff_member_id: selectedStaff?.id || null,
      user_id: business.owner_user_id,
      business_id: business.id,
      business_slug: business.slug,
      booking_token: bookingToken,
      booking_source: 'public',
      status: 'pending',
      booking_metadata: {
        service_id: selectedService.id,
        service_name: selectedService.name,
        service_duration_minutes: selectedService.duration_minutes,
        service_category: selectedService.category,
        staff_member_id: selectedStaff?.id || null,
        staff_member_name: selectedStaff?.name || null,
        staff_member_role: selectedStaff?.role || null,
        staff_member_color: selectedStaff?.color || null,
        notification_hooks: {
          confirmed_sms: 'pending',
        },
      },
    };

    const paymentRequired = Boolean(
      business?.deposits_enabled || business?.require_card_on_booking
    );

    if (!paymentRequired) {
      const { error: insertError } = await createPublicBookingWithoutPayment(basePayload);

      setIsSubmitting(false);

      if (insertError) {
        Alert.alert('Booking failed', insertError.message);
        return;
      }

      setSuccessMessage('Your appointment is pending review.');
      setManageAppointmentUrl(getPublicAppointmentUrl(bookingToken));
      setSuccessBookingSummary({
        service: selectedService.name,
        date: normalizedDate,
        time: selectedSlotTime,
        durationMinutes: selectedService.duration_minutes || 60,
        businessName: business?.business_name || 'SALO',
        notes: notes.trim(),
        bookingToken,
      });
      resetBookingForm();
      appendLocalBookedSlot();
      return;
    }

    if (DISABLE_STRIPE) {
      const { error: insertError } = await createPublicBookingWithoutPayment(basePayload);

      setIsSubmitting(false);

      if (insertError) {
        Alert.alert('Booking failed', insertError.message);
        return;
      }

      setSuccessMessage('Your appointment is pending review.');
      setManageAppointmentUrl(getPublicAppointmentUrl(bookingToken));
      setSuccessBookingSummary({
        service: selectedService.name,
        date: normalizedDate,
        time: selectedSlotTime,
        durationMinutes: selectedService.duration_minutes || 60,
        businessName: business?.business_name || 'SALO',
        notes: notes.trim(),
        bookingToken,
      });
      resetBookingForm();
      appendLocalBookedSlot();
      return;
    }

    const callbackBaseUrl = ExpoLinking.createURL('public-booking-payment');
    const successUrl = `${callbackBaseUrl}?status=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${callbackBaseUrl}?status=cancel`;

    const checkoutPayload = {
      businessId: business.id,
      serviceId: selectedService.id,
      clientName: clientName.trim(),
      customerEmail: email.trim(),
      paymentMode: business.deposits_enabled ? 'auto' : 'full',
      successUrl,
      cancelUrl,
    };

    console.log('[PublicBooking] payment init request', {
      functionName: STRIPE_FUNCTION_NAME,
      payload: checkoutPayload,
      env: {
        EXPO_PUBLIC_DISABLE_STRIPE: process.env.EXPO_PUBLIC_DISABLE_STRIPE || '',
      },
    });

    const { data: checkoutData, error: checkoutError } = await supabase.functions.invoke(
      STRIPE_FUNCTION_NAME,
      {
        body: checkoutPayload,
      }
    );

    console.log('[PublicBooking] payment init response', {
      functionName: STRIPE_FUNCTION_NAME,
      error: checkoutError,
      data: checkoutData,
      responseStatus: checkoutError?.context?.status || null,
    });

    if (checkoutError) {
      setIsSubmitting(false);
      const detailedMessage = await extractEdgeFunctionErrorMessage(checkoutError, checkoutData);
      const fallbackMessage = detailedMessage || 'Payments are not configured yet.';
      Alert.alert('Payment init failed', fallbackMessage);
      return;
    }

    if (checkoutData?.error) {
      setIsSubmitting(false);
      Alert.alert('Payment init failed', checkoutData.error);
      return;
    }

    if (!checkoutData?.requiresPayment || !checkoutData?.checkoutUrl) {
      const { error: insertError } = await createPublicBookingWithoutPayment(basePayload);

      setIsSubmitting(false);

      if (insertError) {
        Alert.alert('Booking failed', insertError.message);
        return;
      }

      setSuccessMessage('Your appointment has been requested. We will confirm it shortly.');
      setManageAppointmentUrl(getPublicAppointmentUrl(bookingToken));
      setSuccessBookingSummary({
        service: selectedService.name,
        date: normalizedDate,
        time: selectedSlotTime,
        durationMinutes: selectedService.duration_minutes || 60,
        businessName: business?.business_name || 'SALO',
        notes: notes.trim(),
        bookingToken,
      });
      resetBookingForm();
      appendLocalBookedSlot();
      return;
    }

    const pendingDraft = {
      client_name: clientName.trim(),
      date: normalizedDate,
      time: selectedSlotTime,
      notes: notes.trim(),
      customer_email: email.trim(),
      customer_phone: phone.trim(),
      staff_member_id: selectedStaff?.id || null,
      business_id: business.id,
      business_slug: business.slug,
      service_id: selectedService.id,
      booking_token: bookingToken,
    };

    const isDraftSaved = await savePendingBookingDraft(pendingDraft);
    if (!isDraftSaved) {
      setIsSubmitting(false);
      Alert.alert('Storage unavailable', 'Unable to save your pending payment details. Please try again.');
      return;
    }

    setPendingBookingDraft(pendingDraft);
    setCheckoutUrl(checkoutData.checkoutUrl);

    const canOpen = await Linking.canOpenURL(checkoutData.checkoutUrl);

    setIsSubmitting(false);

    if (!canOpen) {
      Alert.alert('Checkout unavailable', 'Unable to open Stripe Checkout on this device.');
      return;
    }

    await Linking.openURL(checkoutData.checkoutUrl);
  };

  const onBookAnotherAppointment = () => {
    setSuccessMessage('');
    setManageAppointmentUrl('');
    setSuccessBookingSummary(null);
    setCheckoutUrl('');
    setPendingBookingDraft(null);
    setShowDatePicker(false);
  };

  if (isLoading) {
    return (
      <ScreenContainer centered style={{ padding: 24 }}>
        <Text style={{ color: COLORS.textSecondary }}>Loading booking page...</Text>
      </ScreenContainer>
    );
  }

  if (error) {
    return (
      <ScreenContainer centered style={{ padding: 24 }}>
        <Text
          style={{
            color: COLORS.textPrimary,
            fontSize: 28,
            fontWeight: '700',
            textAlign: 'center',
          }}
        >
          SALO
        </Text>
        <Text
          style={{
            color: COLORS.textSecondary,
            marginTop: 10,
            textAlign: 'center',
          }}
        >
          {error}
        </Text>
      </ScreenContainer>
    );
  }

  if (isPaymentCallbackRoute && !business && !successMessage) {
    return (
      <ScreenContainer centered style={{ padding: 24 }}>
        <Text style={{ color: COLORS.textSecondary, textAlign: 'center' }}>
          Finalizing your payment and booking...
        </Text>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer style={{ paddingTop: 62 }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: 24,
            paddingBottom: 36,
          }}
          showsVerticalScrollIndicator={false}
        >
          <Text
            style={{
              color: COLORS.textPrimary,
              fontSize: 30,
              fontWeight: '700',
            }}
          >
            {business.business_name}
          </Text>

          <Text
            style={{
              color: COLORS.textSecondary,
              marginTop: 8,
              marginBottom: 20,
            }}
          >
            {business.description || 'Luxury salon booking experience'}
          </Text>

          {!successMessage ? (
            <View
              style={{
                backgroundColor: COLORS.card,
                borderRadius: 18,
                padding: 16,
                marginBottom: 16,
                borderWidth: 1,
                borderColor: '#2A2A33',
              }}
            >
              <Text style={{ color: COLORS.textPrimary, fontSize: 18, fontWeight: '700' }}>
                Services
              </Text>
              <Text style={{ color: COLORS.textSecondary, marginTop: 4 }}>
                Choose your treatment and preferred appointment time.
              </Text>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingTop: 14 }}
              >
                {services.length ? (
                  services.map((service, index) => {
                    const isSelected = selectedService?.id === service.id;
                    return (
                      <TouchableOpacity
                        key={service?.id ? `service-${service.id}` : `service-index-${index}`}
                        onPress={() => setSelectedService(service)}
                        style={{
                          width: 180,
                          backgroundColor: isSelected ? '#231B3A' : '#15151B',
                          borderColor: isSelected ? COLORS.accent : '#2D2D38',
                          borderWidth: 1,
                          borderRadius: 16,
                          padding: 14,
                          marginRight: 12,
                        }}
                      >
                        <Text style={{ color: COLORS.textPrimary, fontWeight: '700', fontSize: 16 }}>
                          {service.name}
                        </Text>
                        <Text style={{ color: COLORS.textSecondary, marginTop: 6 }}>
                          {formatCurrency(service.price)}
                        </Text>
                        <Text style={{ color: COLORS.textSecondary, marginTop: 4, fontSize: 12 }}>
                          {service.duration_minutes || 0} mins
                        </Text>
                      </TouchableOpacity>
                    );
                  })
                ) : (
                  <Text style={{ color: COLORS.textSecondary }}>No services available yet.</Text>
                )}
              </ScrollView>
            </View>
          ) : null}

          {successMessage ? (
            <View
              style={{
                backgroundColor: '#13231B',
                borderColor: '#1F4A34',
                borderWidth: 1,
                borderRadius: 16,
                padding: 14,
                marginBottom: 16,
              }}
            >
              <Text style={{ color: '#BBF7D0' }}>{successMessage}</Text>

              {successBookingSummary ? (
                <View
                  style={{
                    marginTop: 10,
                    borderTopColor: '#1F4A34',
                    borderTopWidth: 1,
                    paddingTop: 10,
                  }}
                >
                  <Text style={{ color: '#DCFCE7', fontWeight: '700' }}>Appointment Summary</Text>
                  <Text style={{ color: '#BBF7D0', marginTop: 4 }}>
                    {successBookingSummary.service}
                  </Text>
                  <Text style={{ color: '#BBF7D0', marginTop: 2 }}>
                    {formatSummaryDateTime(successBookingSummary.date, successBookingSummary.time)}
                  </Text>
                  <Text style={{ color: '#BBF7D0', marginTop: 2 }}>
                    Duration: {Number(successBookingSummary.durationMinutes || 0)} mins
                  </Text>
                  {successBookingSummary.notes ? (
                    <Text style={{ color: '#BBF7D0', marginTop: 2 }}>
                      Notes: {successBookingSummary.notes}
                    </Text>
                  ) : null}
                </View>
              ) : null}

              {manageAppointmentUrl ? (
                <>
                  <View style={{ flexDirection: 'row', marginTop: 10 }}>
                    <TouchableOpacity
                      onPress={() => {
                        const tokenForNavigation = successBookingSummary?.bookingToken || '';
                        console.log('[PublicBooking] Manage Appointment press', {
                          bookingToken: tokenForNavigation,
                          hasToken: Boolean(tokenForNavigation),
                        });

                        if (tokenForNavigation) {
                          navigation.navigate(ROUTES.AppointmentPortal, {
                            bookingToken: tokenForNavigation,
                          });
                          return;
                        }

                        Linking.openURL(manageAppointmentUrl);
                      }}
                      style={{
                        backgroundColor: '#1E1B4B',
                        borderColor: '#4338CA',
                        borderWidth: 1,
                        borderRadius: 10,
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        marginRight: 8,
                      }}
                    >
                      <Text style={{ color: '#EDE9FE', fontSize: 12, fontWeight: '700' }}>
                        Manage Appointment
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={async () => {
                        await Clipboard.setStringAsync(manageAppointmentUrl);
                        Alert.alert('Copied', 'Manage appointment link copied.');
                      }}
                      style={{
                        backgroundColor: '#15151B',
                        borderColor: '#2D2D38',
                        borderWidth: 1,
                        borderRadius: 10,
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        marginRight: 8,
                      }}
                    >
                      <Text style={{ color: COLORS.textPrimary, fontSize: 12, fontWeight: '700' }}>
                        Copy Link
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() => {
                        Share.share({
                          message: manageAppointmentUrl,
                        });
                      }}
                      style={{
                        backgroundColor: '#15151B',
                        borderColor: '#2D2D38',
                        borderWidth: 1,
                        borderRadius: 10,
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                      }}
                    >
                      <Text style={{ color: COLORS.textPrimary, fontSize: 12, fontWeight: '700' }}>
                        Share
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={onAddToCalendar}
                      style={{
                        backgroundColor: '#15151B',
                        borderColor: '#2D2D38',
                        borderWidth: 1,
                        borderRadius: 10,
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        marginLeft: 8,
                      }}
                    >
                      <Text style={{ color: COLORS.textPrimary, fontSize: 12, fontWeight: '700' }}>
                        Add to Calendar
                      </Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : null}

              <PrimaryButton
                title="Book Another Appointment"
                onPress={onBookAnotherAppointment}
                style={{ marginTop: 12 }}
              />
            </View>
          ) : null}

          {!successMessage ? (
            <>
              {checkoutUrl ? (
                <View
                  style={{
                    backgroundColor: '#111827',
                    borderColor: '#1E3A8A',
                    borderWidth: 1,
                    borderRadius: 16,
                    padding: 14,
                    marginBottom: 16,
                  }}
                >
                  <Text style={{ color: '#BFDBFE', marginBottom: 10 }}>
                    Payment in progress. If Checkout did not open, tap below.
                  </Text>
                  <PrimaryButton
                    title="Open Checkout"
                    onPress={() => {
                      Linking.openURL(checkoutUrl);
                    }}
                  />
                </View>
              ) : null}

              <Field
                label="Your name"
                value={clientName}
                onChangeText={setClientName}
                placeholder="Enter your full name"
              />
              <Field
                label="Email"
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                keyboardType="email-address"
              />
              <Field
                label="Phone"
                value={phone}
                onChangeText={setPhone}
                placeholder="Phone number"
                keyboardType="phone-pad"
              />

              <View style={{ marginBottom: 14 }}>
                <Text
                  style={{
                    color: COLORS.textSecondary,
                    marginBottom: 8,
                    fontSize: 13,
                    letterSpacing: 0.3,
                  }}
                >
                  Team Member (Optional)
                </Text>

                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingBottom: 4 }}
                >
                  <TouchableOpacity
                    onPress={() => setSelectedStaffId('')}
                    style={{
                      backgroundColor: !selectedStaffId ? '#231B3A' : '#15151B',
                      borderColor: !selectedStaffId ? COLORS.accent : '#2D2D38',
                      borderWidth: 1,
                      borderRadius: 14,
                      paddingHorizontal: 14,
                      paddingVertical: 10,
                      marginRight: 8,
                    }}
                  >
                    <Text style={{ color: COLORS.textPrimary, fontWeight: '600' }}>
                      No Preference
                    </Text>
                  </TouchableOpacity>

                  {staffMembers.map((member, index) => {
                    const isSelected = selectedStaffId === member.id;

                    return (
                      <TouchableOpacity
                        key={member?.id ? `staff-${member.id}` : `staff-index-${index}`}
                        onPress={() => setSelectedStaffId(member.id)}
                        style={{
                          backgroundColor: isSelected ? '#231B3A' : '#15151B',
                          borderColor: isSelected ? COLORS.accent : '#2D2D38',
                          borderWidth: 1,
                          borderRadius: 14,
                          paddingHorizontal: 14,
                          paddingVertical: 10,
                          marginRight: 8,
                        }}
                      >
                        <Text style={{ color: COLORS.textPrimary, fontWeight: '600' }}>
                          {member.name}
                        </Text>
                        <Text style={{ color: COLORS.textSecondary, fontSize: 12, marginTop: 2 }}>
                          {member.role || 'Staff'}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>

              <PickerField
                label="Date"
                value={formatDateValue(dateValue)}
                onPress={() => {
                  setShowDatePicker(true);
                }}
              />

              <View style={{ marginBottom: 14 }}>
                <Text
                  style={{
                    color: COLORS.textSecondary,
                    marginBottom: 8,
                    fontSize: 13,
                    letterSpacing: 0.3,
                  }}
                >
                  Available Time Slots
                </Text>

                {isSlotsLoading ? (
                  <Text style={{ color: COLORS.textSecondary }}>Loading available slots...</Text>
                ) : null}

                {!isSlotsLoading ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                    {slotsResult.slots.map((slot, index) => {
                      const isSelected = selectedSlotTime === slot.value;

                      return (
                        <TouchableOpacity
                          key={`${slot.value || 'slot'}-${index}`}
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
                          <Text style={{ color: COLORS.textPrimary, fontWeight: '600' }}>
                            {slot.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ) : null}

                {!isSlotsLoading && !slotsResult.slots.length ? (
                  <Text style={{ color: '#FCA5A5', marginTop: 2 }}>
                    {slotsResult.reason || 'No available slots for this date.'}
                  </Text>
                ) : null}
              </View>

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
                    value={dateValue}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    onChange={(_event, selectedValue) => {
                      if (Platform.OS !== 'ios') {
                        setShowDatePicker(false);
                      }
                      if (selectedValue) {
                        setDateValue(selectedValue);
                      }
                    }}
                    themeVariant="dark"
                  />
                </View>
              ) : null}

              {Platform.OS === 'ios' && showDatePicker ? (
                <PrimaryButton
                  title="Done"
                  onPress={() => {
                    setShowDatePicker(false);
                  }}
                  style={{ marginTop: 4, marginBottom: 10 }}
                />
              ) : null}

              <Field
                label="Notes"
                value={notes}
                onChangeText={setNotes}
                placeholder="Anything else we should know?"
                multiline
              />

              <PrimaryButton
                title={
                  isSubmitting
                    ? 'Processing...'
                    : business?.deposits_enabled || business?.require_card_on_booking
                      ? 'Continue to Payment'
                      : 'Confirm Booking'
                }
                onPress={onSubmit}
              />
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}
