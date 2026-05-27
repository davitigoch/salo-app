import React from 'react';
import { Alert, View, Text } from 'react-native';

import PrimaryButton from '../components/PrimaryButton';
import ScreenContainer from '../components/ScreenContainer';
import { COLORS } from '../constants/colors';
import { useAuth } from '../context/AuthContext';

const SETTINGS = ['Business Hours', 'Team Access', 'Notifications'];

export default function SettingsScreen() {
  const { signOut } = useAuth();

  const onSignOut = async () => {
    const { error } = await signOut();
    if (error) {
      Alert.alert('Sign out failed', error.message);
    }
  };

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

      <PrimaryButton
        title="Sign Out"
        onPress={onSignOut}
        style={{
          marginTop: 24,
        }}
      />
    </ScreenContainer>
  );
}
