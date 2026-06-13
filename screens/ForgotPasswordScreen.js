import React, { useState } from 'react';
import { Alert, Text, TextInput, TouchableOpacity, View } from 'react-native';

import PrimaryButton from '../components/PrimaryButton';
import ScreenContainer from '../components/ScreenContainer';
import { COLORS } from '../constants/colors';
import { ROUTES } from '../constants/routes';
import { useAuth } from '../context/AuthContext';

export default function ForgotPasswordScreen({ navigation }) {
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const onSubmit = async () => {
    if (!email.trim()) {
      Alert.alert('Missing email', 'Please enter the email for your account.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');
    setSuccessMessage('');

    const { error } = await requestPasswordReset(email.trim());
    setIsSubmitting(false);

    if (error) {
      setErrorMessage(error.message);
      Alert.alert('Could not send reset email', error.message);
      return;
    }

    setSuccessMessage(
      'If an account exists for that email, a password reset link has been sent. Open the link on this device to choose a new password.'
    );
  };

  return (
    <ScreenContainer
      style={{
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <Text
        style={{
          color: COLORS.textPrimary,
          fontSize: 34,
          fontWeight: '700',
          marginBottom: 12,
        }}
      >
        Reset password
      </Text>

      <Text
        style={{
          color: COLORS.textSecondary,
          marginBottom: 22,
          lineHeight: 22,
        }}
      >
        Enter your account email and we will send you a link to choose a new password.
      </Text>

      {errorMessage ? (
        <Text
          style={{
            color: '#FCA5A5',
            marginBottom: 14,
            lineHeight: 20,
          }}
        >
          {errorMessage}
        </Text>
      ) : null}

      {successMessage ? (
        <View
          style={{
            backgroundColor: '#132019',
            borderColor: '#166534',
            borderWidth: 1,
            borderRadius: 14,
            padding: 14,
            marginBottom: 16,
          }}
        >
          <Text style={{ color: '#BBF7D0', lineHeight: 20 }}>{successMessage}</Text>
        </View>
      ) : null}

      <View
        style={{
          backgroundColor: COLORS.card,
          borderColor: '#27272A',
          borderWidth: 1,
          borderRadius: 14,
          paddingHorizontal: 14,
          marginBottom: 16,
        }}
      >
        <TextInput
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          placeholder="Email"
          placeholderTextColor={COLORS.textSecondary}
          editable={!successMessage}
          style={{
            color: COLORS.textPrimary,
            height: 52,
            fontSize: 15,
          }}
        />
      </View>

      <PrimaryButton
        title={isSubmitting ? 'Sending reset link...' : 'Send reset link'}
        onPress={() => {
          if (successMessage) {
            return;
          }
          onSubmit();
        }}
      />

      <TouchableOpacity
        onPress={() => navigation.navigate(ROUTES.Login)}
        style={{
          marginTop: 14,
          alignItems: 'center',
        }}
      >
        <Text style={{ color: COLORS.textSecondary }}>Back to sign in</Text>
      </TouchableOpacity>
    </ScreenContainer>
  );
}
