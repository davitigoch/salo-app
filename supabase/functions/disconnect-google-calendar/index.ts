import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import {
  decryptRefreshToken,
  revokeGoogleToken,
  toPublicConnectionStatus,
} from '../_shared/googleCalendarOAuth.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const jsonHeaders = { 'Content-Type': 'application/json' };

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: jsonHeaders,
    });
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: 'Missing required environment configuration.' }), {
      status: 500,
      headers: jsonHeaders,
    });
  }

  const authHeader = req.headers.get('Authorization') || '';
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: authHeader,
      },
    },
  });

  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();

  if (userError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: jsonHeaders,
    });
  }

  const body = await req.json().catch(() => ({}));
  const businessId = body?.businessId as string | undefined;

  if (!businessId) {
    return new Response(JSON.stringify({ error: 'businessId is required.' }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: business, error: businessError } = await adminClient
    .from('businesses')
    .select('id')
    .eq('id', businessId)
    .eq('owner_user_id', user.id)
    .single();

  if (businessError || !business) {
    return new Response(JSON.stringify({ error: 'Business not found or access denied.' }), {
      status: 404,
      headers: jsonHeaders,
    });
  }

  const { data: connection, error: connectionError } = await adminClient
    .from('google_calendar_connections')
    .select(
      'business_id, google_account_email, calendar_id, refresh_token_encrypted, sync_enabled, connected_at, disconnected_at, last_synced_at, last_error'
    )
    .eq('business_id', business.id)
    .maybeSingle();

  if (connectionError) {
    return new Response(JSON.stringify({ error: connectionError.message }), {
      status: 500,
      headers: jsonHeaders,
    });
  }

  if (!connection?.refresh_token_encrypted || connection.disconnected_at) {
    return new Response(
      JSON.stringify({
        disconnected: true,
        status: toPublicConnectionStatus(business.id, connection),
      }),
      {
        status: 200,
        headers: jsonHeaders,
      }
    );
  }

  try {
    const refreshToken = await decryptRefreshToken(connection.refresh_token_encrypted);
    await revokeGoogleToken(refreshToken);
  } catch (error) {
    console.warn('[SALO] Google token revoke failed during disconnect', error);
  }

  const nowIso = new Date().toISOString();

  const { data: updatedConnection, error: updateError } = await adminClient
    .from('google_calendar_connections')
    .update({
      refresh_token_encrypted: null,
      sync_enabled: false,
      disconnected_at: nowIso,
      last_error: null,
      updated_at: nowIso,
    })
    .eq('business_id', business.id)
    .select(
      'business_id, google_account_email, calendar_id, sync_enabled, connected_at, disconnected_at, last_synced_at, last_error'
    )
    .single();

  if (updateError || !updatedConnection) {
    return new Response(JSON.stringify({ error: updateError?.message || 'Failed to disconnect Google Calendar.' }), {
      status: 500,
      headers: jsonHeaders,
    });
  }

  return new Response(
    JSON.stringify({
      disconnected: true,
      status: toPublicConnectionStatus(business.id, updatedConnection),
    }),
    {
      status: 200,
      headers: jsonHeaders,
    }
  );
});
