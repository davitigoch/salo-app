import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

import { supabase } from '../constants/supabase';

function getExpoProjectId() {
  return (
    Constants?.expoConfig?.extra?.eas?.projectId
    || Constants?.easConfig?.projectId
    || null
  );
}

export async function registerForPushNotificationsAsync(userId) {
  console.log('PUSH registration started');
  console.log('PUSH user id', userId || null);

  if (!userId) {
    return { status: 'skipped', reason: 'missing_user_id' };
  }

  try {
    const existingPermissions = await Notifications.getPermissionsAsync();
    let permissionStatus = existingPermissions.status;
    console.log('PUSH existing permission', permissionStatus);
    let requestedPermissionStatus = 'not_requested';

    if (permissionStatus !== 'granted') {
      const requestedPermissions = await Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: true,
          allowSound: true,
        },
      });
      permissionStatus = requestedPermissions.status;
      requestedPermissionStatus = requestedPermissions.status;
    }

    console.log('PUSH requested permission', requestedPermissionStatus);

    if (permissionStatus !== 'granted') {
      return { status: 'denied' };
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const projectId = getExpoProjectId();
    if (!projectId) {
      console.log('PUSH missing EAS projectId');
      if (Constants?.appOwnership === 'expo') {
        console.log(
          'PUSH error Expo Go may not provide projectId automatically in this setup. Configure EXPO_PUBLIC_EAS_PROJECT_ID or use a development build with EAS projectId.'
        );
      }
      return { status: 'error', reason: 'missing_eas_project_id' };
    }

    let tokenResponse;

    try {
      tokenResponse = await Notifications.getExpoPushTokenAsync({ projectId });
    } catch (tokenError) {
      const tokenReason = tokenError instanceof Error ? tokenError.message : 'unknown_error';
      console.log('PUSH error', {
        stage: 'expo_token',
        reason: tokenReason,
      });

      if (Constants?.appOwnership === 'expo') {
        console.log(
          'PUSH error Expo Go token registration failed. If this persists, use a development build with EAS projectId configured.'
        );
      }

      return { status: 'error', reason: tokenReason };
    }

    const expoPushToken = tokenResponse?.data;
    console.log('PUSH expo token', expoPushToken || null);

    if (!expoPushToken || typeof expoPushToken !== 'string') {
      return { status: 'error', reason: 'missing_push_token' };
    }

    console.log('PUSH saving token', {
      userId,
      platform: Platform.OS,
    });

    const { error } = await supabase
      .from('user_push_tokens')
      .upsert(
        {
          user_id: userId,
          expo_push_token: expoPushToken,
          platform: Platform.OS,
          enabled: true,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'expo_push_token',
          ignoreDuplicates: false,
        }
      );

    if (error) {
      console.log('PUSH error', {
        stage: 'save_token',
        message: error.message,
      });
      return { status: 'error', reason: error.message };
    }

    console.log('PUSH saved', {
      userId,
      platform: Platform.OS,
    });

    return { status: 'saved', token: expoPushToken };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown_error';
    console.log('PUSH error', {
      stage: 'registration',
      reason,
    });
    return { status: 'error', reason };
  }
}

export async function registerUserPushToken(userId) {
  return registerForPushNotificationsAsync(userId);
}
