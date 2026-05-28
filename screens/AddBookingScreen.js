import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';

import BackButton from '../components/BackButton';
import PrimaryButton from '../components/PrimaryButton';
import { getDeterministicSchedulingRecommendations } from '../constants/aiScheduling';
import {
  formatDateValue,
  generateAvailableTimeSlots,
} from '../constants/bookingSlots';
import ScreenContainer from '../components/ScreenContainer';
import { COLORS } from '../constants/colors';
import { ROUTES } from '../constants/routes';
import { useAuth } from '../context/AuthContext';
import { useBookings } from '../context/BookingsContext';
import { useServices } from '../context/ServicesContext';
import { useStaff } from '../context/StaffContext';

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

function formatDateDisplay(value) {
  return value.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
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

export default function AddBookingScreen({ navigation, route }) {
  const { bookings, addBooking, updateBooking, logAiRecommendation } = useBookings();
  const { businessHours } = useAuth();
  const {
    services,
    isServicesLoading,
    servicesError,
    fetchServices,
  } = useServices();
  const { staff, staffAvailability } = useStaff();
  const bookingId = route?.params?.bookingId;
  const bookingToEdit = useMemo(
    () => bookings.find((booking) => booking.id === bookingId),
    [bookings, bookingId]
  );
  const isEditing = Boolean(bookingToEdit);
  const activeServices = useMemo(
    () => services.filter((item) => item.is_active),
    [services]
  );
  const activeStaff = useMemo(
    () => staff.filter((member) => member.is_active),
    [staff]
  );

  const [clientName, setClientName] = useState('');
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [price, setPrice] = useState('');
  const [duration, setDuration] = useState('');
  const [category, setCategory] = useState('');
  const [dateValue, setDateValue] = useState(new Date());
  const [selectedSlotTime, setSelectedSlotTime] = useState('');
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedRecommendationType, setSelectedRecommendationType] = useState('');

  const openDatePicker = () => {
    setShowDatePicker(true);
  };

  useEffect(() => {
    if (!services.length && !isServicesLoading) {
      fetchServices();
    }
  }, [fetchServices, isServicesLoading, services.length]);

  useEffect(() => {
    if (!activeServices.length) {
      return;
    }

    if (!selectedServiceId) {
      setSelectedServiceId(activeServices[0].id);
    }
  }, [activeServices, selectedServiceId]);

  const selectedService = useMemo(
    () => activeServices.find((item) => item.id === selectedServiceId) || null,
    [activeServices, selectedServiceId]
  );
  const selectedStaff = useMemo(
    () => activeStaff.find((member) => member.id === selectedStaffId) || null,
    [activeStaff, selectedStaffId]
  );

  const serviceDurationMinutes = Number(
    duration || selectedService?.duration_minutes || 0
  );

  const existingBookingsForDate = useMemo(
    () => bookings.filter(
      (booking) =>
        booking.date === formatDateValue(dateValue)
        && (booking.status || 'confirmed') !== 'cancelled'
    ),
    [bookings, dateValue]
  );

  const slotsResult = generateAvailableTimeSlots({
    businessHours,
    date: dateValue,
    serviceDurationMinutes,
    existingBookings: existingBookingsForDate,
    staffMembers: activeStaff,
    selectedStaffId,
    staffAvailability,
    stepMinutes: 15,
    excludeBookingId: bookingToEdit?.id,
  });

  useEffect(() => {
    if (!selectedService) {
      return;
    }

    setPrice(String(selectedService.price ?? ''));
    setDuration(String(selectedService.duration_minutes ?? ''));
    setCategory(selectedService.category || 'General');
  }, [selectedService]);

  useEffect(() => {
    if (!bookingToEdit) {
      return;
    }

    setClientName(bookingToEdit.client_name || '');
    const metadata = bookingToEdit.booking_metadata || {};
    const existingService =
      activeServices.find((item) => item.id === metadata.service_id)
      || activeServices.find((item) => item.name === bookingToEdit.service);

    if (existingService) {
      setSelectedServiceId(existingService.id);
      setPrice(String(existingService.price ?? ''));
      setDuration(String(existingService.duration_minutes ?? ''));
      setCategory(existingService.category || 'General');
    } else {
      setSelectedServiceId('');
      setPrice(
        bookingToEdit.price === null || bookingToEdit.price === undefined
          ? ''
          : String(bookingToEdit.price)
      );
      setDuration(String(metadata.service_duration_minutes || ''));
      setCategory(metadata.service_category || '');
    }

    setSelectedStaffId(
      bookingToEdit.staff_member_id
      || metadata.staff_member_id
      || ''
    );
    setDateValue(parseDateValue(bookingToEdit.date));
    setSelectedSlotTime(bookingToEdit.time || '');
    setNotes(bookingToEdit.notes || '');
  }, [activeServices, bookingToEdit]);

  useEffect(() => {
    if (!slotsResult.slots.length) {
      setSelectedSlotTime('');
      return;
    }

    if (!slotsResult.slots.some((slot) => slot.value === selectedSlotTime)) {
      setSelectedSlotTime(slotsResult.slots[0].value);
    }
  }, [selectedSlotTime, slotsResult.slots]);

  useEffect(() => {
    setSelectedRecommendationType('');
  }, [dateValue, selectedServiceId, selectedStaffId, duration]);

  const aiRecommendations = useMemo(() => {
    return getDeterministicSchedulingRecommendations({
      date: dateValue,
      slots: slotsResult.slots,
      businessHours,
      staffMembers: activeStaff,
      selectedStaffId,
      staffAvailability,
      existingBookings: existingBookingsForDate,
      serviceDurationMinutes,
      excludeBookingId: bookingToEdit?.id,
    });
  }, [
    activeStaff,
    bookingToEdit?.id,
    businessHours,
    dateValue,
    existingBookingsForDate,
    selectedStaffId,
    serviceDurationMinutes,
    slotsResult.slots,
    staffAvailability,
  ]);

  const onApplySuggestion = (suggestion) => {
    setSelectedSlotTime(suggestion.slotValue);
    if (suggestion.type === 'preferred_staff' && suggestion.staffId) {
      setSelectedStaffId(suggestion.staffId);
    }
    setSelectedRecommendationType(suggestion.type);
  };

  const isRecommendationAccepted = (recommendation) => {
    if (selectedRecommendationType) {
      return recommendation.type === selectedRecommendationType;
    }

    const matchesSlot = recommendation.slotValue === selectedSlotTime;
    const matchesStaff = recommendation.staffId
      ? recommendation.staffId === (selectedStaff?.id || null)
      : true;

    return matchesSlot && matchesStaff;
  };

  const onSave = async () => {
    const normalizedDate = formatDateValue(dateValue);
    const normalizedTime = selectedSlotTime;

    if (!clientName.trim() || !selectedService || !normalizedDate || !normalizedTime) {
      Alert.alert('Missing details', 'Please fill client, choose a service, date, and time slot.');
      return;
    }

    if (!slotsResult.slots.some((slot) => slot.value === normalizedTime)) {
      Alert.alert('Unavailable slot', 'Please pick one of the available time slots.');
      return;
    }

    const parsedPrice = Number(String(price).replace(',', '.'));
    if (!price.trim() || Number.isNaN(parsedPrice) || parsedPrice < 0) {
      Alert.alert('Invalid price', 'Please enter a valid non-negative price.');
      return;
    }

    setIsSaving(true);
    setSaveError('');

    const payload = {
      client_name: clientName.trim(),
      service: selectedService.name,
      date: normalizedDate,
      time: normalizedTime,
      price: parsedPrice,
      notes: notes.trim(),
      staff_member_id: selectedStaff?.id || null,
      booking_metadata: {
        service_id: selectedService.id,
        service_name: selectedService.name,
        service_duration_minutes: Number(duration || selectedService.duration_minutes || 0),
        service_category: category || selectedService.category || 'General',
        service_color: selectedService.color || null,
        staff_member_id: selectedStaff?.id || null,
        staff_member_name: selectedStaff?.name || null,
        staff_member_role: selectedStaff?.role || null,
        staff_member_color: selectedStaff?.color || null,
        notification_hooks: {
          confirmed_sms: 'pending',
        },
      },
    };

    if (isEditing) {
      const { error, data } = await updateBooking(bookingToEdit.id, payload);
      setIsSaving(false);

      if (error) {
        setSaveError(error.message);
        Alert.alert('Update failed', error.message);
        return;
      }

      await Promise.all(
        aiRecommendations.map((recommendation) => {
          const wasAccepted = isRecommendationAccepted(recommendation);

          return logAiRecommendation({
            recommendationType: recommendation.type,
            accepted: wasAccepted,
            bookingId: data?.id || bookingToEdit.id,
            reasoningMetadata: {
              ...recommendation.reasoning,
              flow: isEditing ? 'edit_booking' : 'new_booking',
              selected_slot_time: selectedSlotTime,
              selected_staff_id: selectedStaff?.id || null,
            },
          });
        })
      );

      Alert.alert('Booking updated', 'Your booking details were updated.');
    } else {
      const { error, data } = await addBooking({ ...payload, status: 'confirmed' });
      setIsSaving(false);

      if (error) {
        setSaveError(error.message);
        Alert.alert('Save failed', error.message);
        return;
      }

      await Promise.all(
        aiRecommendations.map((recommendation) => {
          const wasAccepted = isRecommendationAccepted(recommendation);

          return logAiRecommendation({
            recommendationType: recommendation.type,
            accepted: wasAccepted,
            bookingId: data?.id || null,
            reasoningMetadata: {
              ...recommendation.reasoning,
              flow: isEditing ? 'edit_booking' : 'new_booking',
              selected_slot_time: selectedSlotTime,
              selected_staff_id: selectedStaff?.id || null,
            },
          });
        })
      );

      Alert.alert('Booking saved', 'Your new booking has been added.');
    }

    navigation.navigate(ROUTES.MainTabs, {
      screen: ROUTES.Bookings,
    });
  };

  return (
    <ScreenContainer style={{ paddingTop: 0 }}>
      <BackButton navigation={navigation} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: 24,
            paddingTop: 92,
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
            {isEditing ? 'Edit Booking' : 'Add Booking'}
          </Text>

          <Text
            style={{
              color: COLORS.textSecondary,
              marginTop: 8,
              marginBottom: 24,
            }}
          >
            {isEditing
              ? 'Update your premium appointment details'
              : 'Create a premium appointment in seconds'}
          </Text>

          {saveError ? (
            <Text
              style={{
                color: '#FCA5A5',
                marginBottom: 12,
              }}
            >
              {saveError}
            </Text>
          ) : null}

          <Field
            label="Client name"
            value={clientName}
            onChangeText={setClientName}
            placeholder="Enter client name"
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
              Service
            </Text>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 4 }}
            >
              {activeServices.map((serviceItem) => {
                const isSelected = serviceItem.id === selectedServiceId;
                return (
                  <TouchableOpacity
                    key={serviceItem.id}
                    onPress={() => setSelectedServiceId(serviceItem.id)}
                    style={{
                      width: 180,
                      backgroundColor: isSelected ? '#231B3A' : COLORS.card,
                      borderColor: isSelected ? COLORS.accent : '#2D2D38',
                      borderWidth: 1,
                      borderRadius: 14,
                      padding: 12,
                      marginRight: 10,
                    }}
                  >
                    <Text style={{ color: COLORS.textPrimary, fontWeight: '700' }}>
                      {serviceItem.name}
                    </Text>
                    <Text style={{ color: COLORS.textSecondary, marginTop: 4 }}>
                      {serviceItem.duration_minutes || 0} mins
                    </Text>
                    <Text style={{ color: COLORS.textSecondary, marginTop: 2 }}>
                      ${Number(serviceItem.price || 0).toFixed(2)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {isServicesLoading ? (
              <Text style={{ color: COLORS.textSecondary, marginTop: 8 }}>
                Loading services...
              </Text>
            ) : null}

            {servicesError ? (
              <Text style={{ color: '#FCA5A5', marginTop: 8 }}>
                {servicesError}
              </Text>
            ) : null}

            {!isServicesLoading && !activeServices.length ? (
              <Text style={{ color: '#FCA5A5', marginTop: 8 }}>
                No active services found. Add one in Services first.
              </Text>
            ) : null}
          </View>

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

              {activeStaff.map((member) => {
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

          <View
            style={{
              backgroundColor: '#13131C',
              borderRadius: 14,
              borderWidth: 1,
              borderColor: '#2E2A45',
              padding: 14,
              marginBottom: 14,
            }}
          >
            <Text
              style={{
                color: COLORS.textPrimary,
                fontSize: 15,
                fontWeight: '700',
                marginBottom: 4,
              }}
            >
              AI Scheduling Suggestions
            </Text>
            <Text style={{ color: COLORS.textSecondary, fontSize: 12, marginBottom: 10 }}>
              Deterministic recommendations using availability, workload, and open slots.
            </Text>

            {aiRecommendations.length ? (
              aiRecommendations.map((suggestion) => {
                const isActive = selectedRecommendationType === suggestion.type;
                return (
                  <View
                    key={suggestion.type}
                    style={{
                      backgroundColor: isActive ? '#241A3C' : '#161622',
                      borderColor: isActive ? COLORS.accent : '#2D2D38',
                      borderWidth: 1,
                      borderRadius: 12,
                      padding: 12,
                      marginBottom: 8,
                    }}
                  >
                    <Text style={{ color: COLORS.textPrimary, fontWeight: '700' }}>
                      {suggestion.title}
                    </Text>
                    <Text style={{ color: COLORS.textSecondary, marginTop: 4, fontSize: 12 }}>
                      {suggestion.subtitle}
                    </Text>
                    <Text style={{ color: '#DDD6FE', marginTop: 6, fontWeight: '700' }}>
                      {suggestion.slotLabel}
                      {suggestion.staffName ? ` • ${suggestion.staffName}` : ''}
                    </Text>

                    <TouchableOpacity
                      onPress={() => onApplySuggestion(suggestion)}
                      style={{
                        marginTop: 10,
                        alignSelf: 'flex-start',
                        backgroundColor: isActive ? COLORS.accent : '#1F1F2C',
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: isActive ? '#8B5CF6' : '#323245',
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                      }}
                    >
                      <Text style={{ color: COLORS.textPrimary, fontSize: 12, fontWeight: '700' }}>
                        {isActive ? 'Applied' : 'Apply Suggestion'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                );
              })
            ) : (
              <Text style={{ color: '#71717A', fontSize: 12 }}>
                Suggestions will appear once date, service duration, and slots are available.
              </Text>
            )}
          </View>

          <Field
            label="Price"
            value={price}
            onChangeText={setPrice}
            placeholder="0.00"
            keyboardType="decimal-pad"
          />
          <Field
            label="Duration (minutes)"
            value={duration}
            onChangeText={setDuration}
            placeholder="60"
            keyboardType="number-pad"
          />
          <Field
            label="Category"
            value={category}
            onChangeText={setCategory}
            placeholder="General"
          />
          <PickerField
            label="Date"
            value={formatDateDisplay(dateValue)}
            onPress={openDatePicker}
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

            {!slotsResult.slots.length ? (
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
            placeholder="Any details for this booking"
            multiline
          />

          <PrimaryButton
            title={
              isSaving
                ? isEditing
                  ? 'Updating...'
                  : 'Saving...'
                : isEditing
                  ? 'Update Booking'
                  : 'Save Booking'
            }
            onPress={onSave}
            style={{ marginTop: 10 }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}
