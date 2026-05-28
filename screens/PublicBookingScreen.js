import React, { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as ExpoLinking from 'expo-linking';

import PrimaryButton from '../components/PrimaryButton';
import {
  formatDateValue,
  generateAvailableTimeSlots,
} from '../constants/bookingSlots';
import ScreenContainer from '../components/ScreenContainer';
import { COLORS } from '../constants/colors';
import { supabase } from '../constants/supabase';

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

export default function PublicBookingScreen({ route }) {
  const slug = route?.params?.slug;
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
  const [checkoutUrl, setCheckoutUrl] = useState('');
  const [pendingBookingDraft, setPendingBookingDraft] = useState(null);

  useEffect(() => {
    async function loadBusiness() {
      if (!slug) {
        setError('Missing business link.');
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError('');

      const { data, error: businessError } = await supabase
        .from('businesses')
        .select('id, owner_user_id, business_name, slug, description, timezone, public_booking_enabled, deposits_enabled, deposit_percentage, require_card_on_booking')
        .eq('slug', slug)
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
  }, [slug]);

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

      if (!pendingBookingDraft) {
        Alert.alert('Payment received', 'Unable to find your pending booking details. Please try again.');
        return;
      }

      setIsSubmitting(true);

      const { data, error: finalizeError } = await supabase.functions.invoke(
        'finalize-public-booking-payment',
        {
          body: {
            checkoutSessionId: sessionId,
            bookingDraft: pendingBookingDraft,
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

      setSuccessMessage('Payment received and booking confirmed. See you soon.');
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

    if (!clientName.trim() || !selectedService || !formatDateValue(dateValue) || !selectedSlotTime) {
      Alert.alert('Missing details', 'Please fill your name and choose a service, date, and time slot.');
      return;
    }

    if (!slotsResult.slots.some((slot) => slot.value === selectedSlotTime)) {
      Alert.alert('Unavailable slot', 'Please choose one of the available slots.');
      return;
    }

    setIsSubmitting(true);
    setSuccessMessage('');

    const basePayload = {
      client_name: clientName.trim(),
      service: selectedService.name,
      price: Number(selectedService.price || 0),
      date: formatDateValue(dateValue),
      time: selectedSlotTime,
      notes: notes.trim(),
      customer_email: email.trim(),
      customer_phone: phone.trim(),
      staff_member_id: selectedStaff?.id || null,
      user_id: business.owner_user_id,
      business_id: business.id,
      business_slug: business.slug,
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

      setSuccessMessage('Your appointment has been requested. We will confirm it shortly.');
      resetBookingForm();
      appendLocalBookedSlot();
      return;
    }

    const callbackBaseUrl = ExpoLinking.createURL('public-booking-payment');
    const successUrl = `${callbackBaseUrl}?status=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${callbackBaseUrl}?status=cancel`;

    const { data: checkoutData, error: checkoutError } = await supabase.functions.invoke(
      'create-stripe-checkout-session',
      {
        body: {
          businessId: business.id,
          serviceId: selectedService.id,
          clientName: clientName.trim(),
          customerEmail: email.trim(),
          paymentMode: business.deposits_enabled ? 'auto' : 'full',
          successUrl,
          cancelUrl,
        },
      }
    );

    if (checkoutError) {
      setIsSubmitting(false);
      Alert.alert('Payment init failed', checkoutError.message);
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
      resetBookingForm();
      appendLocalBookedSlot();
      return;
    }

    setPendingBookingDraft({
      client_name: clientName.trim(),
      date: formatDateValue(dateValue),
      time: selectedSlotTime,
      notes: notes.trim(),
      customer_email: email.trim(),
      customer_phone: phone.trim(),
      staff_member_id: selectedStaff?.id || null,
      business_id: business.id,
      business_slug: business.slug,
      service_id: selectedService.id,
    });
    setCheckoutUrl(checkoutData.checkoutUrl);

    const canOpen = await Linking.canOpenURL(checkoutData.checkoutUrl);

    setIsSubmitting(false);

    if (!canOpen) {
      Alert.alert('Checkout unavailable', 'Unable to open Stripe Checkout on this device.');
      return;
    }

    await Linking.openURL(checkoutData.checkoutUrl);
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
                services.map((service) => {
                  const isSelected = selectedService?.id === service.id;
                  return (
                    <TouchableOpacity
                      key={service.id}
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
            </View>
          ) : null}

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

              {staffMembers.map((member) => {
                const isSelected = selectedStaffId === member.id;

                return (
                  <TouchableOpacity
                    key={member.id}
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
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}
