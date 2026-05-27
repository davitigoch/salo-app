import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import PrimaryButton from '../components/PrimaryButton';
import ScreenContainer from '../components/ScreenContainer';
import { COLORS } from '../constants/colors';
import { ROUTES } from '../constants/routes';
import { useBookings } from '../context/BookingsContext';

function Field({ label, value, onChangeText, placeholder, multiline = false }) {
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

export default function AddBookingScreen({ navigation, route }) {
  const { bookings, addBooking, updateBooking } = useBookings();
  const bookingId = route?.params?.bookingId;
  const bookingToEdit = useMemo(
    () => bookings.find((booking) => booking.id === bookingId),
    [bookings, bookingId]
  );
  const isEditing = Boolean(bookingToEdit);

  const [clientName, setClientName] = useState('');
  const [service, setService] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    if (!bookingToEdit) {
      return;
    }

    setClientName(bookingToEdit.client_name || '');
    setService(bookingToEdit.service || '');
    setDate(bookingToEdit.date || '');
    setTime(bookingToEdit.time || '');
    setNotes(bookingToEdit.notes || '');
  }, [bookingToEdit]);

  const onSave = async () => {
    if (!clientName.trim() || !service.trim() || !date.trim() || !time.trim()) {
      Alert.alert('Missing details', 'Please fill client, service, date, and time.');
      return;
    }

    setIsSaving(true);
    setSaveError('');

    const payload = {
      client_name: clientName.trim(),
      service: service.trim(),
      date: date.trim(),
      time: time.trim(),
      notes: notes.trim(),
    };

    if (isEditing) {
      const { error } = await updateBooking(bookingToEdit.id, payload);
      setIsSaving(false);

      if (error) {
        setSaveError(error.message);
        Alert.alert('Update failed', error.message);
        return;
      }

      Alert.alert('Booking updated', 'Your booking details were updated.');
    } else {
      const { error } = await addBooking(payload);
      setIsSaving(false);

      if (error) {
        setSaveError(error.message);
        Alert.alert('Save failed', error.message);
        return;
      }

      Alert.alert('Booking saved', 'Your new booking has been added.');
    }

    navigation.navigate(ROUTES.MainTabs, {
      screen: ROUTES.Bookings,
    });
  };

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
          <Field
            label="Service"
            value={service}
            onChangeText={setService}
            placeholder="Haircut, Coloring, Facial..."
          />
          <Field
            label="Date"
            value={date}
            onChangeText={setDate}
            placeholder="YYYY-MM-DD"
          />
          <Field
            label="Time"
            value={time}
            onChangeText={setTime}
            placeholder="HH:MM"
          />
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
