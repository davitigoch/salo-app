import React, { useEffect, useState } from 'react';
import { Alert, Text, TouchableOpacity, View } from 'react-native';

import PrimaryButton from '../components/PrimaryButton';
import PasswordInput from '../components/PasswordInput';
import ScreenContainer from '../components/ScreenContainer';
import { COLORS } from '../constants/colors';
import { ROUTES } from '../constants/routes';
import { useAuth } from '../context/AuthContext';

export default function ResetPasswordScreen({ navigation }) {
  const {
    session,
    updatePassword,
    passwordRecoveryLinkError,
    clearPasswordRecovery,
    signOut,
  } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    if (passwordRecoveryLinkError) {
      setErrorMessage(passwordRecoveryLinkError);
      return;
    }

    if (!session) {
      setErrorMessage('This password reset link is invalid or has expired.');
    }
  }, [passwordRecoveryLinkError, session]);

  const onSubmit = async () => {
    if (successMessage) {
      return;
    }

    if (!password.trim() || !confirmPassword.trim()) {
      Alert.alert('Missing password', 'Please enter and confirm your new password.');
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert('Passwords do not match', 'Please make sure both password fields match.');
      return;
    }

    if (password.length < 6) {
      Alert.alert('Password too short', 'Use at least 6 characters.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');

    const { error } = await updatePassword(password);
    setIsSubmitting(false);

    if (error) {
      setErrorMessage(error.message);
      Alert.alert('Could not update password', error.message);
      return;
    }

    setSuccessMessage('Your password has been updated. You can continue into SALO.');
  };

  const onContinueToSignIn = async () => {
    clearPasswordRecovery();
    await signOut();

    setTimeout(() => {
      navigation.reset({
        index: 0,
        routes: [{ name: ROUTES.Login }],
      });
    }, 0);
  };

  const onRequestNewLink = async () => {
    clearPasswordRecovery();
    await signOut();
    navigation.navigate(ROUTES.ForgotPassword);
  };

  const linkIsInvalid = Boolean(errorMessage) && !session;
  const isSuccess = Boolean(successMessage);

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
        Choose a new password
      </Text>

      <Text
        style={{
          color: COLORS.textSecondary,
          marginBottom: 22,
          lineHeight: 22,
        }}
      >
        {linkIsInvalid
          ? 'This reset link can no longer be used.'
          : 'Enter a new password for your SALO account.'}
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

      {!linkIsInvalid ? (
        <>
          <PasswordInput
            value={password}
            onChangeText={setPassword}
            editable={!isSuccess}
            placeholder="New password"
            style={{
              marginBottom: 12,
              opacity: isSuccess ? 0.55 : 1,
            }}
          />

          <PasswordInput
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            editable={!isSuccess}
            placeholder="Confirm new password"
            style={{
              marginBottom: 16,
              opacity: isSuccess ? 0.55 : 1,
            }}
          />

          <View pointerEvents={isSuccess ? 'none' : 'auto'} style={{ opacity: isSuccess ? 0.55 : 1 }}>
            <PrimaryButton
              title={isSubmitting ? 'Updating password...' : 'Update password'}
              onPress={onSubmit}
            />
          </View>

          {isSuccess ? (
            <PrimaryButton
              title="Continue to sign in"
              onPress={onContinueToSignIn}
              style={{ marginTop: 12 }}
            />
          ) : null}
        </>
      ) : null}

      {linkIsInvalid ? (
        <PrimaryButton title="Request a new reset link" onPress={onRequestNewLink} />
      ) : null}

      {!isSuccess ? (
        <TouchableOpacity
          onPress={async () => {
            clearPasswordRecovery();
            await signOut();
            navigation.navigate(ROUTES.Login);
          }}
          style={{
            marginTop: 14,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: COLORS.textSecondary }}>Back to sign in</Text>
        </TouchableOpacity>
      ) : null}
    </ScreenContainer>
  );
}
