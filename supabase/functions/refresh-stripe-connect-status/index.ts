import Stripe from 'npm:stripe@16.12.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') || '';

const stripe = new Stripe(STRIPE_SECRET_KEY);

function getStripeCapabilityFlags(account: Stripe.Account) {
  return {
    stripe_charges_enabled: account.charges_enabled,
    stripe_payouts_enabled: account.payouts_enabled,
    stripe_card_payments_enabled: account.capabilities?.card_payments === 'active',
    stripe_transfers_enabled: account.capabilities?.transfers === 'active',
  };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY || !STRIPE_SECRET_KEY) {
    return new Response(JSON.stringify({ error: 'Missing required environment configuration.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
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
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();

  if (userError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = await req.json().catch(() => ({}));
  const businessId = body?.businessId as string | undefined;

  if (!businessId) {
    return new Response(JSON.stringify({ error: 'businessId is required.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { data: business, error: businessError } = await adminClient
    .from('businesses')
    .select('id, stripe_account_id')
    .eq('id', businessId)
    .eq('owner_user_id', user.id)
    .single();

  if (businessError || !business) {
    return new Response(JSON.stringify({ error: 'Business not found or access denied.' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!business.stripe_account_id) {
    return new Response(JSON.stringify({ error: 'Business has not connected a Stripe account yet.' }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const account = await stripe.accounts.retrieve(business.stripe_account_id);
    const capabilityFlags = getStripeCapabilityFlags(account);

    const { error: updateBusinessError } = await adminClient
      .from('businesses')
      .update(capabilityFlags)
      .eq('id', business.id);

    if (updateBusinessError) {
      throw new Error(updateBusinessError.message);
    }

    return new Response(
      JSON.stringify({
        stripeAccountId: account.id,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        cardPaymentsEnabled: capabilityFlags.stripe_card_payments_enabled,
        transfersEnabled: capabilityFlags.stripe_transfers_enabled,
        cardPaymentsCapability: account.capabilities?.card_payments || null,
        transfersCapability: account.capabilities?.transfers || null,
        capabilities: account.capabilities || {},
        requirementsCurrentlyDue: account.requirements?.currently_due || [],
        requirementsEventuallyDue: account.requirements?.eventually_due || [],
        requirementsPendingVerification: account.requirements?.pending_verification || [],
        requirementsDisabledReason: account.requirements?.disabled_reason || null,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to refresh Stripe Connect status.';

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
