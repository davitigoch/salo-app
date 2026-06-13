import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Linking, ScrollView, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ExpoLinking from 'expo-linking';

import BackButton from '../components/BackButton';
import PrimaryButton from '../components/PrimaryButton';
import ScreenContainer from '../components/ScreenContainer';
import SegmentedControl from '../components/SegmentedControl';
import { COLORS } from '../constants/colors';
import { supabase } from '../constants/supabase';
import { useAuth } from '../context/AuthContext';
import {
  getBusinessPaymentSettingsFromMode,
  getPaymentModeFromBusiness,
  getPaymentModeLabel,
  getStripeConnectButtonConfig,
  getStripeConnectStatus,
  PAYMENT_MODE_OPTIONS,
  PAYMENT_MODES,
} from '../utils/stripePayments';
import { getEdgeFunctionErrorMessage } from '../utils/edgeFunctions';

function InfoRow({ label, value }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: '#272730',
      }}
    >
      <Text style={{ color: COLORS.textSecondary, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: COLORS.textPrimary, fontSize: 14, fontWeight: '700' }}>{value}</Text>
    </View>
  );
}

function getStripeReturnUrls() {
  const baseUrl = ExpoLinking.createURL('settings/payment');
  return {
    returnUrl: `${baseUrl}?stripe=return`,
    refreshUrl: `${baseUrl}?stripe=refresh`,
  };
}

function isStripeSettingsLink(url) {
  const parsed = ExpoLinking.parse(url || '');
  const path = String(parsed.path || '');

  if (!path.includes('settings/payment')) {
    return false;
  }

  const stripeParam = String(parsed.queryParams?.stripe || '');
  return stripeParam === 'return' || stripeParam === 'refresh';
}

export default function PaymentSettingsScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const {
    business,
    businessError,
    isBusinessLoading,
    refreshBusiness,
    saveBusinessPaymentSettings,
  } = useAuth();
  const [paymentMode, setPaymentMode] = useState(PAYMENT_MODES.NONE);
  const [depositPercentage, setDepositPercentage] = useState('30');
  const [isSavingPayments, setIsSavingPayments] = useState(false);
  const [isConnectingStripe, setIsConnectingStripe] = useState(false);

  const stripeStatus = useMemo(() => getStripeConnectStatus(business), [business]);
  const stripeConnectButton = useMemo(
    () => getStripeConnectButtonConfig(stripeStatus),
    [stripeStatus]
  );
  const paymentsReady = stripeStatus.canCollectPayments;

  useEffect(() => {
    if (!business) {
      return;
    }

    setPaymentMode(getPaymentModeFromBusiness(business));
    setDepositPercentage(String(Number(business.deposit_percentage ?? 30)));
  }, [business]);

  const handleStripeReturn = useCallback(async () => {
    await refreshBusiness?.();
    Alert.alert(
      'Stripe setup updated',
      'Your connection status has been refreshed. If onboarding is complete, payment collection will unlock shortly.'
    );
  }, [refreshBusiness]);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      (async () => {
        const initialUrl = await Linking.getInitialURL();

        if (isActive && initialUrl && isStripeSettingsLink(initialUrl)) {
          await handleStripeReturn();
        }
      })();

      const subscription = Linking.addEventListener('url', ({ url }) => {
        if (isStripeSettingsLink(url)) {
          handleStripeReturn();
        }
      });

      return () => {
        isActive = false;
        subscription.remove();
      };
    }, [handleStripeReturn])
  );

  const onConnectStripe = async () => {
    if (!business?.id) {
      Alert.alert('Business unavailable', 'Unable to start Stripe onboarding.');
      return;
    }

    if (!stripeConnectButton.show) {
      return;
    }

    setIsConnectingStripe(true);

    const { returnUrl, refreshUrl } = getStripeReturnUrls();
    const { data, error } = await supabase.functions.invoke('create-stripe-connect-account-link', {
      body: {
        businessId: business.id,
        returnUrl,
        refreshUrl,
      },
    });

    setIsConnectingStripe(false);

    if (error || data?.error) {
      const message = await getEdgeFunctionErrorMessage({ error, data });
      console.warn('[SALO] create-stripe-connect-account-link failed', {
        message,
        status: error?.context?.status,
        businessId: business.id,
      });
      Alert.alert('Stripe connect failed', message);
      return;
    }

    if (!data?.onboardingUrl) {
      Alert.alert('Stripe connect failed', 'Stripe onboarding URL was not returned.');
      return;
    }

    await refreshBusiness?.();

    const canOpen = await Linking.canOpenURL(data.onboardingUrl);

    if (!canOpen) {
      Alert.alert('Unable to open Stripe', 'This device could not open Stripe onboarding.');
      return;
    }

    await Linking.openURL(data.onboardingUrl);
  };

  const onSavePaymentSettings = async () => {
    if (!paymentsReady) {
      Alert.alert('Connect Stripe first', 'Connect Stripe to accept online payments.');
      return;
    }

    if (paymentMode === PAYMENT_MODES.DEPOSIT) {
      const parsedPercentage = Number.parseFloat(depositPercentage);

      if (Number.isNaN(parsedPercentage) || parsedPercentage <= 0 || parsedPercentage > 100) {
        Alert.alert('Invalid deposit percentage', 'Enter a deposit percentage from 1 to 100.');
        return;
      }
    }

    setIsSavingPayments(true);

    const settings = getBusinessPaymentSettingsFromMode(paymentMode, depositPercentage);
    const { error } = await saveBusinessPaymentSettings(settings);

    setIsSavingPayments(false);

    if (error) {
      Alert.alert('Save failed', error.message || 'Could not save payment settings.');
      return;
    }

    Alert.alert('Saved', 'Payment settings updated successfully.');
  };

  const statusStyles =
    stripeStatus.key === 'ready'
      ? { background: '#153325', border: '#1F4A34', text: '#86EFAC' }
      : stripeStatus.key === 'pending_verification'
        ? { background: '#2B2310', border: '#5B4B1A', text: '#FDE68A' }
        : { background: '#342023', border: '#5A252A', text: '#FCA5A5' };

  return (
    <ScreenContainer style={{ padding: 0 }}>
      <BackButton navigation={navigation} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingTop: insets.top + 58,
          paddingBottom: 140,
        }}
      >
        <Text style={{ color: COLORS.textPrimary, fontSize: 32, fontWeight: '700' }}>
          Payment Settings
        </Text>
        <Text style={{ color: COLORS.textSecondary, marginTop: 8, marginBottom: 18 }}>
          Connect Stripe and choose how public bookings collect payment.
        </Text>

        {isBusinessLoading ? (
          <Text style={{ color: COLORS.textSecondary, marginBottom: 12 }}>
            Preparing payment settings...
          </Text>
        ) : null}

        {businessError ? (
          <Text style={{ color: '#FCA5A5', marginBottom: 12 }}>{businessError}</Text>
        ) : null}

        <View
          style={{
            backgroundColor: COLORS.card,
            padding: 18,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: '#2A2A33',
            marginBottom: 14,
          }}
        >
          <Text style={{ color: COLORS.textPrimary, fontSize: 18, fontWeight: '700' }}>
            Connect Stripe
          </Text>
          <Text style={{ color: COLORS.textSecondary, marginTop: 6, marginBottom: 14, lineHeight: 20 }}>
            {stripeStatus.description}
          </Text>

          <View
            style={{
              alignSelf: 'flex-start',
              backgroundColor: statusStyles.background,
              borderColor: statusStyles.border,
              borderWidth: 1,
              borderRadius: 999,
              paddingHorizontal: 12,
              paddingVertical: 6,
              marginBottom: 14,
            }}
          >
            <Text style={{ color: statusStyles.text, fontSize: 11, fontWeight: '700' }}>
              {stripeStatus.label.toUpperCase()}
            </Text>
          </View>

          <InfoRow
            label="Stripe account"
            value={business?.stripe_account_id ? 'Connected' : 'Not connected'}
          />
          <InfoRow label="Deposits enabled" value={business?.deposits_enabled ? 'Yes' : 'No'} />
          <InfoRow
            label="Deposit percentage"
            value={`${Number(business?.deposit_percentage ?? 0).toFixed(0)}%`}
          />

          {stripeConnectButton.show ? (
            <PrimaryButton
              title={isConnectingStripe ? 'Opening Stripe...' : stripeConnectButton.title}
              onPress={onConnectStripe}
              style={{ marginTop: 14 }}
            />
          ) : (
            <Text style={{ color: COLORS.textSecondary, marginTop: 14, lineHeight: 20, fontSize: 13 }}>
              Stripe is connected. You can accept online payments for public bookings.
            </Text>
          )}
        </View>

        <View
          style={{
            backgroundColor: COLORS.card,
            padding: 18,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: '#2A2A33',
            opacity: paymentsReady ? 1 : 0.72,
          }}
        >
          <Text style={{ color: COLORS.textPrimary, fontSize: 18, fontWeight: '700' }}>
            Public Booking Payments
          </Text>

          {!paymentsReady ? (
            <Text style={{ color: '#FCD34D', marginTop: 10, marginBottom: 14, lineHeight: 20 }}>
              Connect Stripe to accept online payments.
            </Text>
          ) : (
            <Text style={{ color: COLORS.textSecondary, marginTop: 6, marginBottom: 14, lineHeight: 20 }}>
              Choose one payment option for customers booking online.
            </Text>
          )}

          <SegmentedControl
            options={PAYMENT_MODE_OPTIONS}
            value={paymentMode}
            onChange={(mode) => {
              if (!paymentsReady) {
                return;
              }

              setPaymentMode(mode);
            }}
          />

          {paymentMode === PAYMENT_MODES.DEPOSIT ? (
            <View
              style={{
                marginTop: 14,
                padding: 12,
                borderRadius: 14,
                backgroundColor: '#111116',
                borderWidth: 1,
                borderColor: '#272730',
              }}
            >
              <Text style={{ color: COLORS.textSecondary, fontSize: 12, marginBottom: 8 }}>
                Deposit Percentage
              </Text>
              <TextInput
                value={depositPercentage}
                onChangeText={setDepositPercentage}
                keyboardType="decimal-pad"
                editable={paymentsReady}
                placeholder="30"
                placeholderTextColor="#71717A"
                style={{
                  color: COLORS.textPrimary,
                  backgroundColor: '#0D0D12',
                  borderWidth: 1,
                  borderColor: '#2A2A33',
                  borderRadius: 12,
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  fontSize: 16,
                  fontWeight: '600',
                }}
              />
              <Text style={{ color: COLORS.textSecondary, marginTop: 8, fontSize: 12 }}>
                Customers pay this percentage upfront. The remainder is due at the appointment.
              </Text>
            </View>
          ) : null}

          <View
            style={{
              marginTop: 14,
              padding: 12,
              borderRadius: 14,
              backgroundColor: '#111116',
              borderWidth: 1,
              borderColor: '#272730',
            }}
          >
            <Text style={{ color: COLORS.textSecondary, fontSize: 12 }}>Selected option</Text>
            <Text style={{ color: COLORS.textPrimary, marginTop: 4, fontWeight: '700' }}>
              {getPaymentModeLabel(paymentMode)}
            </Text>
          </View>

          <PrimaryButton
            title={isSavingPayments ? 'Saving...' : 'Save Payment Settings'}
            onPress={onSavePaymentSettings}
            style={{ marginTop: 14, opacity: paymentsReady ? 1 : 0.6 }}
          />
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
