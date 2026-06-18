import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import {
  decryptRefreshToken,
  encryptRefreshToken,
  ensureSaloBookingsCalendarId,
  exchangeAuthorizationCode,
  fetchGoogleAccountEmail,
  getGoogleOAuthClientId,
  getGoogleOAuthClientSecret,
  getGoogleOAuthRedirectUri,
  tokenIncludesGoogleCalendarScope,
  toPublicConnectionStatus,
  verifyOAuthState,
} from '../_shared/googleCalendarOAuth.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const GOOGLE_OAUTH_CALLBACK_SECRET = Deno.env.get('GOOGLE_OAUTH_CALLBACK_SECRET') || '';

const jsonHeaders = { 'Content-Type': 'application/json' };

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

  const callbackSecret = req.headers.get('x-salo-google-callback-secret') || '';

  if (!GOOGLE_OAUTH_CALLBACK_SECRET || callbackSecret !== GOOGLE_OAUTH_CALLBACK_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized callback request.' }), {
      status: 401,
      headers: jsonHeaders,
    });
  }

  const body = await req.json().catch(() => ({}));
  const code = String(body?.code || '').trim();
  const state = String(body?.state || '').trim();

  if (!code || !state) {
    return new Response(JSON.stringify({ error: 'code and state are required.' }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const statePayload = await verifyOAuthState(state);

    const { data: business, error: businessError } = await adminClient
      .from('businesses')
      .select('id, owner_user_id')
      .eq('id', statePayload.businessId)
      .eq('owner_user_id', statePayload.userId)
      .single();

    if (businessError || !business) {
      return new Response(JSON.stringify({ error: 'Business not found or access denied.' }), {
        status: 404,
        headers: jsonHeaders,
      });
    }

    const tokenResponse = await exchangeAuthorizationCode({
      code,
      clientId: getGoogleOAuthClientId(),
      clientSecret: getGoogleOAuthClientSecret(),
      redirectUri: getGoogleOAuthRedirectUri(),
    });

    let refreshToken = String(tokenResponse.refresh_token || '').trim();
    const accessToken = String(tokenResponse.access_token || '').trim();
    const grantedScope = String(tokenResponse.scope || '').trim();

    console.log('[SALO GCal OAuth] token_response_scope', grantedScope);
    console.log('[SALO GCal OAuth] callback_tokens', JSON.stringify({
      has_access_token: Boolean(accessToken),
      has_refresh_token: Boolean(refreshToken),
      access_token_length: accessToken.length,
      refresh_token_length: refreshToken.length,
      scope: grantedScope || null,
      has_calendar_scope: tokenIncludesGoogleCalendarScope(grantedScope),
    }));

    if (!accessToken) {
      return new Response(JSON.stringify({ error: 'Google did not return an access token.' }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    if (!tokenIncludesGoogleCalendarScope(grantedScope)) {
      return new Response(
        JSON.stringify({
          error:
            `Google did not grant calendar scope. Granted scopes: ${grantedScope || 'none'}. ` +
            'Remove SALO from Google Account permissions, disconnect in the app, and reconnect.',
        }),
        {
          status: 400,
          headers: jsonHeaders,
        }
      );
    }

    if (!refreshToken) {
      const { data: existingConnection } = await adminClient
        .from('google_calendar_connections')
        .select('refresh_token_encrypted')
        .eq('business_id', business.id)
        .maybeSingle();

      if (existingConnection?.refresh_token_encrypted) {
        refreshToken = await decryptRefreshToken(existingConnection.refresh_token_encrypted);
        console.log('[SALO GCal OAuth] callback_refresh_token_reused', JSON.stringify({
          reused_existing_refresh_token: Boolean(refreshToken),
        }));
      }
    }

    if (!refreshToken) {
      return new Response(JSON.stringify({ error: 'Google did not return a refresh token. Reconnect and approve calendar access.' }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    const googleAccountEmail = await fetchGoogleAccountEmail(accessToken);
    const calendarId = await ensureSaloBookingsCalendarId(accessToken);
    const refreshTokenEncrypted = await encryptRefreshToken(refreshToken);

    const nowIso = new Date().toISOString();

    const { data: connection, error: upsertError } = await adminClient
      .from('google_calendar_connections')
      .upsert(
        {
          business_id: business.id,
          google_account_email: googleAccountEmail || null,
          calendar_id: calendarId,
          refresh_token_encrypted: refreshTokenEncrypted,
          sync_enabled: true,
          connected_at: nowIso,
          disconnected_at: null,
          last_error: null,
          updated_at: nowIso,
        },
        { onConflict: 'business_id' }
      )
      .select(
        'business_id, google_account_email, calendar_id, sync_enabled, connected_at, disconnected_at, last_synced_at, last_error'
      )
      .single();

    if (upsertError || !connection) {
      throw new Error(upsertError?.message || 'Failed to save Google Calendar connection.');
    }

    return new Response(
      JSON.stringify({
        connected: true,
        status: toPublicConnectionStatus(business.id, {
          ...connection,
          refresh_token_encrypted: refreshTokenEncrypted,
        }),
      }),
      {
        status: 200,
        headers: jsonHeaders,
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to complete Google OAuth.';
    console.error('[SALO GCal OAuth] callback_failed', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
});
