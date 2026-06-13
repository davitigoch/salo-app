import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const BACKOFF_BASE_SECONDS = Number(Deno.env.get('PUSH_BACKOFF_BASE_SECONDS') || 60);
const BACKOFF_MAX_SECONDS = Number(Deno.env.get('PUSH_BACKOFF_MAX_SECONDS') || 3600);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type PushNotificationRow = {
  id: string;
  user_id: string;
  business_id: string | null;
  title: string;
  body: string;
  push_data: Record<string, unknown> | null;
  retry_count: number | null;
  max_retries: number | null;
};

type PushTokenRow = {
  expo_push_token: string;
};

function getNextAttemptAt(retryCount: number) {
  const power = Math.max(0, retryCount - 1);
  const delaySeconds = Math.min(BACKOFF_MAX_SECONDS, BACKOFF_BASE_SECONDS * 2 ** power);
  return new Date(Date.now() + delaySeconds * 1000).toISOString();
}

async function sendExpoPushMessages(
  tokens: string[],
  title: string,
  body: string,
  data: Record<string, unknown>,
  soundEnabled: boolean
) {
  if (!tokens.length) {
    throw new Error('No owner push tokens registered.');
  }

  const messages = tokens.map((token) => {
    const message: Record<string, unknown> = {
      to: token,
      title,
      body,
      data,
    };

    if (soundEnabled) {
      message.sound = 'default';
    }

    return message;
  });

  const response = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Accept-encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(messages),
  });

  const result = await response.json();

  if (!response.ok) {
    const detail =
      (result as { errors?: Array<{ message?: string }> })?.errors?.[0]?.message
      || 'Expo push request failed';
    throw new Error(detail);
  }

  const pushResults = (result as { data?: Array<{ status?: string; message?: string }> })?.data || [];
  const failed = pushResults.find((item) => item.status === 'error');

  if (failed) {
    throw new Error(failed.message || 'Expo push delivery failed');
  }

  return pushResults.length;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = await req.json().catch(() => ({}));
  const notificationId = body?.notificationId as string | undefined;
  const limit = Number(body?.limit || 20);
  const nowIso = new Date().toISOString();

  let query = supabase
    .from('owner_push_notifications')
    .select('id, user_id, business_id, title, body, push_data, retry_count, max_retries')
    .eq('status', 'pending')
    .lte('next_attempt_at', nowIso)
    .order('next_attempt_at', { ascending: true })
    .limit(Number.isNaN(limit) ? 20 : Math.max(1, Math.min(limit, 100)));

  if (notificationId) {
    query = query.eq('id', notificationId);
  }

  const { data: notifications, error: notificationsError } = await query;

  if (notificationsError) {
    return new Response(JSON.stringify({ error: notificationsError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const processed: Array<Record<string, unknown>> = [];

  for (const notification of (notifications || []) as PushNotificationRow[]) {
    try {
      const { data: tokens, error: tokensError } = await supabase
        .from('owner_push_tokens')
        .select('expo_push_token')
        .eq('user_id', notification.user_id);

      if (tokensError) {
        throw new Error(tokensError.message);
      }

      const expoTokens = ((tokens || []) as PushTokenRow[])
        .map((row) => row.expo_push_token)
        .filter(Boolean);

      let soundEnabled = true;

      if (notification.business_id) {
        const { data: preferences } = await supabase
          .from('notification_preferences')
          .select('owner_push_sound_enabled')
          .eq('business_id', notification.business_id)
          .maybeSingle();

        soundEnabled = preferences?.owner_push_sound_enabled !== false;
      }

      const pushData = {
        ...(notification.push_data || {}),
        type: 'owner-booking-event',
      };

      await sendExpoPushMessages(
        expoTokens,
        notification.title,
        notification.body,
        pushData,
        soundEnabled
      );

      const { error: updateError } = await supabase
        .from('owner_push_notifications')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', notification.id);

      if (updateError) {
        throw new Error(updateError.message);
      }

      processed.push({ id: notification.id, status: 'sent', tokenCount: expoTokens.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const currentRetryCount = Number(notification.retry_count || 0);
      const maxRetries = Math.max(1, Number(notification.max_retries || 5));
      const nextRetryCount = currentRetryCount + 1;
      const exhaustedRetries = nextRetryCount >= maxRetries;

      const failureUpdate = exhaustedRetries
        ? {
            status: 'failed',
            retry_count: nextRetryCount,
            last_error: message,
            updated_at: new Date().toISOString(),
          }
        : {
            status: 'pending',
            retry_count: nextRetryCount,
            last_error: message,
            next_attempt_at: getNextAttemptAt(nextRetryCount),
            updated_at: new Date().toISOString(),
          };

      await supabase
        .from('owner_push_notifications')
        .update(failureUpdate)
        .eq('id', notification.id);

      processed.push({
        id: notification.id,
        status: exhaustedRetries ? 'failed' : 'pending',
        retryCount: nextRetryCount,
        error: message,
      });
    }
  }

  return new Response(JSON.stringify({ processed }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
