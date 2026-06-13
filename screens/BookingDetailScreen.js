import React, { useMemo, useState } from 'react';
import { Alert, Linking, ScrollView, Text, TouchableOpacity, View } from 'react-native';

import BackButton from '../components/BackButton';
import PrimaryButton from '../components/PrimaryButton';
import ScreenContainer from '../components/ScreenContainer';
import {
  getStatusLabel,
  getStatusStyles,
  isPendingPublicRequest,
} from '../constants/bookingStatus';
import { COLORS } from '../constants/colors';
import { ROUTES } from '../constants/routes';
import { useBookings } from '../context/BookingsContext';
import { useStaff } from '../context/StaffContext';

function formatTimeLabel(timeValue) {
  const parts = String(timeValue || '').split(':').map(Number);

  if (parts.length < 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) {
    return String(timeValue || '--:--');
  }

  const hours24 = parts[0];
  const minutes = String(parts[1]).padStart(2, '0');
  const period = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 || 12;

  return `${hours12}:${minutes} ${period}`;
}

function formatCreatedAt(value) {
  if (!value) {
    return '—';
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }

  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getBookingSourceLabel(source) {
  if (source === 'public') {
    return 'Public booking';
  }

  return 'Owner booking';
}

function DetailRow({ label, value, onPress, linkLabel }) {
  const displayValue = value || '—';

  return (
    <View style={{ marginBottom: 14 }}>
      <Text
        style={{
          color: COLORS.textSecondary,
          fontSize: 12,
          letterSpacing: 0.3,
          marginBottom: 4,
        }}
      >
        {label}
      </Text>
      {onPress && value ? (
        <TouchableOpacity onPress={onPress} activeOpacity={0.85}>
          <Text style={{ color: COLORS.accent, fontSize: 15, lineHeight: 22, fontWeight: '600' }}>
            {linkLabel || displayValue}
          </Text>
        </TouchableOpacity>
      ) : (
        <Text style={{ color: COLORS.textPrimary, fontSize: 15, lineHeight: 22 }}>
          {displayValue}
        </Text>
      )}
    </View>
  );
}

function DetailSection({ title, children, highlighted = false }) {
  return (
    <View
      style={{
        backgroundColor: highlighted ? '#221A10' : COLORS.card,
        borderColor: highlighted ? '#6B4C1A' : '#2A2A33',
        borderWidth: 1,
        borderRadius: 18,
        padding: 18,
        marginBottom: 14,
      }}
    >
      <Text
        style={{
          color: COLORS.textPrimary,
          fontSize: 16,
          fontWeight: '700',
          marginBottom: 12,
        }}
      >
        {title}
      </Text>
      {children}
    </View>
  );
}

function getStatusActions(status) {
  const normalized = status || 'confirmed';

  if (normalized === 'pending') {
    return [
      {
        status: 'confirmed',
        label: 'Confirm',
        title: 'Confirm booking?',
        message: 'This appointment will be marked as confirmed.',
        successMessage: 'Booking confirmed.',
      },
      {
        status: 'cancelled',
        label: 'Decline',
        title: 'Decline request?',
        message: 'This request will be marked as cancelled. The booking will not be deleted.',
        successMessage: 'Booking declined.',
        destructive: true,
      },
    ];
  }

  if (normalized === 'confirmed') {
    return [
      {
        status: 'completed',
        label: 'Mark Complete',
        title: 'Mark as complete?',
        message: 'This appointment will be marked as completed.',
        successMessage: 'Booking marked as complete.',
      },
      {
        status: 'cancelled',
        label: 'Cancel',
        title: 'Cancel booking?',
        message: 'This appointment will be marked as cancelled.',
        successMessage: 'Booking cancelled.',
        destructive: true,
      },
      {
        status: 'no_show',
        label: 'No-show',
        title: 'Mark as no-show?',
        message: 'This appointment will be marked as a no-show.',
        successMessage: 'Booking marked as no-show.',
      },
    ];
  }

  return [];
}

export default function BookingDetailScreen({ navigation, route }) {
  const bookingId = route?.params?.bookingId;
  const { bookings, updateBooking } = useBookings();
  const { staff } = useStaff();
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  const booking = useMemo(
    () => bookings.find((item) => item.id === bookingId),
    [bookings, bookingId]
  );

  const staffName = useMemo(() => {
    if (!booking) {
      return '';
    }

    const staffMemberId = booking.staff_member_id || booking.booking_metadata?.staff_member_id;
    const fromContext = staffMemberId
      ? staff.find((member) => member.id === staffMemberId)?.name
      : '';

    return fromContext || booking.booking_metadata?.staff_member_name || '';
  }, [booking, staff]);

  const onStatusAction = (action) => {
    if (!booking || isUpdatingStatus) {
      return;
    }

    Alert.alert(action.title, action.message, [
      { text: 'Keep current status', style: 'cancel' },
      {
        text: action.label,
        style: action.destructive ? 'destructive' : 'default',
        onPress: async () => {
          setIsUpdatingStatus(true);
          const { error } = await updateBooking(booking.id, { status: action.status });
          setIsUpdatingStatus(false);

          if (error) {
            Alert.alert('Status update failed', error.message);
            return;
          }

          Alert.alert('Updated', action.successMessage);
        },
      },
    ]);
  };

  const openPhone = (phone) => {
    Linking.openURL(`tel:${phone}`).catch(() => {
      Alert.alert('Unable to open phone', 'This device could not start a phone call.');
    });
  };

  const openEmail = (email) => {
    Linking.openURL(`mailto:${email}`).catch(() => {
      Alert.alert('Unable to open email', 'This device could not open your mail app.');
    });
  };

  if (!booking) {
    return (
      <ScreenContainer centered style={{ padding: 24 }}>
        <BackButton navigation={navigation} />
        <Text style={{ color: COLORS.textPrimary, fontSize: 20, fontWeight: '700' }}>
          Booking not found
        </Text>
        <Text style={{ color: COLORS.textSecondary, marginTop: 8, textAlign: 'center' }}>
          This booking may have been removed or is no longer available.
        </Text>
      </ScreenContainer>
    );
  }

  const status = booking.status || 'confirmed';
  const statusStyles = getStatusStyles(status);
  const isPublicBooking = booking.booking_source === 'public';
  const showPublicRequestHighlight = isPendingPublicRequest(booking);
  const statusActions = getStatusActions(status);
  const isReadOnly = statusActions.length === 0;
  const customerPhone = String(booking.customer_phone || '').trim();
  const customerEmail = String(booking.customer_email || '').trim();

  return (
    <ScreenContainer style={{ paddingTop: 0 }}>
      <BackButton navigation={navigation} />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingTop: 92,
          paddingBottom: 40,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={{ color: COLORS.textPrimary, fontSize: 30, fontWeight: '700' }}>
          Booking Details
        </Text>
        <Text style={{ color: COLORS.textSecondary, marginTop: 8, marginBottom: 18 }}>
          Review appointment information and manage status.
        </Text>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 18 }}>
          <View
            style={{
              backgroundColor: statusStyles.background,
              borderColor: statusStyles.border,
              borderWidth: 1,
              borderRadius: 999,
              paddingHorizontal: 12,
              paddingVertical: 6,
              marginRight: 8,
              marginBottom: 8,
            }}
          >
            <Text style={{ color: statusStyles.text, fontSize: 11, fontWeight: '700' }}>
              {getStatusLabel(status).toUpperCase()}
            </Text>
          </View>

          {isPublicBooking ? (
            <View
              style={{
                backgroundColor: '#3A2A10',
                borderColor: '#8B6914',
                borderWidth: 1,
                borderRadius: 999,
                paddingHorizontal: 12,
                paddingVertical: 6,
                marginBottom: 8,
              }}
            >
              <Text style={{ color: '#FCD34D', fontSize: 11, fontWeight: '700' }}>
                PUBLIC REQUEST
              </Text>
            </View>
          ) : null}
        </View>

        <DetailSection title="Customer" highlighted={showPublicRequestHighlight}>
          <DetailRow label="Client" value={booking.client_name} />
          <DetailRow
            label="Phone"
            value={customerPhone}
            onPress={customerPhone ? () => openPhone(customerPhone) : undefined}
          />
          <DetailRow
            label="Email"
            value={customerEmail}
            onPress={customerEmail ? () => openEmail(customerEmail) : undefined}
          />
        </DetailSection>

        <DetailSection title="Appointment">
          <DetailRow label="Service" value={booking.service} />
          <DetailRow label="Staff" value={staffName || 'Unassigned'} />
          <DetailRow label="Date" value={booking.date} />
          <DetailRow label="Time" value={formatTimeLabel(booking.time)} />
          <DetailRow label="Price" value={`$${Number(booking.price || 0).toFixed(2)}`} />
          <DetailRow label="Notes" value={booking.notes || 'No notes'} />
        </DetailSection>

        <DetailSection title="Booking Info">
          <DetailRow label="Created" value={formatCreatedAt(booking.created_at)} />
          <DetailRow label="Source" value={getBookingSourceLabel(booking.booking_source)} />
        </DetailSection>

        {statusActions.length ? (
          <View style={{ marginBottom: 14 }}>
            <Text
              style={{
                color: COLORS.textPrimary,
                fontSize: 16,
                fontWeight: '700',
                marginBottom: 10,
              }}
            >
              Actions
            </Text>

            {statusActions.map((action) => (
              <PrimaryButton
                key={action.status}
                title={isUpdatingStatus ? 'Updating...' : action.label}
                onPress={() => onStatusAction(action)}
                style={{
                  marginBottom: 10,
                  backgroundColor: action.destructive ? '#3A1D22' : COLORS.accent,
                  opacity: isUpdatingStatus ? 0.7 : 1,
                }}
              />
            ))}
          </View>
        ) : (
          <View
            style={{
              backgroundColor: '#15151B',
              borderColor: '#2D2D38',
              borderWidth: 1,
              borderRadius: 14,
              padding: 14,
              marginBottom: 14,
            }}
          >
            <Text style={{ color: COLORS.textSecondary, lineHeight: 20 }}>
              This booking is {getStatusLabel(status).toLowerCase()} and cannot be updated from here.
            </Text>
          </View>
        )}

        <TouchableOpacity
          onPress={() =>
            navigation.navigate(ROUTES.AddBooking, {
              bookingId: booking.id,
            })
          }
          style={{
            backgroundColor: '#15151B',
            borderColor: '#2D2D38',
            borderWidth: 1,
            borderRadius: 14,
            paddingVertical: 14,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: COLORS.textPrimary, fontWeight: '700' }}>Edit booking</Text>
        </TouchableOpacity>

        {isReadOnly ? null : (
          <Text style={{ color: COLORS.textSecondary, fontSize: 12, marginTop: 12, lineHeight: 18 }}>
            Status changes are saved immediately. Clients may be notified if SMS is enabled for your
            salon.
          </Text>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
