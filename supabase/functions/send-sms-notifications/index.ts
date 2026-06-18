import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { buildSmsMessage } from '../_shared/smsMessages.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const SMS_PROVIDER = (Deno.env.get('SMS_PROVIDER') || 'mock').toLowerCase();
const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID') || '';
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN') || '';
const TWILIO_FROM_NUMBER = Deno.env.get('TWILIO_FROM_NUMBER') || '';
const BACKOFF_BASE_SECONDS = Number(Deno.env.get('SMS_BACKOFF_BASE_SECONDS') || 60);
const BACKOFF_MAX_SECONDS = Number(Deno.env.get('SMS_BACKOFF_MAX_SECONDS') || 3600);

const jsonHeaders = { 'Content-Type': 'application/json' };

type SmsNotificationRow = {
  id: string;
  booking_id: string;
  phone_number: string;
  notification_type: string;
  message_body: string | null;
  status: string;
  retry_count: number;
  max_retries: number;
};

function getNextScheduledFor(retryCount: number): string {
  const power = Math.max(0, retryCount - 1);
  const delaySeconds = Math.min(BACKOFF_MAX_SECONDS, BACKOFF_BASE_SECONDS * 2 ** power);
  return new Date(Date.now() + delaySeconds * 1000).toISOString();
}

async function sendViaTwilio(to: string, body: string) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
    throw new Error('Twilio environment variables are not configured.');
  }

  const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
  const formData = new URLSearchParams({
    To: to,
    From: TWILIO_FROM_NUMBER,
    Body: body,
  });

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData,
    }
  );

  const result = await response.json();

  if (!response.ok) {
    const detail = result?.message || 'Twilio request failed';
    throw new Error(detail);
  }

  return {
    provider: 'twilio' as const,
    providerMessageId: result.sid as string,
  };
}

async function sendViaMock() {
  return {
    provider: 'mock' as const,
    providerMessageId: `mock_${crypto.randomUUID()}`,
  };
}

async function deliverSms(to: string, body: string) {
  if (SMS_PROVIDER === 'twilio') {
    return sendViaTwilio(to, body);
  }

  return sendViaMock();
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: jsonHeaders,
    });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: 'Missing required environment configuration.' }), {
      status: 500,
      headers: jsonHeaders,
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const body = await req.json().catch(() => ({}));
  const notificationId = body?.notificationId as string | undefined;
  const limit = Number(body?.limit || 20);
  const nowIso = new Date().toISOString();

  let notifications: SmsNotificationRow[] = [];

  if (notificationId) {
    const { data, error } = await supabase
      .from('sms_notifications')
      .select(
        'id, booking_id, phone_number, notification_type, message_body, status, retry_count, max_retries'
      )
      .eq('id', notificationId)
      .eq('status', 'queued')
      .lte('scheduled_for', nowIso)
      .maybeSingle();

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: jsonHeaders,
      });
    }

    if (data) {
      notifications = [data as SmsNotificationRow];
    }
  } else {
    const { data, error } = await supabase.rpc('claim_sms_notifications', {
      p_limit: Number.isNaN(limit) ? 20 : Math.max(1, Math.min(limit, 100)),
    });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: jsonHeaders,
      });
    }

    notifications = (data || []) as SmsNotificationRow[];
  }

  const processed: Array<Record<string, unknown>> = [];

  for (const notification of notifications) {
    try {
      const { data: booking, error: bookingError } = await supabase
        .from('bookings')
        .select('id, service, date, time, client_name, status')
        .eq('id', notification.booking_id)
        .single();

      if (bookingError) {
        throw new Error(bookingError.message);
      }

      if (booking?.status === 'cancelled' && notification.notification_type.startsWith('reminder_')) {
        await supabase
          .from('sms_notifications')
          .update({
            status: 'skipped',
            last_error: 'Booking cancelled before reminder send.',
            updated_at: nowIso,
          })
          .eq('id', notification.id);

        processed.push({ id: notification.id, status: 'skipped' });
        continue;
      }

      const messageBody =
        notification.message_body ||
        buildSmsMessage(notification.notification_type, booking);

      const delivery = await deliverSms(notification.phone_number, messageBody);

      const { error: updateError } = await supabase
        .from('sms_notifications')
        .update({
          status: 'sent',
          provider: delivery.provider,
          provider_message_id: delivery.providerMessageId,
          message_body: messageBody,
          sent_at: nowIso,
          last_error: null,
          updated_at: nowIso,
        })
        .eq('id', notification.id);

      if (updateError) {
        throw new Error(updateError.message);
      }

      processed.push({
        id: notification.id,
        status: 'sent',
        provider: delivery.provider,
        providerMessageId: delivery.providerMessageId,
      });
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
            updated_at: nowIso,
          }
        : {
            status: 'queued',
            retry_count: nextRetryCount,
            last_error: message,
            scheduled_for: getNextScheduledFor(nextRetryCount),
            updated_at: nowIso,
          };

      await supabase.from('sms_notifications').update(failureUpdate).eq('id', notification.id);

      processed.push({
        id: notification.id,
        status: exhaustedRetries ? 'failed' : 'queued',
        retryCount: nextRetryCount,
        error: message,
      });
    }
  }

  return new Response(
    JSON.stringify({
      provider: SMS_PROVIDER,
      claimed: notifications.length,
      processed,
    }),
    {
      status: 200,
      headers: jsonHeaders,
    }
  );
});
