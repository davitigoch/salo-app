import React, { useEffect, useState } from 'react';
import { Alert, SafeAreaView, ScrollView, View, Text } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import PrimaryButton from '../components/PrimaryButton';
import ScreenContainer from '../components/ScreenContainer';
import { COLORS } from '../constants/colors';
import { ROUTES } from '../constants/routes';
import { useAuth } from '../context/AuthContext';
import { useBookings } from '../context/BookingsContext';
import {
  getNotificationPermissionStatus,
  requestNotificationPermissions,
  syncBookingReminders,
} from '../notifications/bookingReminders';

const SETTINGS = ['Business Hours', 'Team Access', 'Notifications'];

export default function SettingsScreen({ navigation }) {
  const { signOut, business, isBusinessLoading, businessError } = useAuth();
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

  const onSignOut = async () => {
    const { error } = await signOut();
    if (error) {
      Alert.alert('Sign out failed', error.message);
    }
  };

  const publicBookingLink = business?.slug
    ? `https://salo.app/${business.slug}`
    : '';

  const onCopyPublicLink = async () => {
    if (!publicBookingLink) {
      Alert.alert('Missing link', 'Public booking link is not available yet.');
      return;
    }

    await Clipboard.setStringAsync(publicBookingLink);
    Alert.alert('Copied', 'Public booking link copied to clipboard.');
  };

  return (
    <ScreenContainer style={{ padding: 0 }}>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 140 }}
          contentInsetAdjustmentBehavior="automatic"
        >
          <View
            style={{
              padding: 24,
              paddingTop: 70,
            }}
          >
            <Text
              style={{
                color: COLORS.textPrimary,
                fontSize: 32,
                fontWeight: '700',
              }}
            >
              Settings
            </Text>

            <Text
              style={{
                color: COLORS.textSecondary,
                marginTop: 8,
                marginBottom: 18,
              }}
            >
              Manage your salon preferences
            </Text>

            {SETTINGS.map((item) => (
              <View
                key={item}
                style={{
                  backgroundColor: COLORS.card,
                  padding: 18,
                  borderRadius: 18,
                  marginTop: 12,
                }}
              >
                <Text
                  style={{
                    color: COLORS.textPrimary,
                    fontSize: 18,
                    fontWeight: '600',
                  }}
                >
                  {item}
                </Text>
              </View>
            ))}

            <View
              style={{
                backgroundColor: COLORS.card,
                padding: 18,
                borderRadius: 18,
                marginTop: 16,
                borderWidth: 1,
                borderColor: '#2A2A33',
              }}
            >
              <Text
                style={{
                  color: COLORS.textPrimary,
                  fontSize: 18,
                  fontWeight: '700',
                }}
              >
                Booking Reminders
              </Text>
              <Text
                style={{
                  color: COLORS.textSecondary,
                  marginTop: 6,
                  marginBottom: 14,
                  lineHeight: 20,
                }}
              >
                Status: {notificationStatus}. Get local alerts before appointments.
              </Text>

              <PrimaryButton
                title={isRequestingNotifications ? 'Checking...' : 'Enable Reminders'}
                onPress={onEnableReminders}
              />
            </View>

            <View
              style={{
                backgroundColor: COLORS.card,
                padding: 18,
                borderRadius: 18,
                marginTop: 16,
                borderWidth: 1,
                borderColor: '#2A2A33',
              }}
            >
              <Text
                style={{
                  color: COLORS.textPrimary,
                  fontSize: 18,
                  fontWeight: '700',
                }}
              >
                Public Booking Link
              </Text>

              {isBusinessLoading ? (
                <Text
                  style={{
                    color: COLORS.textSecondary,
                    marginTop: 8,
                  }}
                >
                  Preparing your public booking page...
                </Text>
              ) : null}

              {businessError ? (
                <Text
                  style={{
                    color: '#FCA5A5',
                    marginTop: 8,
                  }}
                >
                  {businessError}
                </Text>
              ) : null}

              {!isBusinessLoading && !businessError ? (
                <>
                  <Text
                    style={{
                      color: COLORS.textSecondary,
                      marginTop: 8,
                      fontSize: 12,
                    }}
                  >
                    Slug
                  </Text>
                  <Text
                    style={{
                      color: COLORS.textPrimary,
                      marginTop: 2,
                      fontWeight: '600',
                    }}
                  >
                    {business?.slug || 'Not generated'}
                  </Text>

                  <Text
                    style={{
                      color: COLORS.textSecondary,
                      marginTop: 10,
                      fontSize: 12,
                    }}
                  >
                    Production URL
                  </Text>
                  <Text
                    style={{
                      color: COLORS.textSecondary,
                      marginTop: 2,
                      lineHeight: 20,
                    }}
                  >
                    {publicBookingLink || 'No public link generated yet.'}
                  </Text>

                  <PrimaryButton
                    title="Copy Link"
                    onPress={onCopyPublicLink}
                    style={{ marginTop: 12 }}
                  />
                </>
              ) : null}
            </View>

            <PrimaryButton
              title="Manage Services"
              onPress={() => navigation.navigate(ROUTES.Services)}
              style={{ marginTop: 16 }}
            />

            <PrimaryButton
              title="Business Hours & Availability"
              onPress={() => navigation.navigate(ROUTES.BusinessHours)}
              style={{ marginTop: 12 }}
            />

            <PrimaryButton
              title="Manage Team"
              onPress={() => navigation.navigate(ROUTES.Staff)}
              style={{ marginTop: 12 }}
            />

            <PrimaryButton
              title="Logout"
              onPress={onSignOut}
              style={{
                marginTop: 24,
              }}
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    </ScreenContainer>
  );
}
