import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID') || '';
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN') || '';
const TWILIO_FROM_NUMBER = Deno.env.get('TWILIO_FROM_NUMBER') || '';
const BACKOFF_BASE_SECONDS = Number(Deno.env.get('SMS_BACKOFF_BASE_SECONDS') || 60);
const BACKOFF_MAX_SECONDS = Number(Deno.env.get('SMS_BACKOFF_MAX_SECONDS') || 3600);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function buildBookingMessage(eventType: string, booking: any) {
  const serviceName = booking?.service || 'Appointment';
  const bookingDate = booking?.date || 'your date';
  const bookingTime = booking?.time || 'your time';

  switch (eventType) {
    case 'booking_created':
      return `SALO: We received your ${serviceName} booking request for ${bookingDate} at ${bookingTime}.`;
    case 'booking_confirmed':
      return `SALO: Your ${serviceName} booking is confirmed for ${bookingDate} at ${bookingTime}.`;
    case 'booking_cancelled':
      return `SALO: Your ${serviceName} booking for ${bookingDate} at ${bookingTime} was cancelled.`;
    case 'booking_rescheduled':
      return `SALO: Your ${serviceName} booking was rescheduled to ${bookingDate} at ${bookingTime}.`;
    case 'booking_completed':
      return `SALO: Thank you for visiting. Your ${serviceName} booking is marked completed.`;
    default:
      return `SALO: Update for your booking (${serviceName}) on ${bookingDate} at ${bookingTime}.`;
  }
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
    sid: result.sid as string,
  };
}

function getNextAttemptAt(retryCount: number) {
  const power = Math.max(0, retryCount - 1);
  const delaySeconds = Math.min(BACKOFF_MAX_SECONDS, BACKOFF_BASE_SECONDS * 2 ** power);
  const next = new Date(Date.now() + delaySeconds * 1000);
  return next.toISOString();
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
    .from('sms_notifications')
    .select('id, event_type, customer_phone, status, retry_count, max_retries, next_attempt_at, booking_id')
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

  for (const notification of notifications || []) {
    try {
      const { data: booking, error: bookingError } = await supabase
        .from('bookings')
        .select('id, service, date, time')
        .eq('id', notification.booking_id)
        .single();

      if (bookingError) {
        throw new Error(bookingError.message);
      }

      const messageBody = buildBookingMessage(notification.event_type, booking);
      const twilioResult = await sendViaTwilio(notification.customer_phone, messageBody);

      const { error: updateError } = await supabase
        .from('sms_notifications')
        .update({
          status: 'sent',
          message_body: messageBody,
          twilio_message_sid: twilioResult.sid,
          sent_at: new Date().toISOString(),
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', notification.id);

      if (updateError) {
        throw new Error(updateError.message);
      }

      processed.push({ id: notification.id, status: 'sent', sid: twilioResult.sid });
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
        .from('sms_notifications')
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
