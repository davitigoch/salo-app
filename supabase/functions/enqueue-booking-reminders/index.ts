import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({
      error: 'Missing required environment configuration: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = await req.json().catch(() => ({}));

  const reminder24hLimit = Number(body?.reminder24hLimit ?? 200);
  const reminder24hWindowMinutes = Number(body?.reminder24hWindowMinutes ?? 60);
  const reminder2hLimit = Number(body?.reminder2hLimit ?? 200);
  const reminder2hWindowMinutes = Number(body?.reminder2hWindowMinutes ?? 30);

  const { data: reminder24hData, error: reminder24hError } = await supabase.rpc(
    'enqueue_booking_reminder_24h',
    {
      p_limit: Number.isNaN(reminder24hLimit) ? 200 : Math.max(1, reminder24hLimit),
      p_window_minutes: Number.isNaN(reminder24hWindowMinutes)
        ? 60
        : Math.max(1, reminder24hWindowMinutes),
    }
  );

  if (reminder24hError) {
    return new Response(JSON.stringify({
      error: reminder24hError.message,
      source: 'enqueue_booking_reminder_24h',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { data: reminder2hData, error: reminder2hError } = await supabase.rpc(
    'enqueue_booking_reminder_2h',
    {
      p_limit: Number.isNaN(reminder2hLimit) ? 200 : Math.max(1, reminder2hLimit),
      p_window_minutes: Number.isNaN(reminder2hWindowMinutes)
        ? 30
        : Math.max(1, reminder2hWindowMinutes),
    }
  );

  if (reminder2hError) {
    return new Response(JSON.stringify({
      error: reminder2hError.message,
      source: 'enqueue_booking_reminder_2h',
      reminder24hCount: Number(reminder24hData || 0),
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const reminder24hCount = Number(reminder24hData || 0);
  const reminder2hCount = Number(reminder2hData || 0);

  return new Response(JSON.stringify({
    reminder24hCount,
    reminder2hCount,
    totalQueued: reminder24hCount + reminder2hCount,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
