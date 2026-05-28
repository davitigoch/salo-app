import React, { useEffect, useState } from 'react';
import { Alert, SafeAreaView, ScrollView, Switch, Text, TextInput, View } from 'react-native';

import BackButton from '../components/BackButton';
import PrimaryButton from '../components/PrimaryButton';
import ScreenContainer from '../components/ScreenContainer';
import { COLORS } from '../constants/colors';
import { useAuth } from '../context/AuthContext';

export default function PaymentSettingsScreen({ navigation }) {
  const { business, businessError, isBusinessLoading, saveBusinessPaymentSettings } = useAuth();
  const [depositsEnabled, setDepositsEnabled] = useState(false);
  const [depositPercentage, setDepositPercentage] = useState('30');
  const [requireCardOnBooking, setRequireCardOnBooking] = useState(false);
  const [isSavingPayments, setIsSavingPayments] = useState(false);

  useEffect(() => {
    if (!business) {
      return;
    }

    setDepositsEnabled(Boolean(business.deposits_enabled));
    setDepositPercentage(String(Number(business.deposit_percentage ?? 30)));
    setRequireCardOnBooking(Boolean(business.require_card_on_booking));
  }, [business]);

  const onSavePaymentSettings = async () => {
    const parsedPercentage = Number.parseFloat(depositPercentage);

    if (Number.isNaN(parsedPercentage) || parsedPercentage < 0 || parsedPercentage > 100) {
      Alert.alert('Invalid deposit percentage', 'Enter a value from 0 to 100.');
      return;
    }

    setIsSavingPayments(true);

    const { error } = await saveBusinessPaymentSettings({
      deposits_enabled: depositsEnabled,
      deposit_percentage: Number(parsedPercentage.toFixed(2)),
      require_card_on_booking: requireCardOnBooking,
    });

    setIsSavingPayments(false);

    if (error) {
      Alert.alert('Save failed', error.message || 'Could not save payment settings.');
      return;
    }

    Alert.alert('Saved', 'Payment settings updated successfully.');
  };

  return (
    <ScreenContainer style={{ padding: 0 }}>
      <BackButton navigation={navigation} />
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 88, paddingBottom: 140 }}
          contentInsetAdjustmentBehavior="automatic"
        >
          <Text style={{ color: COLORS.textPrimary, fontSize: 32, fontWeight: '700' }}>
            Payment Settings
          </Text>
          <Text style={{ color: COLORS.textSecondary, marginTop: 8, marginBottom: 18 }}>
            Control deposits and card requirements for public bookings.
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
            }}
          >
            <View
              style={{
                padding: 12,
                borderRadius: 14,
                backgroundColor: '#111116',
                borderWidth: 1,
                borderColor: '#272730',
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Text style={{ color: COLORS.textPrimary, fontWeight: '600' }}>Enable Deposits</Text>
              <Switch
                value={depositsEnabled}
                onValueChange={setDepositsEnabled}
                trackColor={{ false: '#353543', true: '#5B21B6' }}
                thumbColor={depositsEnabled ? '#A78BFA' : '#9CA3AF'}
              />
            </View>

            <View
              style={{
                marginTop: 12,
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
                Use 0-100. This applies when deposits are enabled.
              </Text>
            </View>

            <View
              style={{
                marginTop: 12,
                padding: 12,
                borderRadius: 14,
                backgroundColor: '#111116',
                borderWidth: 1,
                borderColor: '#272730',
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Text style={{ color: COLORS.textPrimary, fontWeight: '600', flex: 1, paddingRight: 12 }}>
                Require Card On Booking
              </Text>
              <Switch
                value={requireCardOnBooking}
                onValueChange={setRequireCardOnBooking}
                trackColor={{ false: '#353543', true: '#5B21B6' }}
                thumbColor={requireCardOnBooking ? '#A78BFA' : '#9CA3AF'}
              />
            </View>

            <PrimaryButton
              title={isSavingPayments ? 'Saving...' : 'Save Payment Settings'}
              onPress={onSavePaymentSettings}
              style={{ marginTop: 14 }}
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    </ScreenContainer>
  );
}