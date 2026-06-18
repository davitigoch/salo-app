import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
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
  getNotificationIconName,
  shouldOpenNotificationDetail,
} from '../utils/notificationCenter';

function NotificationRow({ notification, onPress, isLast }) {
  const accentColor = getNotificationAccentColor(notification.severity);
  const iconName = getNotificationIconName(notification.eventType);

  return (
    <TouchableOpacity
      onPress={() => onPress(notification)}
      activeOpacity={0.9}
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingVertical: 16,
        paddingHorizontal: 4,
        borderBottomWidth: isLast ? 0 : 1,
        borderBottomColor: '#2A2A33',
        opacity: notification.isRead ? 0.72 : 1,
      }}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          backgroundColor: '#1B1B24',
          borderWidth: 1,
          borderColor: '#2F2F3D',
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: 14,
        }}
      >
        <Ionicons name={iconName} size={18} color={accentColor} />
      </View>

      <View style={{ flex: 1, paddingRight: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
          {!notification.isRead ? (
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                backgroundColor: COLORS.accent,
                marginRight: 8,
              }}
            />
          ) : null}
          <Text
            style={{
              color: COLORS.textPrimary,
              fontSize: 15,
              fontWeight: '700',
              flex: 1,
            }}
            numberOfLines={2}
          >
            {notification.title}
          </Text>
        </View>
        <Text
          style={{
            color: COLORS.textSecondary,
            fontSize: 13,
            lineHeight: 18,
            marginBottom: 8,
          }}
          numberOfLines={2}
        >
          {notification.body}
        </Text>
        <Text style={{ color: '#6D6D7A', fontSize: 12 }}>
          {formatNotificationTimestamp(notification.createdAt)}
        </Text>
      </View>

      <Ionicons name="chevron-forward" size={16} color="#6D6D7A" style={{ marginTop: 4 }} />
    </TouchableOpacity>
  );
}

export default function NotificationsScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const {
    notifications,
    unreadCount,
    isNotificationsLoading,
    notificationsError,
    loadNotifications,
    refreshUnreadCount,
    markRead,
    markAllRead,
  } = useNotifications();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isMarkingAll, setIsMarkingAll] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadNotifications();
      refreshUnreadCount();
    }, [loadNotifications, refreshUnreadCount])
  );

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await loadNotifications();
    await refreshUnreadCount();
    setIsRefreshing(false);
  }, [loadNotifications, refreshUnreadCount]);

  const handleMarkAllRead = useCallback(async () => {
    if (!unreadCount) {
      return;
    }

    setIsMarkingAll(true);
    await markAllRead();
    setIsMarkingAll(false);
  }, [markAllRead, unreadCount]);

  const openNotification = useCallback(
    async (notification) => {
      if (!notification.isRead) {
        await markRead(notification.id);
      }

      if (shouldOpenNotificationDetail(notification)) {
        navigation.navigate(ROUTES.NotificationDetail, {
          notificationId: notification.id,
        });
        return;
      }

      const bookingId = getNotificationBookingId(notification);

      if (bookingId) {
        navigation.navigate(ROUTES.BookingDetail, { bookingId });
        return;
      }

      navigation.navigate(ROUTES.NotificationDetail, {
        notificationId: notification.id,
      });
    },
    [markRead, navigation]
  );

  const showInitialLoading = isNotificationsLoading && !notifications.length && !isRefreshing;

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
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={COLORS.accent}
          />
        }
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 8,
          }}
        >
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={{ color: COLORS.textPrimary, fontSize: 28, fontWeight: '700' }}>
              Notifications
            </Text>
            <Text style={{ color: COLORS.textSecondary, fontSize: 13, marginTop: 4 }}>
              Updates about appointments, payments, and delivery issues
            </Text>
          </View>
          {unreadCount > 0 ? (
            <TouchableOpacity
              onPress={handleMarkAllRead}
              disabled={isMarkingAll}
              activeOpacity={0.85}
              style={{
                backgroundColor: '#15151B',
                borderColor: '#2D2D38',
                borderWidth: 1,
                borderRadius: 12,
                paddingHorizontal: 12,
                paddingVertical: 10,
                opacity: isMarkingAll ? 0.6 : 1,
              }}
            >
              <Text style={{ color: COLORS.textPrimary, fontSize: 12, fontWeight: '700' }}>
                {isMarkingAll ? 'Saving...' : 'Mark all read'}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {notificationsError ? (
          <Text style={{ color: '#FCA5A5', marginTop: 12, marginBottom: 8 }}>
            {notificationsError}
          </Text>
        ) : null}

        {showInitialLoading ? (
          <View style={{ paddingVertical: 48, alignItems: 'center' }}>
            <ActivityIndicator color={COLORS.accent} />
            <Text style={{ color: COLORS.textSecondary, marginTop: 12 }}>Loading notifications...</Text>
          </View>
        ) : null}

        {!showInitialLoading && !notifications.length ? (
          <View
            style={{
              backgroundColor: COLORS.card,
              borderColor: '#2A2A33',
              borderWidth: 1,
              borderRadius: 18,
              padding: 24,
              marginTop: 20,
              alignItems: 'center',
            }}
          >
            <Ionicons name="notifications-off-outline" size={28} color="#6D6D7A" />
            <Text
              style={{
                color: COLORS.textPrimary,
                fontSize: 16,
                fontWeight: '700',
                marginTop: 14,
              }}
            >
              No notifications yet
            </Text>
            <Text
              style={{
                color: COLORS.textSecondary,
                fontSize: 13,
                lineHeight: 20,
                marginTop: 8,
                textAlign: 'center',
              }}
            >
              Appointment updates, payments, and sync issues will appear here.
            </Text>
          </View>
        ) : null}

        {notifications.length ? (
          <View
            style={{
              backgroundColor: COLORS.card,
              borderColor: '#2A2A33',
              borderWidth: 1,
              borderRadius: 18,
              paddingHorizontal: 16,
              marginTop: 20,
            }}
          >
            {notifications.map((notification, index) => (
              <NotificationRow
                key={notification.id}
                notification={notification}
                onPress={openNotification}
                isLast={index === notifications.length - 1}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}
