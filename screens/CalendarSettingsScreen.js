import React, { useCallback, useState } from 'react';
import { Alert, Linking, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ExpoLinking from 'expo-linking';

import BackButton from '../components/BackButton';
import PrimaryButton from '../components/PrimaryButton';
import ScreenContainer from '../components/ScreenContainer';
import { COLORS } from '../constants/colors';
import { useAuth } from '../context/AuthContext';
import { getEdgeFunctionErrorMessage } from '../utils/edgeFunctions';
import {
  formatGoogleCalendarTimestamp,
  getGoogleCalendarStatusLabel,
  getGoogleCalendarSyncLabel,
} from '../utils/googleCalendar';
import { supabase } from '../constants/supabase';

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
        gap: 16,
      }}
    >
      <Text style={{ color: COLORS.textSecondary, fontSize: 13, flex: 1 }}>{label}</Text>
      <Text
        style={{
          color: COLORS.textPrimary,
          fontSize: 14,
          fontWeight: '700',
          flex: 1,
          textAlign: 'right',
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function isCalendarSettingsLink(url) {
  const parsed = ExpoLinking.parse(url || '');
  const path = String(parsed.path || '');

  return path.includes('settings/calendar');
}

export default function CalendarSettingsScreen() {
  const insets = useSafeAreaInsets();
  const { business, businessError, isBusinessLoading } = useAuth();
  const [connectionStatus, setConnectionStatus] = useState(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [statusError, setStatusError] = useState('');

  const refreshStatus = useCallback(
    async ({ showAlerts = false } = {}) => {
      if (!business?.id) {
        setConnectionStatus(null);
        setIsLoadingStatus(false);
        return { ok: false };
      }

      setIsLoadingStatus(true);
      setStatusError('');

      const { data, error } = await supabase.functions.invoke('get-google-calendar-status', {
        body: {
          businessId: business.id,
        },
      });

      setIsLoadingStatus(false);

      if (error || data?.error) {
        const message = await getEdgeFunctionErrorMessage({ error, data });
        setStatusError(message);

        if (showAlerts) {
          Alert.alert('Status unavailable', message);
        }

        return { ok: false, message };
      }

      setConnectionStatus(data?.status || null);
      return { ok: true, status: data?.status || null };
    },
    [business?.id]
  );

  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      (async () => {
        if (!isActive) {
          return;
        }

        await refreshStatus();
      })();

      const subscription = Linking.addEventListener('url', ({ url }) => {
        if (isCalendarSettingsLink(url)) {
          refreshStatus({ showAlerts: true });
        }
      });

      return () => {
        isActive = false;
        subscription.remove();
      };
    }, [refreshStatus])
  );

  const onConnectGoogleCalendar = async () => {
    if (!business?.id) {
      Alert.alert('Business unavailable', 'Unable to start Google Calendar connection.');
      return;
    }

    setIsConnecting(true);

    const { data, error } = await supabase.functions.invoke('google-calendar-oauth-start', {
      body: {
        businessId: business.id,
      },
    });

    setIsConnecting(false);

    if (error || data?.error) {
      const message = await getEdgeFunctionErrorMessage({ error, data });
      Alert.alert('Google connect failed', message);
      return;
    }

    if (!data?.authUrl) {
      Alert.alert('Google connect failed', 'Google authorization URL was not returned.');
      return;
    }

    const canOpen = await Linking.canOpenURL(data.authUrl);

    if (!canOpen) {
      Alert.alert('Unable to open Google', 'This device could not open Google authorization.');
      return;
    }

    await Linking.openURL(data.authUrl);
  };

  const onDisconnectGoogleCalendar = () => {
    if (!business?.id || !connectionStatus?.connected) {
      return;
    }

    Alert.alert(
      'Disconnect Google Calendar?',
      'Confirmed bookings will stop syncing to Google Calendar.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            setIsDisconnecting(true);

            const { data, error } = await supabase.functions.invoke('disconnect-google-calendar', {
              body: {
                businessId: business.id,
              },
            });

            setIsDisconnecting(false);

            if (error || data?.error) {
              const message = await getEdgeFunctionErrorMessage({ error, data });
              Alert.alert('Disconnect failed', message);
              return;
            }

            setConnectionStatus(data?.status || null);
            Alert.alert('Disconnected', 'Google Calendar has been disconnected.');
          },
        },
      ]
    );
  };

  const statusLabel = getGoogleCalendarStatusLabel(connectionStatus);
  const syncCalendarLabel = getGoogleCalendarSyncLabel(connectionStatus);
  const isConnected = connectionStatus?.connected === true;

  return (
    <ScreenContainer style={{ paddingTop: 0 }}>
      <BackButton />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 32,
        }}
        refreshControl={
          <RefreshControl
            refreshing={isLoadingStatus}
            onRefresh={() => refreshStatus()}
            tintColor={COLORS.accent}
          />
        }
      >
        <Text
          style={{
            color: COLORS.textPrimary,
            fontSize: 30,
            fontWeight: '700',
            marginTop: 8,
          }}
        >
          Google Calendar
        </Text>
        <Text
          style={{
            color: COLORS.textSecondary,
            fontSize: 15,
            lineHeight: 22,
            marginTop: 8,
            marginBottom: 24,
          }}
        >
          Connect one Google Calendar per business. SALO will sync confirmed bookings only.
        </Text>

        {businessError ? (
          <Text style={{ color: '#F87171', marginBottom: 12 }}>{businessError}</Text>
        ) : null}

        {statusError ? (
          <Text style={{ color: '#F87171', marginBottom: 12 }}>{statusError}</Text>
        ) : null}

        <View
          style={{
            backgroundColor: '#15151C',
            borderRadius: 16,
            padding: 16,
            marginBottom: 20,
          }}
        >
          {isBusinessLoading || isLoadingStatus ? (
            <Text style={{ color: COLORS.textSecondary, fontSize: 14 }}>Loading...</Text>
          ) : isConnected ? (
            <>
              <Text
                style={{
                  color: '#34D399',
                  fontSize: 16,
                  fontWeight: '700',
                  marginBottom: 12,
                }}
              >
                🟢 Connected
              </Text>
              <InfoRow
                label="Google Account"
                value={connectionStatus?.googleAccountEmail || '—'}
              />
              <InfoRow label="Sync Calendar" value={syncCalendarLabel} />
              <InfoRow
                label="Connected At"
                value={formatGoogleCalendarTimestamp(connectionStatus?.connectedAt)}
              />
            </>
          ) : (
            <InfoRow label="Status" value={statusLabel} />
          )}

          {connectionStatus?.lastError ? (
            <InfoRow label="Last error" value={connectionStatus.lastError} />
          ) : null}
        </View>

        {isConnected ? (
          <Text
            style={{
              color: COLORS.textSecondary,
              fontSize: 13,
              lineHeight: 20,
              marginBottom: 20,
            }}
          >
            Sync is enabled for confirmed bookings. Pending public requests will not sync until
            confirmed.
          </Text>
        ) : null}

        {!isConnected ? (
          <PrimaryButton
            title={isConnecting ? 'Opening Google...' : 'Connect Google Calendar'}
            onPress={onConnectGoogleCalendar}
            disabled={isConnecting || isBusinessLoading || !business?.id}
          />
        ) : (
          <PrimaryButton
            title={isDisconnecting ? 'Disconnecting...' : 'Disconnect Google Calendar'}
            onPress={onDisconnectGoogleCalendar}
            disabled={isDisconnecting}
            style={{ backgroundColor: '#3A1F24' }}
          />
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
