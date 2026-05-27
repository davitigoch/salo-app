import React from 'react';
import { View, Text } from 'react-native';

import PrimaryButton from '../components/PrimaryButton';
import ScreenContainer from '../components/ScreenContainer';
import { COLORS } from '../constants/colors';
import { ROUTES } from '../constants/routes';

export default function HomeScreen({ navigation }) {
  return (
    <ScreenContainer
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
        Dashboard
      </Text>

      <Text
        style={{
          color: COLORS.textSecondary,
          marginTop: 8,
          marginBottom: 28,
        }}
      >
        Today's salon overview
      </Text>

      <View
        style={{
          backgroundColor: COLORS.card,
          padding: 20,
          borderRadius: 22,
          marginBottom: 16,
        }}
      >
        <Text
          style={{
            color: COLORS.textPrimary,
            fontSize: 20,
            fontWeight: '700',
          }}
        >
          12 Appointments
        </Text>

        <Text
          style={{
            color: COLORS.textSecondary,
            marginTop: 6,
          }}
        >
          3 upcoming today
        </Text>
      </View>

      <PrimaryButton
        title="View Bookings"
        onPress={() => navigation.navigate(ROUTES.Bookings)}
      />

      <PrimaryButton
        title="+ New Booking"
        onPress={() => navigation.navigate(ROUTES.AddBooking)}
        style={{
          marginTop: 12,
        }}
      />
    </ScreenContainer>
  );
}
