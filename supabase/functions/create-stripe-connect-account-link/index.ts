import Stripe from 'npm:stripe@16.12.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') || '';

const stripe = new Stripe(STRIPE_SECRET_KEY);

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
  const refreshUrl = body?.refreshUrl as string | undefined;
  const returnUrl = body?.returnUrl as string | undefined;

  if (!businessId || !refreshUrl || !returnUrl) {
    return new Response(JSON.stringify({ error: 'businessId, refreshUrl, and returnUrl are required.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { data: business, error: businessError } = await adminClient
    .from('businesses')
    .select('id, business_name, stripe_account_id')
    .eq('id', businessId)
    .eq('owner_user_id', user.id)
    .single();

  if (businessError || !business) {
    return new Response(JSON.stringify({ error: 'Business not found or access denied.' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    let stripeAccountId = business.stripe_account_id as string | null;

    if (!stripeAccountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        business_profile: {
          name: business.business_name,
        },
        metadata: {
          business_id: business.id,
        },
      });

      stripeAccountId = account.id;

      const { error: updateBusinessError } = await adminClient
        .from('businesses')
        .update({
          stripe_account_id: stripeAccountId,
          stripe_charges_enabled: account.charges_enabled,
          stripe_payouts_enabled: account.payouts_enabled,
        })
        .eq('id', business.id);

      if (updateBusinessError) {
        throw new Error(updateBusinessError.message);
      }
    }

    const accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    });

    return new Response(
      JSON.stringify({
        stripeAccountId,
        onboardingUrl: accountLink.url,
        expiresAt: accountLink.expires_at,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create Stripe onboarding link.';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
