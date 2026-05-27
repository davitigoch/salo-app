import React from 'react';
import { Text, StatusBar } from 'react-native';

import PrimaryButton from '../components/PrimaryButton';
import ScreenContainer from '../components/ScreenContainer';
import { COLORS } from '../constants/colors';
import { ROUTES } from '../constants/routes';

export default function WelcomeScreen({ navigation }) {
  return (
    <ScreenContainer
      centered
      style={{
        padding: 24,
      }}
    >
      <StatusBar barStyle="light-content" />

      <Text
        style={{
          color: COLORS.textPrimary,
          fontSize: 52,
          fontWeight: '700',
          letterSpacing: 4,
          marginBottom: 12,
        }}
      >
        SALO
      </Text>

      <Text
        style={{
          color: COLORS.textSecondary,
          fontSize: 18,
          textAlign: 'center',
          marginBottom: 40,
        }}
      >
        Luxury salon booking experience
      </Text>

      <PrimaryButton
        title="Get Started"
        onPress={() => navigation.navigate(ROUTES.Login)}
        fullWidth
      />
    </ScreenContainer>
  );
}
