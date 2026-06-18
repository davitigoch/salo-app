import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { decryptRefreshToken, refreshGoogleAccessToken } from '../_shared/googleCalendarOAuth.ts';
import {
  buildGoogleCalendarEventPayload,
  deleteGoogleCalendarEvent,
  getBookingDurationMinutes,
  insertGoogleCalendarEvent,
  isGoogleCalendarNotFoundError,
  patchGoogleCalendarEvent,
} from '../_shared/googleCalendarSync.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const BACKOFF_BASE_SECONDS = Number(Deno.env.get('CALENDAR_SYNC_BACKOFF_BASE_SECONDS') || 60);
const BACKOFF_MAX_SECONDS = Number(Deno.env.get('CALENDAR_SYNC_BACKOFF_MAX_SECONDS') || 3600);
const DEFAULT_TIMEZONE = 'UTC';

const jsonHeaders = { 'Content-Type': 'application/json' };

type SyncJob = {
  id: string;
  business_id: string;
  booking_id: string | null;
  operation: 'create' | 'update' | 'delete';
  event_type: string;
  retry_count: number;
  max_retries: number;
  metadata: Record<string, unknown> | null;
};

type ActiveConnection = {
  business_id: string;
  calendar_id: string;
  refresh_token_encrypted: string;
};

type BookingRow = {
  id: string;
  business_id: string | null;
  status: string;
  service: string;
  client_name: string;
  date: string;
  time: string;
  booking_metadata: Record<string, unknown> | null;
  google_calendar_event_id: string | null;
};

function getNextAttemptAt(retryCount: number): string {
  const power = Math.max(0, retryCount - 1);
  const delaySeconds = Math.min(BACKOFF_MAX_SECONDS, BACKOFF_BASE_SECONDS * 2 ** power);
  return new Date(Date.now() + delaySeconds * 1000).toISOString();
}

function asMetadataString(metadata: Record<string, unknown> | null | undefined, key: string): string {
  const value = metadata?.[key];
  return value == null ? '' : String(value).trim();
}

function isActiveConnection(connection: {
  sync_enabled?: boolean | null;
  disconnected_at?: string | null;
  refresh_token_encrypted?: string | null;
  calendar_id?: string | null;
} | null): connection is ActiveConnection {
  return Boolean(
    connection &&
      connection.sync_enabled !== false &&
      connection.disconnected_at == null &&
      String(connection.refresh_token_encrypted || '').trim() &&
      String(connection.calendar_id || '').trim()
  );
}

async function markJobSucceeded(
  supabase: ReturnType<typeof createClient>,
  jobId: string,
  nowIso: string
) {
  const { error } = await supabase
    .from('calendar_sync_jobs')
    .update({
      status: 'succeeded',
      processed_at: nowIso,
      last_error: null,
      updated_at: nowIso,
    })
    .eq('id', jobId);

  if (error) {
    throw new Error(error.message);
  }
}

async function markJobFailure(
  supabase: ReturnType<typeof createClient>,
  job: SyncJob,
  message: string,
  nowIso: string
) {
  const currentRetryCount = Number(job.retry_count || 0);
  const maxRetries = Math.max(1, Number(job.max_retries || 5));
  const nextRetryCount = currentRetryCount + 1;
  const exhaustedRetries = nextRetryCount >= maxRetries;

  const { error } = await supabase
    .from('calendar_sync_jobs')
    .update(
      exhaustedRetries
        ? {
            status: 'failed',
            retry_count: nextRetryCount,
            last_error: message,
            processed_at: nowIso,
            updated_at: nowIso,
          }
        : {
            status: 'pending',
            retry_count: nextRetryCount,
            last_error: message,
            next_attempt_at: getNextAttemptAt(nextRetryCount),
            updated_at: nowIso,
          }
    )
    .eq('id', job.id);

  if (error) {
    throw new Error(error.message);
  }

  return {
    exhaustedRetries,
    nextRetryCount,
  };
}

async function updateBookingSyncState(
  supabase: ReturnType<typeof createClient>,
  bookingId: string | null,
  {
    eventId,
    syncedAt,
    lastError,
  }: {
    eventId?: string | null;
    syncedAt?: string | null;
    lastError?: string | null;
  }
) {
  if (!bookingId) {
    return;
  }

  const updatePayload: Record<string, string | null> = {};

  if (eventId !== undefined) {
    updatePayload.google_calendar_event_id = eventId;
  }

  if (syncedAt !== undefined) {
    updatePayload.google_calendar_synced_at = syncedAt;
  }

  if (lastError !== undefined) {
    updatePayload.google_calendar_last_error = lastError;
  }

  const { error } = await supabase.from('bookings').update(updatePayload).eq('id', bookingId);

  if (error) {
    throw new Error(error.message);
  }
}

async function updateConnectionSyncState(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
  {
    lastSyncedAt,
    lastError,
  }: {
    lastSyncedAt?: string | null;
    lastError?: string | null;
  }
) {
  const updatePayload: Record<string, string | null> = {
    updated_at: new Date().toISOString(),
  };

  if (lastSyncedAt !== undefined) {
    updatePayload.last_synced_at = lastSyncedAt;
  }

  if (lastError !== undefined) {
    updatePayload.last_error = lastError;
  }

  const { error } = await supabase
    .from('google_calendar_connections')
    .update(updatePayload)
    .eq('business_id', businessId);

  if (error) {
    throw new Error(error.message);
  }
}

async function getAccessTokenForBusiness(
  supabase: ReturnType<typeof createClient>,
  cache: Map<string, Promise<string>>,
  businessId: string
): Promise<string> {
  const existing = cache.get(businessId);
  if (existing) {
    return existing;
  }

  const tokenPromise = (async () => {
    const { data: connection, error } = await supabase
      .from('google_calendar_connections')
      .select('business_id, calendar_id, refresh_token_encrypted, sync_enabled, disconnected_at')
      .eq('business_id', businessId)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (!isActiveConnection(connection)) {
      throw new Error('No active Google Calendar connection.');
    }

    const refreshToken = await decryptRefreshToken(connection.refresh_token_encrypted);
    const tokenResponse = await refreshGoogleAccessToken(refreshToken);
    return tokenResponse.access_token as string;
  })();

  cache.set(businessId, tokenPromise);
  return tokenPromise;
}

async function loadBooking(
  supabase: ReturnType<typeof createClient>,
  bookingId: string | null
): Promise<BookingRow | null> {
  if (!bookingId) {
    return null;
  }

  const { data, error } = await supabase
    .from('bookings')
    .select(
      'id, business_id, status, service, client_name, date, time, booking_metadata, google_calendar_event_id'
    )
    .eq('id', bookingId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

async function loadBusinessTimezone(
  supabase: ReturnType<typeof createClient>,
  businessId: string
): Promise<string> {
  const { data, error } = await supabase
    .from('businesses')
    .select('timezone')
    .eq('id', businessId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return String(data?.timezone || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;
}

function buildEventInputFromSources({
  booking,
  metadata,
  timeZone,
}: {
  booking: BookingRow | null;
  metadata: Record<string, unknown> | null;
  timeZone: string;
}) {
  return {
    service: booking?.service || asMetadataString(metadata, 'service') || 'Appointment',
    clientName: booking?.client_name || asMetadataString(metadata, 'client_name') || 'Client',
    date: booking?.date || asMetadataString(metadata, 'date'),
    time: booking?.time || asMetadataString(metadata, 'time'),
    durationMinutes: getBookingDurationMinutes(booking, 60),
    timeZone,
  };
}

async function processSyncJob(
  supabase: ReturnType<typeof createClient>,
  job: SyncJob,
  accessTokenCache: Map<string, Promise<string>>
) {
  const nowIso = new Date().toISOString();
  const metadata = (job.metadata || {}) as Record<string, unknown>;

  const { data: connection, error: connectionError } = await supabase
    .from('google_calendar_connections')
    .select('business_id, calendar_id, refresh_token_encrypted, sync_enabled, disconnected_at')
    .eq('business_id', job.business_id)
    .maybeSingle();

  if (connectionError) {
    throw new Error(connectionError.message);
  }

  if (!isActiveConnection(connection)) {
    await markJobSucceeded(supabase, job.id, nowIso);
    return {
      id: job.id,
      status: 'succeeded',
      skipped: true,
      reason: 'No active Google Calendar connection.',
    };
  }

  const booking = await loadBooking(supabase, job.booking_id);
  let eventId =
    asMetadataString(metadata, 'google_calendar_event_id') ||
    String(booking?.google_calendar_event_id || '').trim();

  if ((job.operation === 'create' || job.operation === 'update') && booking?.status !== 'confirmed') {
    await markJobSucceeded(supabase, job.id, nowIso);
    return {
      id: job.id,
      status: 'succeeded',
      skipped: true,
      reason: 'Booking is not confirmed.',
    };
  }

  const accessToken = await getAccessTokenForBusiness(supabase, accessTokenCache, job.business_id);
  const timeZone = await loadBusinessTimezone(supabase, job.business_id);
  const calendarId = connection.calendar_id;

  if (job.operation === 'delete') {
    if (!eventId) {
      await updateBookingSyncState(supabase, job.booking_id, {
        syncedAt: nowIso,
        lastError: null,
      });
      await updateConnectionSyncState(supabase, job.business_id, {
        lastSyncedAt: nowIso,
        lastError: null,
      });
      await markJobSucceeded(supabase, job.id, nowIso);
      return {
        id: job.id,
        status: 'succeeded',
        operation: job.operation,
        skipped: true,
        reason: 'No Google event id to delete.',
      };
    }

    try {
      await deleteGoogleCalendarEvent({
        accessToken,
        calendarId,
        eventId,
      });
    } catch (error) {
      const status = (error as { status?: number })?.status;
      const responseBody = (error as { responseBody?: unknown })?.responseBody;

      if (!isGoogleCalendarNotFoundError(status || 0, responseBody)) {
        throw error;
      }
    }

    await updateBookingSyncState(supabase, job.booking_id, {
      eventId: null,
      syncedAt: nowIso,
      lastError: null,
    });
    await updateConnectionSyncState(supabase, job.business_id, {
      lastSyncedAt: nowIso,
      lastError: null,
    });
    await markJobSucceeded(supabase, job.id, nowIso);

    return {
      id: job.id,
      status: 'succeeded',
      operation: job.operation,
      eventId,
    };
  }

  const eventInput = buildEventInputFromSources({
    booking,
    metadata,
    timeZone,
  });

  if (!eventInput.date || !eventInput.time) {
    throw new Error('Booking date and time are required for Google Calendar sync.');
  }

  const eventPayload = buildGoogleCalendarEventPayload(eventInput);

  if (job.operation === 'create') {
    if (eventId) {
      try {
        await patchGoogleCalendarEvent({
          accessToken,
          calendarId,
          eventId,
          event: eventPayload,
        });
      } catch (error) {
        const status = (error as { status?: number })?.status;
        const responseBody = (error as { responseBody?: unknown })?.responseBody;

        if (isGoogleCalendarNotFoundError(status || 0, responseBody)) {
          eventId = await insertGoogleCalendarEvent({
            accessToken,
            calendarId,
            event: eventPayload,
          });
        } else {
          throw error;
        }
      }
    } else {
      eventId = await insertGoogleCalendarEvent({
        accessToken,
        calendarId,
        event: eventPayload,
      });
    }
  } else if (job.operation === 'update') {
    if (!eventId) {
      eventId = await insertGoogleCalendarEvent({
        accessToken,
        calendarId,
        event: eventPayload,
      });
    } else {
      try {
        await patchGoogleCalendarEvent({
          accessToken,
          calendarId,
          eventId,
          event: eventPayload,
        });
      } catch (error) {
        const status = (error as { status?: number })?.status;
        const responseBody = (error as { responseBody?: unknown })?.responseBody;

        if (isGoogleCalendarNotFoundError(status || 0, responseBody)) {
          eventId = await insertGoogleCalendarEvent({
            accessToken,
            calendarId,
            event: eventPayload,
          });
        } else {
          throw error;
        }
      }
    }
  }

  await updateBookingSyncState(supabase, job.booking_id, {
    eventId,
    syncedAt: nowIso,
    lastError: null,
  });
  await updateConnectionSyncState(supabase, job.business_id, {
    lastSyncedAt: nowIso,
    lastError: null,
  });
  await markJobSucceeded(supabase, job.id, nowIso);

  return {
    id: job.id,
    status: 'succeeded',
    operation: job.operation,
    eventId,
  };
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
  const limit = Number(body?.limit || 20);
  const nowIso = new Date().toISOString();

  const { data: jobs, error: claimError } = await supabase.rpc('claim_calendar_sync_jobs', {
    p_limit: Number.isNaN(limit) ? 20 : Math.max(1, Math.min(limit, 100)),
  });

  if (claimError) {
    return new Response(JSON.stringify({ error: claimError.message }), {
      status: 500,
      headers: jsonHeaders,
    });
  }

  const accessTokenCache = new Map<string, Promise<string>>();
  const processed: Array<Record<string, unknown>> = [];

  for (const job of (jobs || []) as SyncJob[]) {
    try {
      const result = await processSyncJob(supabase, job, accessTokenCache);
      processed.push(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      try {
        const { exhaustedRetries, nextRetryCount } = await markJobFailure(
          supabase,
          job,
          message,
          nowIso
        );

        await updateBookingSyncState(supabase, job.booking_id, {
          lastError: message,
        });
        await updateConnectionSyncState(supabase, job.business_id, {
          lastError: message,
        });

        processed.push({
          id: job.id,
          status: exhaustedRetries ? 'failed' : 'pending',
          retryCount: nextRetryCount,
          error: message,
        });
      } catch (failureError) {
        const failureMessage =
          failureError instanceof Error ? failureError.message : 'Failed to record job failure.';

        processed.push({
          id: job.id,
          status: 'processing',
          error: failureMessage,
          originalError: message,
        });
      }
    }
  }

  return new Response(
    JSON.stringify({
      claimed: (jobs || []).length,
      processed,
    }),
    {
      status: 200,
      headers: jsonHeaders,
    }
  );
});
