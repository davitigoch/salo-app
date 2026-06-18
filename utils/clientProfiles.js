const CLIENT_TABLE_SELECT =
  'id, business_id, client_name, first_name, last_name, display_name, phone, email, notes, user_id, source, source_detail, preferred_staff_member_id, profile_metadata, created_at, updated_at';

export function splitClientName(clientName) {
  const trimmed = String(clientName || '').trim();

  if (!trimmed) {
    return {
      first_name: 'Client',
      last_name: null,
      display_name: 'Client',
      client_name: 'Client',
    };
  }

  const spaceIndex = trimmed.indexOf(' ');

  if (spaceIndex === -1) {
    return {
      first_name: trimmed,
      last_name: null,
      display_name: trimmed,
      client_name: trimmed,
    };
  }

  const firstName = trimmed.slice(0, spaceIndex).trim();
  const lastName = trimmed.slice(spaceIndex + 1).trim();
  const displayName = lastName ? `${firstName} ${lastName}` : firstName;

  return {
    first_name: firstName,
    last_name: lastName || null,
    display_name: displayName,
    client_name: displayName,
  };
}

export function getClientDisplayName(client) {
  if (!client) {
    return '';
  }

  return (
    String(client.display_name || '').trim() ||
    String(client.client_name || '').trim() ||
    [client.first_name, client.last_name].filter(Boolean).join(' ').trim()
  );
}

function formatProfileTimestamp(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

export function formatClientSinceLabel(createdAt) {
  if (!createdAt) {
    return 'Client profile';
  }

  const date = new Date(createdAt);

  if (Number.isNaN(date.getTime())) {
    return 'Client profile';
  }

  return `Client since ${date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`;
}

export function normalizeClientProfileRow(row) {
  if (!row) {
    return null;
  }

  const displayName = getClientDisplayName(row);

  return {
    id: row.id,
    business_id: row.business_id,
    user_id: row.user_id,
    first_name: row.first_name,
    last_name: row.last_name,
    display_name: displayName,
    client_name: row.client_name || displayName,
    phone: row.phone,
    email: row.email,
    notes: row.notes,
    source: row.source,
    source_detail: row.source_detail,
    preferred_staff_member_id: row.preferred_staff_member_id,
    profile_metadata: row.profile_metadata || {},
    created_at: row.created_at,
    updated_at: row.updated_at,
    lifetime_bookings: Number(row.lifetime_bookings || 0),
    lifetime_revenue: Number(row.lifetime_revenue || 0),
    average_spend: Number(row.average_spend || 0),
    last_visit_at: row.last_visit_at || null,
    next_appointment_at: row.next_appointment_at || null,
    no_show_count: Number(row.no_show_count || 0),
    cancellation_count: Number(row.cancellation_count || 0),
    rescheduled_count: Number(row.rescheduled_count || 0),
    last_visit_at_date: formatProfileTimestamp(row.last_visit_at),
    next_appointment_at_date: formatProfileTimestamp(row.next_appointment_at),
  };
}

export function normalizeClientTableRow(row) {
  return normalizeClientProfileRow({
    ...row,
    lifetime_bookings: 0,
    lifetime_revenue: 0,
    average_spend: 0,
    no_show_count: 0,
    cancellation_count: 0,
    rescheduled_count: 0,
  });
}

export function normalizeClientProfilePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const client = normalizeClientProfileRow({
    ...(payload.client || {}),
    ...(payload.stats || {}),
    id: payload.client?.id,
    business_id: payload.client?.business_id,
  });

  return {
    client,
    stats: payload.stats || null,
    tags: Array.isArray(payload.tags) ? payload.tags : [],
    upcoming_appointments: Array.isArray(payload.upcoming_appointments)
      ? payload.upcoming_appointments
      : [],
    appointment_history: Array.isArray(payload.appointment_history) ? payload.appointment_history : [],
    cancelled_appointments: Array.isArray(payload.cancelled_appointments)
      ? payload.cancelled_appointments
      : [],
    rescheduled_events: Array.isArray(payload.rescheduled_events) ? payload.rescheduled_events : [],
  };
}

export function buildClientInsertPayload(clientInput, { businessId, userId }) {
  const identity = splitClientName(clientInput?.client_name);

  return {
    business_id: businessId,
    user_id: userId,
    client_name: identity.client_name,
    first_name: identity.first_name,
    last_name: identity.last_name,
    display_name: identity.display_name,
    phone: String(clientInput?.phone || '').trim() || null,
    email: String(clientInput?.email || '').trim() || null,
    notes: String(clientInput?.notes || '').trim() || null,
    source: clientInput?.source || 'owner_created',
    source_detail: clientInput?.source_detail || null,
    preferred_staff_member_id: clientInput?.preferred_staff_member_id || null,
    profile_metadata: clientInput?.profile_metadata || {},
  };
}

export function buildClientUpdatePayload(clientInput) {
  const payload = {};

  if (clientInput?.client_name !== undefined) {
    const identity = splitClientName(clientInput.client_name);
    payload.client_name = identity.client_name;
    payload.first_name = identity.first_name;
    payload.last_name = identity.last_name;
    payload.display_name = identity.display_name;
  }

  if (clientInput?.phone !== undefined) {
    payload.phone = String(clientInput.phone || '').trim() || null;
  }

  if (clientInput?.email !== undefined) {
    payload.email = String(clientInput.email || '').trim() || null;
  }

  if (clientInput?.notes !== undefined) {
    payload.notes = String(clientInput.notes || '').trim() || null;
  }

  if (clientInput?.preferred_staff_member_id !== undefined) {
    payload.preferred_staff_member_id = clientInput.preferred_staff_member_id || null;
  }

  if (clientInput?.source !== undefined) {
    payload.source = clientInput.source;
  }

  if (clientInput?.source_detail !== undefined) {
    payload.source_detail = clientInput.source_detail || null;
  }

  if (clientInput?.profile_metadata !== undefined) {
    payload.profile_metadata = clientInput.profile_metadata || {};
  }

  return payload;
}

export async function fetchClientProfilesList(supabase, businessId, { search = null, limit = 100, offset = 0 } = {}) {
  const { data, error } = await supabase.rpc('list_client_profiles', {
    p_business_id: businessId,
    p_search: search,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) {
    return { data: [], error };
  }

  return {
    data: (Array.isArray(data) ? data : []).map(normalizeClientProfileRow).filter(Boolean),
    error: null,
  };
}

export async function fetchClientProfile(supabase, clientId) {
  const { data, error } = await supabase.rpc('get_client_profile', {
    p_client_id: clientId,
  });

  if (error) {
    return { data: null, error };
  }

  return {
    data: normalizeClientProfilePayload(data),
    error: null,
  };
}

export { CLIENT_TABLE_SELECT };
