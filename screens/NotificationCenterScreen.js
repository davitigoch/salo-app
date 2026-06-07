import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import BackButton from '../components/BackButton';
import ScreenContainer from '../components/ScreenContainer';
import { COLORS } from '../constants/colors';
import { ROUTES } from '../constants/routes';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../constants/supabase';

function formatRelativeTime(isoString) {
  if (!isoString) {
    return '';
  }

  // Supabase timestamptz comes back as "2026-06-06T12:34:56.789+00:00".
  // Only append 'Z' when the string has NO timezone indicator at all (bare
  // local-time strings like "2026-06-06T12:34:56"). Strings already carrying
  // 'Z' or a numeric offset (+00:00 / -05:00) are valid ISO 8601 and parse
  // correctly without modification. Appending 'Z' to an offset string produces
  // an invalid value that Date.parse() silently rejects as NaN.
  const str = String(isoString);
  const hasTimezone = /Z$|[+-]\d{2}:?\d{2}$/.test(str);
  const normalized = hasTimezone ? str : `${str}Z`;
  const created = new Date(normalized).getTime();

  if (Number.isNaN(created)) {
    return '';
  }

  const diffMs = Date.now() - created;

  if (diffMs < 0) {
    // Clock skew — treat as just now.
    return 'Just now';
  }

  const diffSeconds = Math.floor(diffMs / 1000);
  if (diffSeconds < 60) {
    return 'Just now';
  }

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  if (diffHours < 48) {
    return 'Yesterday';
  }

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function getStatusStyle(status) {
  switch (status) {
    case 'processed':
      return { background: '#153325', text: '#86EFAC', border: '#1F4A34' };
    case 'processing':
      return { background: '#122A42', text: '#93C5FD', border: '#25476B' };
    case 'pending':
      return { background: '#2B2310', text: '#FDE68A', border: '#5B4B1A' };
    case 'failed':
      return { background: '#342023', text: '#FCA5A5', border: '#5A252A' };
    default:
      return { background: COLORS.card, text: COLORS.textSecondary, border: '#2A2A33' };
  }
}

function getChannelStyle(channel) {
  if (channel === 'push') {
    return { background: '#1E1B4B', text: '#C4B5FD', border: '#4338CA' };
  }
  if (channel === 'email') {
    return { background: '#122A42', text: '#93C5FD', border: '#25476B' };
  }
  return { background: COLORS.card, text: COLORS.textSecondary, border: '#2A2A33' };
}

function resolveTitle(item) {
  const payloadTitle = item?.payload?.title;
  if (payloadTitle) {
    return String(payloadTitle);
  }

  const eventType = String(item.event_type || '');
  switch (eventType) {
    case 'booking.created':
      return 'Booking received';
    case 'booking.rescheduled':
      return 'Booking rescheduled';
    case 'booking.cancelled':
      return 'Booking cancelled';
    case 'booking.reminder_24h':
      return 'Appointment tomorrow';
    case 'booking.reminder_2h':
      return 'Appointment in 2 hours';
    default:
      return eventType || 'Notification';
  }
}

// Converts "14:00" / "14:30" → "2:00 PM" / "2:30 PM".
// Strings that already contain AM/PM are returned unchanged.
function formatAppointmentTime(timeStr) {
  if (!timeStr) {
    return '';
  }
  const s = String(timeStr);
  if (/[AaPp][Mm]/.test(s)) {
    return s;
  }
  const match = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return s;
  }
  const hours = parseInt(match[1], 10);
  const minutes = match[2];
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const h = hours % 12 || 12;
  return minutes === '00' ? `${h} ${suffix}` : `${h}:${minutes} ${suffix}`;
}

// Returns "Today", "Tomorrow", "Jun 5", or "Jun 5, 2024" for cross-year dates.
// Parses payload.date (YYYY-MM-DD) as a local calendar date — no timezone conversion.
function formatAppointmentDate(dateStr) {
  if (!dateStr) {
    return '';
  }
  const match = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return dateStr;
  }
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1;
  const day = parseInt(match[3], 10);
  const apptDate = new Date(year, month, day);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getTime() + 86400000);
  if (apptDate.getTime() === today.getTime()) {
    return 'Today';
  }
  if (apptDate.getTime() === tomorrow.getTime()) {
    return 'Tomorrow';
  }
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const label = `${MONTHS[month]} ${day}`;
  return year !== now.getFullYear() ? `${label}, ${year}` : label;
}

function resolveBody(item) {
  const payloadBody = item?.payload?.body;
  if (payloadBody) {
    return String(payloadBody);
  }

  const payload = item?.payload || {};
  const service = String(payload.service || '');
  const formattedDate = formatAppointmentDate(String(payload.date || ''));
  const formattedTime = formatAppointmentTime(String(payload.time || ''));

  let datePart = '';
  if (formattedDate && formattedTime) {
    datePart =
      formattedDate === 'Today' || formattedDate === 'Tomorrow'
        ? `${formattedDate} at ${formattedTime}`
        : `${formattedDate}, ${formattedTime}`;
  } else if (formattedDate) {
    datePart = formattedDate;
  } else if (formattedTime) {
    datePart = formattedTime;
  }

  if (service && datePart) {
    return `${service} • ${datePart}`;
  }
  return service || datePart;
}

export default function NotificationCenterScreen({ navigation }) {
  const { session } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchNotifications = useCallback(async () => {
    const userId = session?.user?.id;

    if (!userId) {
      setNotifications([]);
      setIsLoading(false);
      return;
    }

    const { data, error: fetchError } = await supabase
      .from('notification_outbox')
      .select('id, event_type, notification_channel, notification_status, created_at, read_at, payload, booking_id')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (fetchError) {
      setError(fetchError.message);
    } else {
      setNotifications(Array.isArray(data) ? data : []);
      setError('');
    }

    setIsLoading(false);
  }, [session?.user?.id]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await fetchNotifications();
    setIsRefreshing(false);
  }, [fetchNotifications]);

  const markAsRead = useCallback(async (item) => {
    if (item.read_at) {
      return;
    }
    const { error: updateError } = await supabase
      .from('notification_outbox')
      .update({ read_at: new Date().toISOString() })
      .eq('id', item.id);
    if (!updateError) {
      setNotifications((prev) =>
        prev.map((n) => (n.id === item.id ? { ...n, read_at: new Date().toISOString() } : n))
      );
    }
  }, []);

  const onPressNotification = useCallback(async (item) => {
    await markAsRead(item);
    if (item.booking_id) {
      navigation.navigate(ROUTES.BookingDetail, { bookingId: item.booking_id });
    }
  }, [markAsRead, navigation]);

  const renderItem = ({ item }) => {
    const isUnread = !item.read_at;
    const title = resolveTitle(item);
    const body = resolveBody(item);
    const statusStyle = getStatusStyle(item.notification_status);
    const channelStyle = getChannelStyle(item.notification_channel);
    const relativeTime = formatRelativeTime(item.created_at);

    return (
      <TouchableOpacity
        onPress={() => onPressNotification(item)}
        activeOpacity={0.7}
        style={{
          backgroundColor: COLORS.card,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: isUnread ? COLORS.accent : '#2A2A33',
          padding: 14,
          marginBottom: 10,
        }}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, paddingRight: 8 }}>
            {isUnread ? (
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: COLORS.accent,
                  marginRight: 6,
                  flexShrink: 0,
                }}
              />
            ) : null}
            <Text
              style={{
                color: COLORS.textPrimary,
                fontWeight: isUnread ? '700' : '500',
                fontSize: 15,
                flex: 1,
              }}
              numberOfLines={1}
            >
              {title}
            </Text>
          </View>
          <Text style={{ color: COLORS.textSecondary, fontSize: 12 }}>
            {relativeTime}
          </Text>
        </View>

        {body ? (
          <Text
            style={{
              color: COLORS.textSecondary,
              marginTop: 4,
              fontSize: 13,
              lineHeight: 18,
            }}
            numberOfLines={2}
          >
            {body}
          </Text>
        ) : null}

        <View style={{ flexDirection: 'row', marginTop: 10, gap: 8 }}>
          <View
            style={{
              backgroundColor: statusStyle.background,
              borderColor: statusStyle.border,
              borderWidth: 1,
              borderRadius: 8,
              paddingHorizontal: 8,
              paddingVertical: 3,
            }}
          >
            <Text style={{ color: statusStyle.text, fontSize: 11, fontWeight: '600' }}>
              {item.notification_status || 'unknown'}
            </Text>
          </View>

          <View
            style={{
              backgroundColor: channelStyle.background,
              borderColor: channelStyle.border,
              borderWidth: 1,
              borderRadius: 8,
              paddingHorizontal: 8,
              paddingVertical: 3,
            }}
          >
            <Text style={{ color: channelStyle.text, fontSize: 11, fontWeight: '600' }}>
              {item.notification_channel || 'unknown'}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <ScreenContainer style={{ padding: 0 }}>
      <BackButton navigation={navigation} />

      <View style={{ flex: 1, paddingTop: 90, paddingHorizontal: 24 }}>
        <Text
          style={{
            color: COLORS.textPrimary,
            fontSize: 28,
            fontWeight: '700',
            marginBottom: 4,
          }}
        >
          Notifications
        </Text>
        <Text
          style={{
            color: COLORS.textSecondary,
            marginBottom: 20,
          }}
        >
          Recent booking and system alerts
        </Text>

        {isLoading ? (
          <Text style={{ color: COLORS.textSecondary, textAlign: 'center', marginTop: 40 }}>
            Loading notifications...
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
            <Text style={{ color: '#FCA5A5', fontWeight: '700' }}>Unable to load notifications</Text>
            <Text style={{ color: '#FCA5A5', marginTop: 4, fontSize: 13 }}>{error}</Text>
          </View>
        ) : (
          <FlatList
            data={notifications}
            keyExtractor={(item) => String(item.id)}
            renderItem={renderItem}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 40 }}
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={onRefresh}
                tintColor={COLORS.accent}
              />
            }
            ListEmptyComponent={
              <View style={{ alignItems: 'center', marginTop: 60 }}>
                <Text style={{ fontSize: 32, marginBottom: 12 }}>🔔</Text>
                <Text style={{ color: COLORS.textPrimary, fontWeight: '700', fontSize: 16 }}>
                  No notifications yet
                </Text>
                <Text style={{ color: COLORS.textSecondary, marginTop: 6, textAlign: 'center' }}>
                  Booking alerts and reminders will appear here.
                </Text>
              </View>
            }
          />
        )}
      </View>
    </ScreenContainer>
  );
}
