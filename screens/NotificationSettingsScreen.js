import React, { useEffect, useState } from 'react';
import { Alert, SafeAreaView, ScrollView, Text, View } from 'react-native';

import BackButton from '../components/BackButton';
import PrimaryButton from '../components/PrimaryButton';
import ScreenContainer from '../components/ScreenContainer';
import { COLORS } from '../constants/colors';
import { useBookings } from '../context/BookingsContext';
import {
  getNotificationPermissionStatus,
  requestNotificationPermissions,
  syncBookingReminders,
} from '../notifications/bookingReminders';

export default function NotificationSettingsScreen({ navigation }) {
  const { bookings } = useBookings();
  const [notificationStatus, setNotificationStatus] = useState('undetermined');
  const [isRequestingNotifications, setIsRequestingNotifications] = useState(false);

  useEffect(() => {
    async function loadStatus() {
      const status = await getNotificationPermissionStatus();
      setNotificationStatus(status);
    }

    loadStatus();
  }, []);

  const onEnableReminders = async () => {
    setIsRequestingNotifications(true);
    const status = await requestNotificationPermissions();
    setNotificationStatus(status);

    if (status === 'granted') {
      await syncBookingReminders(bookings);
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

  return (
    <ScreenContainer style={{ padding: 0 }}>
      <BackButton navigation={navigation} />
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 88, paddingBottom: 140 }}
          contentInsetAdjustmentBehavior="automatic"
        >
          <Text style={{ color: COLORS.textPrimary, fontSize: 32, fontWeight: '700' }}>
            Notification Settings
          </Text>
          <Text style={{ color: COLORS.textSecondary, marginTop: 8, marginBottom: 18 }}>
            Manage booking reminder permissions and local alerts.
          </Text>

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
      </SafeAreaView>
    </ScreenContainer>
  );
}