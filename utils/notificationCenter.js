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
