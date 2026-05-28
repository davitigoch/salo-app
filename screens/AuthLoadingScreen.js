import React from 'react';
import { ActivityIndicator, Text } from 'react-native';

import PrimaryButton from '../components/PrimaryButton';
import ScreenContainer from '../components/ScreenContainer';
import { COLORS } from '../constants/colors';

export default function AuthLoadingScreen({ errorMessage, onRetry, onLogout }) {
  const hasError = Boolean(errorMessage);

  return (
    <ScreenContainer
      centered
      style={{
        padding: 24,
      }}
    >
      {!hasError ? <ActivityIndicator size="large" color={COLORS.accent} /> : null}
      <Text
        style={{
          color: COLORS.textSecondary,
          marginTop: 16,
          fontSize: 15,
          textAlign: 'center',
        }}
      >
        {hasError ? errorMessage : 'Preparing secure session...'}
      </Text>

      {hasError ? (
        <>
          <PrimaryButton
            title="Retry"
            onPress={onRetry}
            fullWidth
            style={{ marginTop: 18 }}
          />
          <PrimaryButton
            title="Logout"
            onPress={onLogout}
            fullWidth
            style={{ marginTop: 10, backgroundColor: '#2A1618' }}
          />
        </>
      ) : null}
    </ScreenContainer>
  );
}
