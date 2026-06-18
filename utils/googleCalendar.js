export function getGoogleCalendarStatusLabel(status) {
  if (!status) {
    return 'Not connected';
  }

  if (status.connected) {
    return 'Connected';
  }

  if (status.disconnectedAt) {
    return 'Disconnected';
  }

  if (status.lastError) {
    return 'Needs attention';
  }

  return 'Not connected';
}

export function getGoogleCalendarSyncLabel(status) {
  if (status?.calendarName) {
    return status.calendarName;
  }

  if (status?.connected && status?.calendarId) {
    return 'SALO Bookings';
  }

  return '—';
}

export function formatGoogleCalendarTimestamp(value) {
  if (!value) {
    return '—';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return date.toLocaleString();
}
