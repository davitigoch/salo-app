import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const BACKOFF_BASE_SECONDS = Number(Deno.env.get('PUSH_BACKOFF_BASE_SECONDS') || 120);
const BACKOFF_MAX_SECONDS = Number(Deno.env.get('PUSH_BACKOFF_MAX_SECONDS') || 3600);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const SUPPORTED_EVENT_TYPES = [
  'booking.created',
  'booking.rescheduled',
  'booking.cancelled',
  'booking.reminder_24h',
  'booking.reminder_2h',
];

type OutboxRow = {
  id: string;
  event_type: string;
  recipient: string | null;
  payload: Record<string, unknown> | null;
  notification_status: string;
  attempts: number | null;
  max_attempts: number | null;
};

function getNextAttemptAt(attempts: number) {
  const power = Math.max(0, attempts - 1);
  const delaySeconds = Math.min(BACKOFF_MAX_SECONDS, BACKOFF_BASE_SECONDS * 2 ** power);
  return new Date(Date.now() + delaySeconds * 1000).toISOString();
}

function getTitle(payload: Record<string, unknown>, eventType: string) {
  if (payload?.title) {
    return String(payload.title);
  }

  if (eventType === 'booking.created') return 'New booking received';
  if (eventType === 'booking.rescheduled') return 'Appointment rescheduled';
  if (eventType === 'booking.cancelled') return 'Appointment cancelled';
  if (eventType === 'booking.reminder_24h') return 'Appointment tomorrow';
  if (eventType === 'booking.reminder_2h') return 'Appointment in 2 hours';
  return 'SALO update';
}

function getBody(payload: Record<string, unknown>, eventType: string) {
  if (payload?.body) {
    return String(payload.body);
  }

  const service = String(payload?.service || 'Appointment');
  const date = String(payload?.date || 'your date');
  const time = String(payload?.time || 'your time');

  if (eventType === 'booking.created') return `${service} on ${date} at ${time}`;
  if (eventType === 'booking.rescheduled') return `${service} moved to ${date} at ${time}`;
  if (eventType === 'booking.cancelled') return `${service} on ${date} at ${time} was cancelled`;
  if (eventType === 'booking.reminder_24h') return `${service} is tomorrow at ${time}`;
  if (eventType === 'booking.reminder_2h') return `${service} starts at ${time}`;

  return `${service} update`;
}

async function claimRow(row: OutboxRow) {
  const nextAttempts = Number(row.attempts ?? 0) + 1;

  const { data, error } = await supabase
    .from('notification_outbox')
    .update({
      notification_status: 'processing',
      attempts: nextAttempts,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id)
    .eq('notification_channel', 'push')
    .eq('notification_status', 'pending')
    .select('id, attempts')
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return Number(data.attempts ?? nextAttempts);
}

async function sendExpoPush(recipient: string, title: string, body: string, payload: Record<string, unknown>) {
  const response = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      to: recipient,
      title,
      body,
      sound: 'default',
      data: {
        booking_id: payload.booking_id || null,
        event_type: payload.event_type || null,
        manage_appointment_url: payload.manage_appointment_url || null,
      },
    }),
  });

  const responseBody = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      String(responseBody?.errors?.[0]?.message || responseBody?.message || 'Expo push API request failed.')
    );
  }

  const result = responseBody?.data;
  if (Array.isArray(result)) {
    const item = result[0] || {};
    if (item.status === 'error') {
      throw new Error(String(item.message || item.details?.error || 'Expo push send failed.'));
    }

    return { messageId: item.id || null };
  }

  if (result?.status === 'error') {
    throw new Error(String(result.message || result.details?.error || 'Expo push send failed.'));
  }

  return { messageId: result?.id || null };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({
      error: 'Missing required environment configuration: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = await req.json().catch(() => ({}));
  const notificationId = body?.notificationId as string | undefined;
  const requestLimit = Number(body?.limit || 50);
  const limit = Number.isNaN(requestLimit) ? 50 : Math.max(1, Math.min(requestLimit, 100));
  const nowIso = new Date().toISOString();

  let query = supabase
    .from('notification_outbox')
    .select('id, event_type, recipient, payload, notification_status, attempts, max_attempts')
    .eq('notification_channel', 'push')
    .eq('notification_status', 'pending')
    .in('event_type', SUPPORTED_EVENT_TYPES)
    .lte('next_attempt_at', nowIso)
    .order('next_attempt_at', { ascending: true })
    .limit(limit);

  if (notificationId) {
    query = query.eq('id', notificationId);
  }

  const { data: rows, error: rowsError } = await query;

  if (rowsError) {
    return new Response(JSON.stringify({ error: rowsError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const processed: Array<Record<string, unknown>> = [];

  for (const row of (rows || []) as OutboxRow[]) {
    const attempts = await claimRow(row);
    if (!attempts) {
      continue;
    }

    try {
      const recipient = String(row.recipient || '').trim();
      if (!recipient) {
        throw new Error('Missing Expo push token recipient.');
      }

      const payload = row.payload || {};
      const title = getTitle(payload, row.event_type);
      const messageBody = getBody(payload, row.event_type);

      const sendResult = await sendExpoPush(recipient, title, messageBody, payload);

      const { error: updateError } = await supabase
        .from('notification_outbox')
        .update({
          notification_status: 'processed',
          sent_at: new Date().toISOString(),
          provider_message_id: sendResult.messageId,
          last_error: null,
          attempts,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);

      if (updateError) {
        throw new Error(updateError.message);
      }

      processed.push({
        id: row.id,
        status: 'processed',
        providerMessageId: sendResult.messageId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const maxAttempts = Number(row.max_attempts || 3);
      const exhausted = attempts >= maxAttempts;

      const failureUpdate = exhausted
        ? {
            notification_status: 'failed',
            attempts,
            last_error: message,
            updated_at: new Date().toISOString(),
          }
        : {
            notification_status: 'pending',
            attempts,
            next_attempt_at: getNextAttemptAt(attempts),
            last_error: message,
            updated_at: new Date().toISOString(),
          };

      await supabase
        .from('notification_outbox')
        .update(failureUpdate)
        .eq('id', row.id);

      processed.push({
        id: row.id,
        status: exhausted ? 'failed' : 'pending',
        attempts,
        error: message,
      });
    }
  }

  return new Response(JSON.stringify({ processed }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
