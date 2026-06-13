import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Linking from 'expo-linking';

import { supabase } from './supabase';

const PRODUCTION_PASSWORD_RESET_REDIRECT = 'salo://reset-password';

function shouldUseExpoGoRedirectUrl() {
  if (Constants.appOwnership === 'expo') {
    return true;
  }

  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    return true;
  }

  return typeof __DEV__ !== 'undefined' && __DEV__;
}

export function getPasswordResetRedirectUrl() {
  const redirectUrl = shouldUseExpoGoRedirectUrl()
    ? Linking.createURL('reset-password', { scheme: 'exp' })
    : PRODUCTION_PASSWORD_RESET_REDIRECT;

  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log('[SALO] password reset redirect URL:', redirectUrl);
  }

  return redirectUrl;
}

export function parseAuthParamsFromUrl(url) {
  const params = {};

  if (!url) {
    return params;
  }

  const hashIndex = url.indexOf('#');
  const queryPart = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const hashPart = hashIndex >= 0 ? url.slice(hashIndex + 1) : '';
  const queryString = queryPart.includes('?') ? queryPart.split('?')[1] : '';
  const paramString = [queryString, hashPart].filter(Boolean).join('&');

  paramString.split('&').forEach((segment) => {
    if (!segment) {
      return;
    }

    const separatorIndex = segment.indexOf('=');
    const rawKey = separatorIndex >= 0 ? segment.slice(0, separatorIndex) : segment;
    const rawValue = separatorIndex >= 0 ? segment.slice(separatorIndex + 1) : '';
    const key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
    const value = decodeURIComponent(rawValue.replace(/\+/g, ' '));

    if (key) {
      params[key] = value;
    }
  });

  return params;
}

export function isPasswordResetPath(pathOrUrl) {
  if (!pathOrUrl) {
    return false;
  }

  if (parseAuthParamsFromUrl(pathOrUrl).type === 'recovery') {
    return true;
  }

  const path = pathOrUrl.split('#')[0].split('?')[0];

  return (
    path.includes('reset-password') ||
    /(?:^|\/)--\/reset-password(?:\/|$)/.test(path) ||
    /(?:^|\/)reset-password(?:\/|$)/.test(path)
  );
}

export function isPasswordResetUrl(url) {
  if (!url) {
    return false;
  }

  return isPasswordResetPath(url) || parseAuthParamsFromUrl(url).type === 'recovery';
}

export async function createSessionFromResetLink(url) {
  if (!isPasswordResetUrl(url)) {
    return { session: null, error: null, isRecovery: false };
  }

  const params = parseAuthParamsFromUrl(url);

  if (params.error || params.error_description) {
    return {
      session: null,
      error: {
        message:
          params.error_description ||
          params.error ||
          'This password reset link is invalid or has expired.',
      },
      isRecovery: true,
    };
  }

  const accessToken = params.access_token;
  const refreshToken = params.refresh_token;

  if (!accessToken) {
    return {
      session: null,
      error: {
        message: 'This password reset link is invalid or has expired.',
      },
      isRecovery: true,
    };
  }

  const { data, error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  if (error) {
    return {
      session: null,
      error,
      isRecovery: true,
    };
  }

  return {
    session: data.session,
    error: null,
    isRecovery:
      params.type === 'recovery' ||
      url.includes('type=recovery') ||
      isPasswordResetPath(url),
  };
}
