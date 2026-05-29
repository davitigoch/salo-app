import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Resend } from 'npm:resend@4.4.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || '';
const NOTIFICATION_EMAIL_FROM = Deno.env.get('NOTIFICATION_EMAIL_FROM') || 'SALO <notifications@salo.app>';
const MAX_ATTEMPTS = Number(Deno.env.get('NOTIFICATION_MAX_ATTEMPTS') || 3);
const BACKOFF_BASE_SECONDS = Number(Deno.env.get('NOTIFICATION_BACKOFF_BASE_SECONDS') || 120);
const BACKOFF_MAX_SECONDS = Number(Deno.env.get('NOTIFICATION_BACKOFF_MAX_SECONDS') || 3600);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const resend = new Resend(RESEND_API_KEY);

const SUPPORTED_EVENT_TYPES = [
  'booking.created',
  'booking.rescheduled',
  'booking.cancelled',
  'booking.reminder_24h',
];

type OutboxRow = {
  id: string;
  event_type: string;
  recipient: string | null;
  payload: Record<string, unknown> | null;
  notification_channel: string;
  notification_status: string;
  attempts: number | null;
  max_attempts: number | null;
  next_attempt_at: string | null;
};

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildSubject(eventType: string, service: string) {
  if (eventType === 'booking.created') {
    return `Booking received: ${service}`;
  }
  if (eventType === 'booking.rescheduled') {
    return `Appointment rescheduled: ${service}`;
  }
  if (eventType === 'booking.cancelled') {
    return `Appointment cancelled: ${service}`;
  }
  if (eventType === 'booking.reminder_24h') {
    return `Appointment reminder (24h): ${service}`;
  }

  return `Booking update: ${service}`;
}

function buildHtmlEmail(eventType: string, payload: Record<string, unknown>) {
  const businessName = escapeHtml(payload.business_name || 'SALO');
  const service = escapeHtml(payload.service || 'Appointment');
  const date = escapeHtml(payload.date || 'TBD');
  const time = escapeHtml(payload.time || 'TBD');
  const customerName = escapeHtml(payload.customer_name || 'Customer');
  const manageUrl = escapeHtml(payload.manage_appointment_url || 'https://salo.app');
  const bookNewUrl = escapeHtml(payload.book_new_appointment_url || payload.manage_appointment_url || 'https://salo.app');
  const previousDate = escapeHtml(payload.previous_date || payload.old_date || '');
  const previousTime = escapeHtml(payload.previous_time || payload.old_time || '');
  const cancellationReason = escapeHtml(
    payload.cancellation_reason || payload.cancel_reason || payload.booking_metadata_cancel_reason || ''
  );

  let title = 'Your booking is confirmed';
  let lead = `Hi ${customerName},`;
  let extraRows = '';
  let helperText = '';
  let primaryButtonLabel = 'Manage appointment';
  let primaryButtonUrl = manageUrl;
  let secondaryButtonLabel = '';
  let secondaryButtonUrl = '';

  if (eventType === 'booking.rescheduled') {
    title = 'Your appointment has been rescheduled';
    helperText = 'Your booking details were updated.';
    extraRows = `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #2b2b37;color:#a1a1aa;">Previous date</td>
        <td style="padding:10px 0;border-bottom:1px solid #2b2b37;color:#fafafa;text-align:right;">${previousDate || 'N/A'}</td>
      </tr>
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #2b2b37;color:#a1a1aa;">Previous time</td>
        <td style="padding:10px 0;border-bottom:1px solid #2b2b37;color:#fafafa;text-align:right;">${previousTime || 'N/A'}</td>
      </tr>`;
  } else if (eventType === 'booking.cancelled') {
    title = 'Your appointment has been cancelled';
    helperText = cancellationReason ? `Reason: ${cancellationReason}` : '';
    primaryButtonLabel = 'Book New Appointment';
    primaryButtonUrl = bookNewUrl;
    secondaryButtonLabel = 'Manage Appointment';
    secondaryButtonUrl = manageUrl;
  } else if (eventType === 'booking.reminder_24h') {
    title = 'Reminder: your appointment is in 24 hours';
    helperText = 'This is a friendly reminder for your upcoming visit.';
  }

  const secondaryButtonHtml = secondaryButtonLabel
    ? `<a href="${secondaryButtonUrl}" style="display:inline-block;background:#1f2937;color:#e5e7eb;text-decoration:none;font-weight:700;padding:12px 16px;border-radius:10px;margin-left:8px;">${secondaryButtonLabel}</a>`
    : '';

  const helperTextHtml = helperText
    ? `<p style="margin:0 0 16px 0;color:#a1a1aa;">${helperText}</p>`
    : '';

  return `
  <div style="margin:0;padding:24px;background:#0b0f1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#f4f4f5;">
    <div style="max-width:640px;margin:0 auto;background:#141a2a;border:1px solid #25314d;border-radius:16px;overflow:hidden;">
      <div style="padding:22px 24px 12px 24px;border-bottom:1px solid #25314d;">
        <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#93c5fd;">SALO • ${businessName}</div>
        <h1 style="margin:8px 0 0 0;font-size:24px;line-height:1.25;color:#fafafa;">${title}</h1>
      </div>
      <div style="padding:20px 24px 24px 24px;">
        <p style="margin:0 0 12px 0;color:#d4d4d8;">${lead}</p>
        ${helperTextHtml}
        <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-bottom:18px;">
          <tr>
            <td style="padding:10px 0;border-bottom:1px solid #25314d;color:#93a3b8;">Service</td>
            <td style="padding:10px 0;border-bottom:1px solid #25314d;color:#fafafa;text-align:right;">${service}</td>
          </tr>
          <tr>
            <td style="padding:10px 0;border-bottom:1px solid #25314d;color:#93a3b8;">Date</td>
            <td style="padding:10px 0;border-bottom:1px solid #25314d;color:#fafafa;text-align:right;">${date}</td>
          </tr>
          <tr>
            <td style="padding:10px 0;border-bottom:1px solid #25314d;color:#93a3b8;">Time</td>
            <td style="padding:10px 0;border-bottom:1px solid #25314d;color:#fafafa;text-align:right;">${time}</td>
          </tr>
          <tr>
            <td style="padding:10px 0;border-bottom:1px solid #25314d;color:#93a3b8;">Customer</td>
            <td style="padding:10px 0;border-bottom:1px solid #25314d;color:#fafafa;text-align:right;">${customerName}</td>
          </tr>
          ${extraRows}
        </table>
        <a href="${primaryButtonUrl}" style="display:inline-block;background:#22c55e;color:#052e16;text-decoration:none;font-weight:700;padding:12px 16px;border-radius:10px;">${primaryButtonLabel}</a>
        ${secondaryButtonHtml}
      </div>
    </div>
  </div>`;
}

function getNextAttemptAt(attempts: number) {
  const power = Math.max(0, attempts - 1);
  const delaySeconds = Math.min(BACKOFF_MAX_SECONDS, BACKOFF_BASE_SECONDS * 2 ** power);
  return new Date(Date.now() + delaySeconds * 1000).toISOString();
}

async function claimRow(row: OutboxRow) {
  const nextAttempts = Number(row.attempts ?? 0) + 1;

  const { data, error } = await supabase
    .from('notification_outbox')
    .update({
      notification_status: 'processing',
      attempts: nextAttempts,
      updated_at: new Date().toISOString(),
      last_error: null,
    })
    .eq('id', row.id)
    .eq('notification_channel', 'email')
    .eq('notification_status', 'pending')
    .select('id, attempts')
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return {
    attempts: Number(data.attempts ?? nextAttempts),
  };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const missingEnv: string[] = [];
  if (!SUPABASE_URL) missingEnv.push('SUPABASE_URL');
  if (!SUPABASE_SERVICE_ROLE_KEY) missingEnv.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!RESEND_API_KEY) missingEnv.push('RESEND_API_KEY');

  if (missingEnv.length) {
    return new Response(JSON.stringify({ error: `Missing required environment configuration: ${missingEnv.join(', ')}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = await req.json().catch(() => ({}));
  const notificationId = body?.notificationId as number | undefined;
  const requestLimit = Number(body?.limit || 25);
  const limit = Number.isNaN(requestLimit) ? 25 : Math.max(1, Math.min(requestLimit, 100));
  const nowIso = new Date().toISOString();

  let query = supabase
    .from('notification_outbox')
    .select('id, event_type, recipient, payload, notification_channel, notification_status, attempts, max_attempts, next_attempt_at')
    .eq('notification_channel', 'email')
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
    const claimed = await claimRow(row);
    if (!claimed) {
      continue;
    }

    const attempts = claimed.attempts;

    try {
      const payload = row.payload || {};
      const recipient = String(row.recipient || payload.customer_email || '').trim();
      if (!recipient) {
        throw new Error('Missing customer_email in notification payload.');
      }

      const service = String(payload.service || 'Appointment');
      const subject = buildSubject(row.event_type, service);
      const html = buildHtmlEmail(row.event_type, payload);

      const { data: resendData, error: resendError } = await resend.emails.send({
        from: NOTIFICATION_EMAIL_FROM,
        to: [recipient],
        subject,
        html,
      });

      if (resendError) {
        throw new Error(resendError.message || 'Resend API error');
      }

      const providerMessageId = (resendData as { id?: string } | null)?.id || null;

      const { error: updateError } = await supabase
        .from('notification_outbox')
        .update({
          notification_status: 'processed',
          sent_at: new Date().toISOString(),
          provider_message_id: providerMessageId,
          last_error: null,
          updated_at: new Date().toISOString(),
          attempts,
        })
        .eq('id', row.id);

      if (updateError) {
        throw new Error(updateError.message);
      }

      processed.push({
        id: row.id,
        status: 'processed',
        providerMessageId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const maxAttempts = Number(row.max_attempts ?? MAX_ATTEMPTS);
      const exhausted = attempts >= maxAttempts;

      const failureUpdate = exhausted
        ? {
            notification_status: 'failed',
            last_error: message,
            updated_at: new Date().toISOString(),
            attempts,
          }
        : {
            notification_status: 'pending',
            last_error: message,
            next_attempt_at: getNextAttemptAt(attempts),
            updated_at: new Date().toISOString(),
            attempts,
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
