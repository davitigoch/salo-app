import { supabase } from '../constants/supabase';

const DEFAULT_PREFERENCES = {
  enable_owner_push: true,
  owner_push_sound_enabled: true,
  send_public_request_push: true,
  send_booking_cancelled_push: true,
  send_booking_rescheduled_push: true,
};

function isMissingPreferencesTable(error) {
  if (!error) {
    return false;
  }

  const message = String(error.message || '').toLowerCase();

  return (
    error.code === '42P01'
    || message.includes('notification_preferences')
    || message.includes('does not exist')
  );
}

export async function fetchNotificationPreferences(businessId) {
  if (!businessId) {
    return { data: DEFAULT_PREFERENCES, error: null, unavailable: false };
  }

  const { data, error } = await supabase
    .from('notification_preferences')
    .select(
      'enable_owner_push, owner_push_sound_enabled, send_public_request_push, send_booking_cancelled_push, send_booking_rescheduled_push'
    )
    .eq('business_id', businessId)
    .maybeSingle();

  if (error) {
    if (isMissingPreferencesTable(error)) {
      return { data: DEFAULT_PREFERENCES, error: null, unavailable: true };
    }

    return { data: DEFAULT_PREFERENCES, error: null, unavailable: true };
  }

  return {
    data: {
      ...DEFAULT_PREFERENCES,
      ...(data || {}),
    },
    error: null,
    unavailable: false,
  };
}

export async function updateOwnerPushSoundEnabled(businessId, enabled) {
  if (!businessId) {
    return { error: null, persisted: false };
  }

  const { data: existing, error: readError } = await supabase
    .from('notification_preferences')
    .select('id')
    .eq('business_id', businessId)
    .maybeSingle();

  if (readError) {
    if (isMissingPreferencesTable(readError)) {
      return { error: null, persisted: false };
    }

    return { error: readError, persisted: false };
  }

  if (existing) {
    const { error } = await supabase
      .from('notification_preferences')
      .update({ owner_push_sound_enabled: enabled })
      .eq('business_id', businessId);

    if (error && isMissingPreferencesTable(error)) {
      return { error: null, persisted: false };
    }

    return { error, persisted: !error };
  }

  const { error } = await supabase.from('notification_preferences').insert({
    business_id: businessId,
    owner_push_sound_enabled: enabled,
  });

  if (error && isMissingPreferencesTable(error)) {
    return { error: null, persisted: false };
  }

  return { error, persisted: !error };
}

export function isOwnerPushSoundEnabled(preferences) {
  return preferences?.owner_push_sound_enabled !== false;
}
