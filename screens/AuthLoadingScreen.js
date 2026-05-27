import React from 'react';
import { ActivityIndicator, Text } from 'react-native';

import ScreenContainer from '../components/ScreenContainer';
import { COLORS } from '../constants/colors';

export default function AuthLoadingScreen() {
  return (
    <ScreenContainer
      centered
      style={{
        padding: 24,
      }}
    >
      <ActivityIndicator size="large" color={COLORS.accent} />
      <Text
        style={{
          color: COLORS.textSecondary,
          marginTop: 16,
          fontSize: 15,
        }}
      >
        Preparing secure session...
      </Text>
    </ScreenContainer>
  );
}
