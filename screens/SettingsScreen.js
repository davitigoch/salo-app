import React, { useState } from 'react';
import { Alert, ScrollView, Switch, View, Text, TouchableOpacity } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import PrimaryButton from '../components/PrimaryButton';
import ScreenContainer from '../components/ScreenContainer';
import { getPublicBookingUrl } from '../constants/bookingLink';
import { COLORS } from '../constants/colors';
import { ROUTES } from '../constants/routes';
import { useAuth } from '../context/AuthContext';
 
const SETTINGS = [
  {
    title: 'Analytics',
    description: 'Revenue, appointments, and top performers.',
    route: ROUTES.Analytics,
  },
  {
    title: 'Business Hours',
    description: 'Control your weekly booking availability.',
    route: ROUTES.BusinessHours,
  },
  {
    title: 'Manage Team',
    description: 'Edit staff and working availability.',
    route: ROUTES.Staff,
  },
  {
    title: 'Notification Settings',
    description: 'Reminders and booking alert permissions.',
    route: ROUTES.NotificationSettings,
  },
  {
    title: 'Payment Settings',
    description: 'Deposits and card requirements.',
    route: ROUTES.PaymentSettings,
  },
  {
    title: 'Google Calendar',
    description: 'Connect Google Calendar for confirmed booking sync.',
    route: ROUTES.CalendarSettings,
  },
];

export default function SettingsScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const {
    signOut,
    business,
    isBusinessLoading,
    businessError,
    updatePublicBookingEnabled,
  } = useAuth();
  const [isUpdatingPublicBooking, setIsUpdatingPublicBooking] = useState(false);

  const isPublicBookingEnabled = business?.public_booking_enabled !== false;

  const onSignOut = async () => {
    const { error } = await signOut();
    if (error) {
      Alert.alert('Sign out failed', error.message);
    }
  };

  const publicBookingLink = getPublicBookingUrl(business);

  const onCopyPublicLink = async () => {
    if (!publicBookingLink) {
      Alert.alert('Missing link', 'Public booking link is not available yet.');
      return;
    }

    await Clipboard.setStringAsync(publicBookingLink);
    Alert.alert('Copied', 'Public booking link copied to clipboard.');
  };

  const onTogglePublicBooking = async (enabled) => {
    setIsUpdatingPublicBooking(true);
    const { error } = await updatePublicBookingEnabled(enabled);
    setIsUpdatingPublicBooking(false);

    if (error) {
      Alert.alert('Update failed', error.message);
    }
  };

  return (
    <ScreenContainer style={{ padding: 0 }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 140 }}
      >
        <View
          style={{
            padding: 24,
            paddingTop: insets.top + 10,
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
              <TouchableOpacity
                key={item.title}
                onPress={() => navigation.navigate(item.route)}
                activeOpacity={0.9}
                style={{
                  backgroundColor: COLORS.card,
                  padding: 18,
                  borderRadius: 18,
                  marginTop: 12,
                  borderWidth: 1,
                  borderColor: '#2A2A33',
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text
                    style={{
                      color: COLORS.textPrimary,
                      fontSize: 18,
                      fontWeight: '600',
                    }}
                  >
                    {item.title}
                  </Text>
                  <Text
                    style={{
                      color: COLORS.textSecondary,
                      marginTop: 4,
                      lineHeight: 18,
                    }}
                  >
                    {item.description}
                  </Text>
                </View>
                <Text style={{ color: COLORS.accent, fontSize: 18, fontWeight: '700' }}>›</Text>
              </TouchableOpacity>
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
                    Public booking URL
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

                  {!isPublicBookingEnabled ? (
                    <Text
                      style={{
                        color: '#FCA5A5',
                        marginTop: 8,
                        fontSize: 13,
                        lineHeight: 18,
                      }}
                    >
                      Public booking is currently disabled.
                    </Text>
                  ) : null}

                  <View
                    style={{
                      backgroundColor: '#14141B',
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: '#2A2A34',
                      padding: 12,
                      marginTop: 12,
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ color: COLORS.textPrimary, fontWeight: '600', flex: 1, paddingRight: 8 }}>
                      Public online booking
                    </Text>
                    <Switch
                      value={isPublicBookingEnabled}
                      onValueChange={onTogglePublicBooking}
                      disabled={isUpdatingPublicBooking}
                      trackColor={{ false: '#353543', true: '#5B21B6' }}
                      thumbColor={isPublicBookingEnabled ? '#A78BFA' : '#9CA3AF'}
                    />
                  </View>

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
    </ScreenContainer>
  );
}
