import React, { useState } from 'react';
import { Alert, Text, TextInput, TouchableOpacity, View } from 'react-native';

import PrimaryButton from '../components/PrimaryButton';
import ScreenContainer from '../components/ScreenContainer';
import { COLORS } from '../constants/colors';
import { ROUTES } from '../constants/routes';
import { useAuth } from '../context/AuthContext';

export default function LoginScreen({ navigation }) {
  const { signIn, signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSignUpMode, setIsSignUpMode] = useState(false);
  const [authError, setAuthError] = useState('');

  const onLogin = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Missing details', 'Please enter email and password.');
      return;
    }

    setIsSubmitting(true);
    setAuthError('');
    const action = isSignUpMode ? signUp : signIn;
    const { error } = await action({
      email: email.trim(),
      password,
    });
    setIsSubmitting(false);

    if (error) {
      setAuthError(error.message);
      Alert.alert(isSignUpMode ? 'Sign up failed' : 'Login failed', error.message);
      return;
    }

    if (isSignUpMode) {
      Alert.alert(
        'Account created',
        'If email confirmation is enabled, confirm your email before signing in.'
      );
      setIsSignUpMode(false);
    }
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
        Welcome back
      </Text>

      <Text
        style={{
          color: COLORS.textSecondary,
          marginBottom: 22,
        }}
      >
        {isSignUpMode
          ? 'Create your account to start managing bookings.'
          : 'Sign in to manage your salon bookings.'}
      </Text>

      {authError ? (
        <Text
          style={{
            color: '#FCA5A5',
            marginBottom: 14,
          }}
        >
          {authError}
        </Text>
      ) : null}

      <View
        style={{
          backgroundColor: COLORS.card,
          borderColor: '#27272A',
          borderWidth: 1,
          borderRadius: 14,
          paddingHorizontal: 14,
          marginBottom: 12,
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
          style={{
            color: COLORS.textPrimary,
            height: 52,
            fontSize: 15,
          }}
        />
      </View>

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
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="Password"
          placeholderTextColor={COLORS.textSecondary}
          style={{
            color: COLORS.textPrimary,
            height: 52,
            fontSize: 15,
          }}
        />
      </View>

      <PrimaryButton
        title={
          isSubmitting
            ? isSignUpMode
              ? 'Creating account...'
              : 'Signing in...'
            : isSignUpMode
              ? 'Sign Up'
              : 'Sign In'
        }
        onPress={onLogin}
      />

      <TouchableOpacity
        onPress={() => {
          setIsSignUpMode((previous) => !previous);
          setAuthError('');
        }}
        style={{
          marginTop: 14,
          alignItems: 'center',
        }}
      >
        <Text
          style={{
            color: COLORS.textSecondary,
          }}
        >
          {isSignUpMode
            ? 'Already have an account? Sign In'
            : 'Need an account? Sign Up'}
        </Text>
      </TouchableOpacity>

      {!isSignUpMode ? (
        <TouchableOpacity
          onPress={() => navigation.navigate(ROUTES.ForgotPassword)}
          style={{
            marginTop: 18,
            alignItems: 'center',
          }}
        >
          <Text
            style={{
              color: COLORS.accent,
              fontWeight: '600',
            }}
          >
            Forgot password?
          </Text>
        </TouchableOpacity>
      ) : null}
    </ScreenContainer>
  );
}
