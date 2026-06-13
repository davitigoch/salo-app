import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import BackButton from '../components/BackButton';
import PrimaryButton from '../components/PrimaryButton';
import ScreenContainer from '../components/ScreenContainer';
import { COLORS } from '../constants/colors';
import { useAuth } from '../context/AuthContext';
import { useBookings } from '../context/BookingsContext';
import {
  getNotificationPermissionStatus,
  requestNotificationPermissions,
  syncBookingReminders,
} from '../notifications/bookingReminders';
import { flushOwnerPushQueue, registerOwnerPushToken } from '../notifications/ownerPush';
import {
  fetchNotificationPreferences,
  updateOwnerPushSoundEnabled,
} from '../utils/notificationPreferences';

export default function NotificationSettingsScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { bookings } = useBookings();
  const { session, business } = useAuth();
  const [notificationStatus, setNotificationStatus] = useState('undetermined');
  const [isRequestingNotifications, setIsRequestingNotifications] = useState(false);
  const [isRegisteringPush, setIsRegisteringPush] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isUpdatingSound, setIsUpdatingSound] = useState(false);
  const [isLoadingPreferences, setIsLoadingPreferences] = useState(true);

  useEffect(() => {
    async function loadStatus() {
      const status = await getNotificationPermissionStatus();
      setNotificationStatus(status);
    }

    loadStatus();
  }, []);

  useEffect(() => {
    async function loadPreferences() {
      setIsLoadingPreferences(true);

      if (!business?.id) {
        setSoundEnabled(true);
        setIsLoadingPreferences(false);
        return;
      }

      const { data } = await fetchNotificationPreferences(business.id);
      setSoundEnabled(data?.owner_push_sound_enabled !== false);
      setIsLoadingPreferences(false);
    }

    loadPreferences();
  }, [business?.id]);

  const onToggleSound = async (enabled) => {
    setSoundEnabled(enabled);
    setIsUpdatingSound(true);

    if (business?.id) {
      const { error } = await updateOwnerPushSoundEnabled(business.id, enabled);
      setIsUpdatingSound(false);

      if (error) {
        setSoundEnabled(!enabled);
        Alert.alert('Update failed', error.message);
        return;
      }
    } else {
      setIsUpdatingSound(false);
    }

    if (notificationStatus === 'granted') {
      await syncBookingReminders(bookings, { soundEnabled: enabled });
    }
  };

  const onEnableReminders = async () => {
    setIsRequestingNotifications(true);
    const status = await requestNotificationPermissions();
    setNotificationStatus(status);

    if (status === 'granted') {
      await syncBookingReminders(bookings, { soundEnabled });
      Alert.alert(
        'Reminders enabled',
        'You will get local reminders 60 minutes before upcoming appointments.'
      );
    } else {
      Alert.alert(
        'Permission needed',
        'Please enable notifications in iOS settings to receive reminders.'
      );
    }

    setIsRequestingNotifications(false);
  };

  const onEnableOwnerPush = async () => {
    if (!session?.user?.id) {
      Alert.alert('Sign in required', 'Sign in to enable owner push alerts.');
      return;
    }

    setIsRegisteringPush(true);
    const status = await requestNotificationPermissions();
    setNotificationStatus(status);

    if (status !== 'granted') {
      Alert.alert(
        'Permission needed',
        'Please enable notifications in device settings to receive booking alerts.'
      );
      setIsRegisteringPush(false);
      return;
    }

    const { error, skipped, reason } = await registerOwnerPushToken(session.user.id);

    if (error) {
      Alert.alert('Push setup failed', error.message);
    } else if (skipped && reason === 'simulator') {
      Alert.alert(
        'Physical device required',
        'Owner push alerts require a physical device with a valid Expo project ID.'
      );
    } else if (skipped && reason === 'missing_project_id') {
      Alert.alert(
        'Push unavailable',
        'Expo project ID is missing. Configure EAS project settings to enable remote push.'
      );
    } else if (skipped) {
      Alert.alert(
        'Push unavailable',
        'Notifications permission is required for owner booking alerts.'
      );
    } else {
      await flushOwnerPushQueue();
      Alert.alert(
        'Owner alerts enabled',
        'You will receive push notifications for new public requests, cancellations, and reschedules.'
      );
    }

    setIsRegisteringPush(false);
  };

  return (
    <ScreenContainer style={{ padding: 0 }}>
      <BackButton navigation={navigation} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingTop: insets.top + 58,
          paddingBottom: 140,
        }}
      >
          <Text style={{ color: COLORS.textPrimary, fontSize: 32, fontWeight: '700' }}>
            Notification Settings
          </Text>
          <Text style={{ color: COLORS.textSecondary, marginTop: 8, marginBottom: 18 }}>
            Manage booking reminders and owner push alerts.
          </Text>

          <View
            style={{
              backgroundColor: COLORS.card,
              padding: 18,
              borderRadius: 18,
              borderWidth: 1,
              borderColor: '#2A2A33',
              marginBottom: 14,
            }}
          >
            <Text style={{ color: COLORS.textPrimary, fontSize: 18, fontWeight: '700' }}>
              Notification Sounds
            </Text>
            <Text style={{ color: COLORS.textSecondary, marginTop: 6, marginBottom: 14, lineHeight: 20 }}>
              Play the default sound for owner booking alerts and local appointment reminders.
            </Text>

            <View
              style={{
                backgroundColor: '#14141B',
                borderRadius: 12,
                borderWidth: 1,
                borderColor: '#2A2A34',
                padding: 12,
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Text style={{ color: COLORS.textPrimary, fontWeight: '600', flex: 1, paddingRight: 8 }}>
                Play notification sounds
              </Text>
              <Switch
                value={soundEnabled}
                onValueChange={onToggleSound}
                disabled={isLoadingPreferences || isUpdatingSound}
                trackColor={{ false: '#353543', true: '#5B21B6' }}
                thumbColor={soundEnabled ? '#A78BFA' : '#9CA3AF'}
              />
            </View>
          </View>

          <View
            style={{
              backgroundColor: COLORS.card,
              padding: 18,
              borderRadius: 18,
              borderWidth: 1,
              borderColor: '#2A2A33',
              marginBottom: 14,
            }}
          >
            <Text style={{ color: COLORS.textPrimary, fontSize: 18, fontWeight: '700' }}>
              Owner Booking Alerts
            </Text>
            <Text style={{ color: COLORS.textSecondary, marginTop: 6, marginBottom: 14, lineHeight: 20 }}>
              Status: {notificationStatus}. Get push alerts for public requests, cancellations, and reschedules even when the app is closed.
            </Text>

            <PrimaryButton
              title={isRegisteringPush ? 'Setting up...' : 'Enable Owner Alerts'}
              onPress={onEnableOwnerPush}
            />
          </View>

          <View
            style={{
              backgroundColor: COLORS.card,
              padding: 18,
              borderRadius: 18,
              borderWidth: 1,
              borderColor: '#2A2A33',
            }}
          >
            <Text style={{ color: COLORS.textPrimary, fontSize: 18, fontWeight: '700' }}>
              Booking Reminders
            </Text>
            <Text style={{ color: COLORS.textSecondary, marginTop: 6, marginBottom: 14, lineHeight: 20 }}>
              Status: {notificationStatus}. Get local alerts before appointments.
            </Text>

            <PrimaryButton
              title={isRequestingNotifications ? 'Checking...' : 'Enable Reminders'}
              onPress={onEnableReminders}
            />
          </View>
      </ScrollView>
    </ScreenContainer>
  );
}
