import React, { useMemo } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import BackButton from '../components/BackButton';
import ScreenContainer from '../components/ScreenContainer';
import { COLORS } from '../constants/colors';
import { ROUTES } from '../constants/routes';
import { useNotifications } from '../context/NotificationsContext';
import {
  formatNotificationTimestamp,
  getNotificationAccentColor,
  getNotificationBookingId,
  getNotificationEventLabel,
  getNotificationIconName,
} from '../utils/notificationCenter';

function DetailRow({ label, value }) {
  if (!value) {
    return null;
  }

  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ color: COLORS.textSecondary, fontSize: 12, marginBottom: 4 }}>{label}</Text>
      <Text style={{ color: COLORS.textPrimary, fontSize: 15, fontWeight: '600', lineHeight: 22 }}>
        {value}
      </Text>
    </View>
  );
}

function formatMetadataAmount(metadata) {
  if (metadata?.amount != null) {
    const amount = Number(metadata.amount);

    if (!Number.isNaN(amount)) {
      return `$${amount.toFixed(2)}`;
    }
  }

  if (metadata?.amount_cents != null) {
    const cents = Number(metadata.amount_cents);

    if (!Number.isNaN(cents)) {
      return `$${(cents / 100).toFixed(2)}`;
    }
  }

  return null;
}

export default function NotificationDetailScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { notifications } = useNotifications();
  const notificationId = route?.params?.notificationId;

  const notification = useMemo(
    () => notifications.find((item) => item.id === notificationId) || null,
    [notificationId, notifications]
  );

  const bookingId = getNotificationBookingId(notification);
  const metadata = notification?.metadata || {};
  const accentColor = getNotificationAccentColor(notification?.severity);
  const iconName = getNotificationIconName(notification?.eventType);

  if (!notification) {
    return (
      <ScreenContainer centered style={{ padding: 24 }}>
        <BackButton navigation={navigation} />
        <Text style={{ color: COLORS.textPrimary, fontSize: 18, fontWeight: '700' }}>
          Notification not found
        </Text>
      </ScreenContainer>
    );
  }

  const showCalendarSettings =
    notification.eventType === 'calendar_sync_failed' && !bookingId;

  return (
    <ScreenContainer style={{ paddingTop: 0 }}>
      <BackButton navigation={navigation} />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingTop: insets.top + 58,
          paddingBottom: insets.bottom + 40,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: 14,
            backgroundColor: '#1B1B24',
            borderWidth: 1,
            borderColor: '#2F2F3D',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 16,
          }}
        >
          <Ionicons name={iconName} size={22} color={accentColor} />
        </View>

        <Text style={{ color: '#8B8BA2', fontSize: 12, fontWeight: '700', letterSpacing: 0.4 }}>
          {getNotificationEventLabel(notification.eventType).toUpperCase()}
        </Text>
        <Text style={{ color: COLORS.textPrimary, fontSize: 26, fontWeight: '700', marginTop: 8 }}>
          {notification.title}
        </Text>
        <Text style={{ color: COLORS.textSecondary, fontSize: 12, marginTop: 8 }}>
          {formatNotificationTimestamp(notification.createdAt)}
          {notification.isRead ? ' • Read' : ' • Unread'}
        </Text>

        <View
          style={{
            backgroundColor: COLORS.card,
            borderColor: '#2A2A33',
            borderWidth: 1,
            borderRadius: 18,
            padding: 18,
            marginTop: 20,
            marginBottom: 14,
          }}
        >
          <Text style={{ color: COLORS.textPrimary, fontSize: 15, lineHeight: 22 }}>
            {notification.body}
          </Text>
        </View>

        <View
          style={{
            backgroundColor: COLORS.card,
            borderColor: '#2A2A33',
            borderWidth: 1,
            borderRadius: 18,
            padding: 18,
            marginBottom: 14,
          }}
        >
          <Text style={{ color: COLORS.textPrimary, fontSize: 16, fontWeight: '700', marginBottom: 12 }}>
            Details
          </Text>
          <DetailRow label="Client" value={metadata.client_name} />
          <DetailRow label="Service" value={metadata.service} />
          <DetailRow
            label="Appointment"
            value={
              metadata.date && metadata.time
                ? `${metadata.date} at ${metadata.time}`
                : metadata.date || metadata.time
            }
          />
          <DetailRow label="Amount" value={formatMetadataAmount(metadata)} />
          <DetailRow label="Channel" value={metadata.channel} />
          <DetailRow label="Error" value={metadata.error_summary} />
        </View>

        {bookingId ? (
          <TouchableOpacity
            onPress={() => navigation.navigate(ROUTES.BookingDetail, { bookingId })}
            activeOpacity={0.9}
            style={{
              backgroundColor: COLORS.accent,
              borderRadius: 14,
              paddingVertical: 14,
              alignItems: 'center',
              marginBottom: 12,
            }}
          >
            <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 15 }}>
              View appointment
            </Text>
          </TouchableOpacity>
        ) : null}

        {showCalendarSettings ? (
          <TouchableOpacity
            onPress={() => navigation.navigate(ROUTES.CalendarSettings)}
            activeOpacity={0.9}
            style={{
              backgroundColor: '#15151B',
              borderColor: '#2D2D38',
              borderWidth: 1,
              borderRadius: 14,
              paddingVertical: 14,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: COLORS.textPrimary, fontWeight: '700', fontSize: 15 }}>
              Open calendar settings
            </Text>
          </TouchableOpacity>
        ) : null}

        {notification.eventType === 'payment_received' && bookingId ? (
          <TouchableOpacity
            onPress={() => navigation.navigate(ROUTES.PaymentSettings)}
            activeOpacity={0.9}
            style={{
              backgroundColor: '#15151B',
              borderColor: '#2D2D38',
              borderWidth: 1,
              borderRadius: 14,
              paddingVertical: 14,
              alignItems: 'center',
              marginTop: bookingId ? 12 : 0,
            }}
          >
            <Text style={{ color: COLORS.textPrimary, fontWeight: '700', fontSize: 15 }}>
              Payment settings
            </Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}
