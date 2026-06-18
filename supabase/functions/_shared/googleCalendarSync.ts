const GOOGLE_CALENDAR_EVENT_DESCRIPTION = 'Booking created by SALO';

type GoogleApiErrorBody = {
  error?: {
    message?: string;
    status?: string;
    code?: number;
  };
  message?: string;
};

export type GoogleCalendarEventInput = {
  service: string;
  clientName: string;
  date: string;
  time: string;
  durationMinutes: number;
  timeZone: string;
};

export type GoogleCalendarEventPayload = {
  summary: string;
  description: string;
  start: {
    dateTime: string;
    timeZone: string;
  };
  end: {
    dateTime: string;
    timeZone: string;
  };
};

function logGoogleCalendarSyncStep(step: string, details: Record<string, unknown> = {}) {
  console.log('[SALO GCal Sync]', step, JSON.stringify(details));
}

export function summarizeGoogleCalendarApiError(data: unknown): string {
  if (!data || typeof data !== 'object') {
    return 'Unknown Google Calendar API error.';
  }

  const record = data as GoogleApiErrorBody;
  return record.error?.message || record.message || JSON.stringify(data).slice(0, 500);
}

export function getGoogleCalendarApiStatusCode(data: unknown): number | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const code = (data as GoogleApiErrorBody).error?.code;
  return typeof code === 'number' ? code : null;
}

export function isGoogleCalendarNotFoundError(status: number, data: unknown): boolean {
  if (status === 404) {
    return true;
  }

  const apiStatus = String((data as GoogleApiErrorBody)?.error?.status || '').toUpperCase();
  return apiStatus === 'NOT_FOUND';
}

export function parseBookingTimeToMinutes(value: string): number | null {
  const trimmed = String(value || '').trim();

  const match24Hour = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (match24Hour) {
    const hours = Number(match24Hour[1]);
    const minutes = Number(match24Hour[2]);

    if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
      return hours * 60 + minutes;
    }
  }

  const match12Hour = trimmed.toLowerCase().match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/);
  if (match12Hour) {
    const hourValue = Number(match12Hour[1]);
    const minuteValue = Number(match12Hour[2]);
    const period = match12Hour[3];
    const normalizedHour =
      period === 'pm' && hourValue < 12
        ? hourValue + 12
        : period === 'am' && hourValue === 12
          ? 0
          : hourValue;

    if (
      normalizedHour >= 0 &&
      normalizedHour < 24 &&
      minuteValue >= 0 &&
      minuteValue < 60
    ) {
      return normalizedHour * 60 + minuteValue;
    }
  }

  return null;
}

function minutesToTimeString(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
}

function buildLocalDateTime(date: string, timeMinutes: number): string {
  const [year, month, day] = String(date || '').split('-').map((part) => Number(part));

  if (!year || !month || !day) {
    throw new Error('Invalid booking date.');
  }

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${minutesToTimeString(timeMinutes)}`;
}

export function getBookingDurationMinutes(
  booking: { booking_metadata?: Record<string, unknown> | null } | null | undefined,
  fallbackDuration = 60
): number {
  const metadataDuration = Number(booking?.booking_metadata?.service_duration_minutes);
  if (!Number.isNaN(metadataDuration) && metadataDuration > 0) {
    return metadataDuration;
  }

  return fallbackDuration;
}

export function buildGoogleCalendarEventPayload(
  input: GoogleCalendarEventInput
): GoogleCalendarEventPayload {
  const startMinutes = parseBookingTimeToMinutes(input.time);

  if (startMinutes === null) {
    throw new Error('Invalid booking time.');
  }

  const durationMinutes = Math.max(1, Number(input.durationMinutes || 60));
  const endMinutes = startMinutes + durationMinutes;
  const serviceName = String(input.service || 'Appointment').trim() || 'Appointment';
  const clientName = String(input.clientName || 'Client').trim() || 'Client';

  return {
    summary: `${serviceName} - ${clientName}`,
    description: GOOGLE_CALENDAR_EVENT_DESCRIPTION,
    start: {
      dateTime: buildLocalDateTime(input.date, startMinutes),
      timeZone: input.timeZone,
    },
    end: {
      dateTime: buildLocalDateTime(input.date, endMinutes),
      timeZone: input.timeZone,
    },
  };
}

function getGoogleCalendarEventsUrl(calendarId: string, eventId?: string): string {
  const encodedCalendarId = encodeURIComponent(calendarId);

  if (eventId) {
    return `https://www.googleapis.com/calendar/v3/calendars/${encodedCalendarId}/events/${encodeURIComponent(eventId)}`;
  }

  return `https://www.googleapis.com/calendar/v3/calendars/${encodedCalendarId}/events`;
}

export async function insertGoogleCalendarEvent({
  accessToken,
  calendarId,
  event,
}: {
  accessToken: string;
  calendarId: string;
  event: GoogleCalendarEventPayload;
}): Promise<string> {
  logGoogleCalendarSyncStep('events_insert_request', {
    calendar_id: calendarId,
    summary: event.summary,
  });

  const response = await fetch(getGoogleCalendarEventsUrl(calendarId), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(event),
  });

  const data = await response.json().catch(() => ({}));

  logGoogleCalendarSyncStep('events_insert_response', {
    ok: response.ok,
    status: response.status,
    has_event_id: Boolean((data as { id?: string })?.id),
    error_message: summarizeGoogleCalendarApiError(data),
  });

  if (!response.ok) {
    throw new Error(
      `[events.insert] ${summarizeGoogleCalendarApiError(data) || 'Failed to create Google Calendar event.'}`
    );
  }

  const eventId = String((data as { id?: string })?.id || '').trim();
  if (!eventId) {
    throw new Error('Google did not return an event id.');
  }

  return eventId;
}

export async function patchGoogleCalendarEvent({
  accessToken,
  calendarId,
  eventId,
  event,
}: {
  accessToken: string;
  calendarId: string;
  eventId: string;
  event: GoogleCalendarEventPayload;
}): Promise<void> {
  logGoogleCalendarSyncStep('events_patch_request', {
    calendar_id: calendarId,
    event_id: eventId,
    summary: event.summary,
  });

  const response = await fetch(getGoogleCalendarEventsUrl(calendarId, eventId), {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(event),
  });

  const data = await response.json().catch(() => ({}));

  logGoogleCalendarSyncStep('events_patch_response', {
    ok: response.ok,
    status: response.status,
    error_message: summarizeGoogleCalendarApiError(data),
  });

  if (!response.ok) {
    const error = new Error(
      `[events.patch] ${summarizeGoogleCalendarApiError(data) || 'Failed to update Google Calendar event.'}`
    ) as Error & { status?: number; responseBody?: unknown };
    error.status = response.status;
    error.responseBody = data;
    throw error;
  }
}

export async function deleteGoogleCalendarEvent({
  accessToken,
  calendarId,
  eventId,
}: {
  accessToken: string;
  calendarId: string;
  eventId: string;
}): Promise<void> {
  logGoogleCalendarSyncStep('events_delete_request', {
    calendar_id: calendarId,
    event_id: eventId,
  });

  const response = await fetch(getGoogleCalendarEventsUrl(calendarId, eventId), {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (response.status === 204 || response.status === 410) {
    logGoogleCalendarSyncStep('events_delete_response', {
      ok: true,
      status: response.status,
    });
    return;
  }

  const data = await response.json().catch(() => ({}));

  logGoogleCalendarSyncStep('events_delete_response', {
    ok: response.ok,
    status: response.status,
    error_message: summarizeGoogleCalendarApiError(data),
  });

  if (!response.ok) {
    const error = new Error(
      `[events.delete] ${summarizeGoogleCalendarApiError(data) || 'Failed to delete Google Calendar event.'}`
    ) as Error & { status?: number; responseBody?: unknown };
    error.status = response.status;
    error.responseBody = data;
    throw error;
  }
}
