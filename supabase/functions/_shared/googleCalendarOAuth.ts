const GOOGLE_AUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const GOOGLE_CALENDAR_LIST_URL = 'https://www.googleapis.com/calendar/v3/users/me/calendarList';
const GOOGLE_CALENDAR_INSERT_URL = 'https://www.googleapis.com/calendar/v3/calendars';

export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';
export const GOOGLE_USERINFO_EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email';

export function getGoogleOAuthScopeString(): string {
  return [GOOGLE_CALENDAR_SCOPE, GOOGLE_USERINFO_EMAIL_SCOPE].join(' ');
}

export const GOOGLE_OAUTH_SCOPES = getGoogleOAuthScopeString();

export function tokenIncludesGoogleCalendarScope(scopeValue: string | null | undefined): boolean {
  const scopes = String(scopeValue || '')
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);

  return scopes.includes(GOOGLE_CALENDAR_SCOPE);
}
export const SALO_BOOKINGS_CALENDAR_SUMMARY = 'SALO Bookings';

function logGoogleOAuthStep(step: string, details: Record<string, unknown> = {}) {
  console.log('[SALO GCal OAuth]', step, JSON.stringify(details));
}

function summarizeGoogleApiError(data: unknown): string {
  if (!data || typeof data !== 'object') {
    return 'Unknown Google API error.';
  }

  const record = data as { error?: { message?: string; status?: string }; message?: string };
  return record.error?.message || record.message || JSON.stringify(data).slice(0, 500);
}

export type OAuthStatePayload = {
  businessId: string;
  userId: string;
  nonce: string;
  exp: number;
};

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name) || '';

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function base64ToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

async function importAesKey(): Promise<CryptoKey> {
  const keyMaterial = base64ToBytes(getRequiredEnv('GOOGLE_TOKEN_ENCRYPTION_KEY'));

  if (keyMaterial.byteLength !== 32) {
    throw new Error('GOOGLE_TOKEN_ENCRYPTION_KEY must be 32 bytes (base64-encoded).');
  }

  return crypto.subtle.importKey('raw', keyMaterial, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

async function importStateHmacKey(): Promise<CryptoKey> {
  const secret = getRequiredEnv('GOOGLE_OAUTH_STATE_SECRET');

  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function encryptRefreshToken(refreshToken: string): Promise<string> {
  const key = await importAesKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(refreshToken);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded)
  );
  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(ciphertext, iv.byteLength);

  return bytesToBase64Url(combined);
}

export async function decryptRefreshToken(encryptedValue: string): Promise<string> {
  const key = await importAesKey();
  const combined = base64UrlToBytes(encryptedValue);
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);

  return new TextDecoder().decode(decrypted);
}

export async function createOAuthState(payload: OAuthStatePayload): Promise<string> {
  const key = await importStateHmacKey();
  const payloadSegment = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadSegment));
  const signatureSegment = bytesToBase64Url(new Uint8Array(signature));

  return `${payloadSegment}.${signatureSegment}`;
}

export async function verifyOAuthState(state: string): Promise<OAuthStatePayload> {
  const [payloadSegment, signatureSegment] = state.split('.');

  if (!payloadSegment || !signatureSegment) {
    throw new Error('Invalid OAuth state format.');
  }

  const key = await importStateHmacKey();
  const signatureBytes = base64UrlToBytes(signatureSegment);
  const isValid = await crypto.subtle.verify(
    'HMAC',
    key,
    signatureBytes,
    new TextEncoder().encode(payloadSegment)
  );

  if (!isValid) {
    throw new Error('Invalid OAuth state signature.');
  }

  const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadSegment))) as OAuthStatePayload;

  if (!payload?.businessId || !payload?.userId || !payload?.nonce || !payload?.exp) {
    throw new Error('Invalid OAuth state payload.');
  }

  if (Date.now() > payload.exp) {
    throw new Error('OAuth state has expired.');
  }

  return payload;
}

export function buildGoogleOAuthUrl({
  clientId,
  redirectUri,
  state,
}: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const scope = getGoogleOAuthScopeString();

  if (!scope.includes(GOOGLE_CALENDAR_SCOPE)) {
    throw new Error('OAuth scope misconfiguration: calendar scope missing.');
  }

  const params = new URLSearchParams();
  params.set('client_id', clientId);
  params.set('redirect_uri', redirectUri);
  params.set('response_type', 'code');
  params.set('scope', scope);
  params.set('access_type', 'offline');
  params.set('prompt', 'consent');
  params.set('state', state);

  return `${GOOGLE_AUTH_BASE}?${params.toString()}`;
}

type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

export async function exchangeAuthorizationCode({
  code,
  clientId,
  clientSecret,
  redirectUri,
}: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const data = (await response.json().catch(() => ({}))) as GoogleTokenResponse;

  logGoogleOAuthStep('token_exchange_response', {
    ok: response.ok,
    status: response.status,
    has_access_token: Boolean(data.access_token),
    has_refresh_token: Boolean(data.refresh_token),
    token_type: data.token_type || null,
    scope: data.scope || null,
    error: data.error || null,
    error_description: data.error_description || null,
  });

  if (!response.ok) {
    throw new Error(data.error_description || data.error || 'Failed to exchange Google authorization code.');
  }

  return data;
}

export async function revokeGoogleToken(token: string): Promise<void> {
  const response = await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || 'Failed to revoke Google token.');
  }
}

export async function fetchGoogleAccountEmail(accessToken: string): Promise<string> {
  logGoogleOAuthStep('userinfo_request', {
    has_access_token: Boolean(accessToken),
    access_token_length: accessToken.length,
  });

  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await response.json().catch(() => ({}));

  logGoogleOAuthStep('userinfo_response', {
    ok: response.ok,
    status: response.status,
    has_email: Boolean((data as { email?: string })?.email),
    error_message: summarizeGoogleApiError(data),
  });

  if (!response.ok) {
    throw new Error(
      `[userinfo] ${summarizeGoogleApiError(data) || 'Failed to load Google account profile.'}`
    );
  }

  return String((data as { email?: string })?.email || '').trim();
}

async function findExistingSaloCalendarId(accessToken: string): Promise<string | null> {
  logGoogleOAuthStep('calendar_list_request', {
    has_access_token: Boolean(accessToken),
    access_token_length: accessToken.length,
  });

  const response = await fetch(GOOGLE_CALENDAR_LIST_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await response.json().catch(() => ({}));

  logGoogleOAuthStep('calendar_list_response', {
    ok: response.ok,
    status: response.status,
    item_count: Array.isArray((data as { items?: unknown[] })?.items)
      ? (data as { items: unknown[] }).items.length
      : 0,
    error_message: summarizeGoogleApiError(data),
  });

  if (!response.ok) {
    throw new Error(
      `[calendarList] ${summarizeGoogleApiError(data) || 'Failed to list Google calendars.'}`
    );
  }

  const items = Array.isArray((data as { items?: unknown[] })?.items)
    ? (data as { items: Array<{ summary?: string; id?: string }> }).items
    : [];
  const match = items.find((item) =>
    String(item?.summary || '').trim() === SALO_BOOKINGS_CALENDAR_SUMMARY
  );

  return match?.id ? String(match.id) : null;
}

async function createSaloBookingsCalendar(accessToken: string): Promise<string> {
  logGoogleOAuthStep('calendars_insert_request', {
    has_access_token: Boolean(accessToken),
    access_token_length: accessToken.length,
    summary: SALO_BOOKINGS_CALENDAR_SUMMARY,
  });

  const response = await fetch(GOOGLE_CALENDAR_INSERT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      summary: SALO_BOOKINGS_CALENDAR_SUMMARY,
      description: 'Appointments synced from SALO.',
      timeZone: 'UTC',
    }),
  });

  const data = await response.json().catch(() => ({}));

  logGoogleOAuthStep('calendars_insert_response', {
    ok: response.ok,
    status: response.status,
    has_calendar_id: Boolean((data as { id?: string })?.id),
    error_message: summarizeGoogleApiError(data),
  });

  if (!response.ok) {
    throw new Error(
      `[calendars.insert] ${summarizeGoogleApiError(data) || 'Failed to create SALO Bookings calendar.'}`
    );
  }

  if (!(data as { id?: string })?.id) {
    throw new Error('Google did not return a calendar id.');
  }

  return String((data as { id: string }).id);
}

export async function ensureSaloBookingsCalendarId(accessToken: string): Promise<string> {
  const existingCalendarId = await findExistingSaloCalendarId(accessToken);

  if (existingCalendarId) {
    return existingCalendarId;
  }

  return createSaloBookingsCalendar(accessToken);
}

export function getGoogleOAuthRedirectUri(): string {
  return getRequiredEnv('GOOGLE_OAUTH_REDIRECT_URI');
}

export function getGoogleOAuthClientId(): string {
  return getRequiredEnv('GOOGLE_CLIENT_ID');
}

export function getGoogleOAuthClientSecret(): string {
  return getRequiredEnv('GOOGLE_CLIENT_SECRET');
}

export type GoogleCalendarConnectionStatus = {
  connected: boolean;
  businessId: string;
  googleAccountEmail: string | null;
  calendarId: string | null;
  syncEnabled: boolean;
  connectedAt: string | null;
  disconnectedAt: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
};

export function toPublicConnectionStatus(
  businessId: string,
  connection: {
    google_account_email?: string | null;
    calendar_id?: string | null;
    refresh_token_encrypted?: string | null;
    sync_enabled?: boolean | null;
    connected_at?: string | null;
    disconnected_at?: string | null;
    last_synced_at?: string | null;
    last_error?: string | null;
  } | null
): GoogleCalendarConnectionStatus {
  const hasActiveConnection = Boolean(
    connection &&
      connection.disconnected_at == null &&
      connection.sync_enabled !== false &&
      coalesceTrimmed(connection.refresh_token_encrypted)
  );

  return {
    connected: hasActiveConnection,
    businessId,
    googleAccountEmail: connection?.google_account_email || null,
    calendarId: connection?.calendar_id || null,
    syncEnabled: connection?.sync_enabled !== false,
    connectedAt: connection?.connected_at || null,
    disconnectedAt: connection?.disconnected_at || null,
    lastSyncedAt: connection?.last_synced_at || null,
    lastError: connection?.last_error || null,
  };
}

function coalesceTrimmed(value: string | null | undefined): string {
  return String(value || '').trim();
}
