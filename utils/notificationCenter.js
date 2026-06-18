export function normalizeNotificationRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    businessId: row.business_id,
    userId: row.user_id,
    actorUserId: row.actor_user_id,
    eventType: row.event_type,
    severity: row.severity,
    title: row.title,
    body: row.body,
    entityType: row.entity_type,
    entityId: row.entity_id,
    metadata: row.metadata || {},
    dedupeKey: row.dedupe_key,
    createdAt: row.created_at,
    isRead: Boolean(row.is_read),
    readAt: row.read_at,
  };
}

export async function fetchNotificationList(
  supabase,
  businessId,
  { limit = 50, offset = 0, unreadOnly = false } = {}
) {
  if (!businessId) {
    return { data: [], error: { message: 'Business is not ready yet.' } };
  }

  const { data, error } = await supabase.rpc('list_notifications', {
    p_business_id: businessId,
    p_limit: limit,
    p_offset: offset,
    p_unread_only: unreadOnly,
  });

  if (error) {
    return { data: [], error };
  }

  return {
    data: (data || []).map(normalizeNotificationRow).filter(Boolean),
    error: null,
  };
}

export async function fetchUnreadNotificationCount(supabase, businessId) {
  if (!businessId) {
    return { count: 0, error: null };
  }

  const { data, error } = await supabase.rpc('get_unread_notification_count', {
    p_business_id: businessId,
  });

  if (error) {
    return { count: 0, error };
  }

  return {
    count: Number(data || 0),
    error: null,
  };
}

export async function markNotificationRead(supabase, notificationEventId) {
  if (!notificationEventId) {
    return { error: { message: 'Notification id is required.' } };
  }

  const { error } = await supabase.rpc('mark_notification_read', {
    p_notification_event_id: notificationEventId,
  });

  return { error: error || null };
}

export async function markAllNotificationsRead(supabase, businessId) {
  if (!businessId) {
    return { error: { message: 'Business is not ready yet.' }, markedCount: 0 };
  }

  const { data, error } = await supabase.rpc('mark_all_notifications_read', {
    p_business_id: businessId,
  });

  return {
    markedCount: Number(data || 0),
    error: error || null,
  };
}

export function formatNotificationBadgeCount(count) {
  const value = Number(count || 0);

  if (value <= 0) {
    return null;
  }

  if (value > 99) {
    return '99+';
  }

  return String(value);
}

export function getNotificationBookingId(notification) {
  if (!notification) {
    return null;
  }

  if (notification.entityType === 'booking' && notification.entityId) {
    return notification.entityId;
  }

  const metadataBookingId = notification.metadata?.booking_id;

  if (metadataBookingId) {
    return String(metadataBookingId);
  }

  return null;
}

export function shouldOpenNotificationDetail(notification) {
  if (!notification) {
    return true;
  }

  if (
    notification.eventType === 'calendar_sync_failed' ||
    notification.eventType === 'message_delivery_failed'
  ) {
    return true;
  }

  return !getNotificationBookingId(notification);
}

export function formatNotificationTimestamp(value) {
  if (!value) {
    return '';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);

  if (diffMinutes < 1) {
    return 'Just now';
  }

  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);

  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.floor(diffHours / 24);

  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

export function getNotificationIconName(eventType) {
  switch (eventType) {
    case 'booking_created':
      return 'calendar-outline';
    case 'booking_confirmed':
      return 'checkmark-circle-outline';
    case 'booking_cancelled':
      return 'close-circle-outline';
    case 'booking_rescheduled':
      return 'time-outline';
    case 'public_booking_request':
      return 'mail-open-outline';
    case 'payment_received':
      return 'card-outline';
    case 'calendar_sync_failed':
      return 'cloud-offline-outline';
    case 'message_delivery_failed':
      return 'alert-circle-outline';
    default:
      return 'notifications-outline';
  }
}

export function getNotificationAccentColor(severity) {
  switch (severity) {
    case 'success':
      return '#34D399';
    case 'warning':
      return '#FBBF24';
    default:
      return '#A78BFA';
  }
}

export function getNotificationEventLabel(eventType) {
  switch (eventType) {
    case 'booking_created':
      return 'Appointment created';
    case 'booking_confirmed':
      return 'Appointment confirmed';
    case 'booking_cancelled':
      return 'Appointment cancelled';
    case 'booking_rescheduled':
      return 'Appointment rescheduled';
    case 'public_booking_request':
      return 'Booking request';
    case 'payment_received':
      return 'Payment received';
    case 'calendar_sync_failed':
      return 'Calendar sync failed';
    case 'message_delivery_failed':
      return 'Message delivery failed';
    default:
      return 'Notification';
  }
}
