import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from '../constants/supabase';
import { requestNotificationPermissions } from './bookingReminders';

export const ownerPushTokenRef = { current: null };

export function getExpoProjectId() {
  return (
    Constants.expoConfig?.extra?.eas?.projectId
    || Constants.easConfig?.projectId
    || null
  );
}

function isPhysicalDevice() {
  if (Platform.OS === 'web') {
    return false;
  }

  return true;
}

export async function registerOwnerPushToken(userId) {
  if (!userId) {
    return { error: null, skipped: true };
  }

  if (!isPhysicalDevice()) {
    return { error: null, skipped: true, reason: 'simulator' };
  }

  const permissionStatus = await requestNotificationPermissions();
  if (permissionStatus !== 'granted') {
    return { error: null, skipped: true, reason: 'permission_denied' };
  }

  const projectId = getExpoProjectId();
  if (!projectId) {
    console.warn('[SALO] Missing Expo project ID; owner push token registration skipped.');
    return { error: null, skipped: true, reason: 'missing_project_id' };
  }

  const tokenResult = await Notifications.getExpoPushTokenAsync({ projectId });
  const expoPushToken = tokenResult?.data;

  if (!expoPushToken) {
    return { error: { message: 'Unable to generate Expo push token.' } };
  }

  const { error } = await supabase.from('owner_push_tokens').upsert(
    {
      user_id: userId,
      expo_push_token: expoPushToken,
      device_name: Platform.OS,
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: 'user_id,expo_push_token',
    }
  );

  if (error) {
    return { error };
  }

  ownerPushTokenRef.current = expoPushToken;

  return { error: null, token: expoPushToken };
}

export async function unregisterOwnerPushToken(userId, expoPushToken) {
  const tokenToRemove = expoPushToken || ownerPushTokenRef.current;

  if (!userId || !tokenToRemove) {
    return { error: null };
  }

  const { error } = await supabase
    .from('owner_push_tokens')
    .delete()
    .eq('user_id', userId)
    .eq('expo_push_token', tokenToRemove);

  if (!error) {
    ownerPushTokenRef.current = null;
  }

  return { error };
}

export async function flushOwnerPushQueue({ limit = 10 } = {}) {
  const { error } = await supabase.functions.invoke('send-owner-push', {
    body: { limit },
  });

  if (error) {
    console.warn('[SALO] Owner push flush failed', error.message);
  }

  return { error };
}
