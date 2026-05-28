import Stripe from 'npm:stripe@16.12.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') || '';
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET') || '';

const stripe = new Stripe(STRIPE_SECRET_KEY);
const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type PaymentUpdatePayload = {
  paymentIntentId?: string | null;
  checkoutSessionId?: string | null;
  bookingId?: string | null;
  businessId?: string | null;
  amount?: number | null;
  currency?: string | null;
  status: 'pending' | 'succeeded' | 'failed' | 'refunded';
  refunded: boolean;
  paidAt?: string | null;
  refundedAt?: string | null;
  lastError?: string | null;
  providerEventType: 'payment_succeeded' | 'payment_failed' | 'refund';
  providerEventId: string;
};

function normalizeCurrency(value?: string | null) {
  return (value || 'usd').toLowerCase();
}

async function upsertPayment(payload: PaymentUpdatePayload) {
  const matchByPaymentIntent = payload.paymentIntentId
    ? adminClient
        .from('payments')
        .select('id')
        .eq('stripe_payment_intent_id', payload.paymentIntentId)
        .maybeSingle()
    : Promise.resolve({ data: null, error: null } as const);

  const matchByCheckoutSession = !payload.paymentIntentId && payload.checkoutSessionId
    ? adminClient
        .from('payments')
        .select('id')
        .eq('stripe_checkout_session_id', payload.checkoutSessionId)
        .maybeSingle()
    : Promise.resolve({ data: null, error: null } as const);

  const [{ data: existingByIntent, error: existingIntentError }, { data: existingByCheckout, error: existingCheckoutError }] =
    await Promise.all([matchByPaymentIntent, matchByCheckoutSession]);

  if (existingIntentError) {
    throw new Error(existingIntentError.message);
  }

  if (existingCheckoutError) {
    throw new Error(existingCheckoutError.message);
  }

  const existing = existingByIntent || existingByCheckout;

  const updateData = {
    stripe_payment_intent_id: payload.paymentIntentId || null,
    stripe_checkout_session_id: payload.checkoutSessionId || null,
    status: payload.status,
    refunded: payload.refunded,
    paid_at: payload.paidAt || null,
    refunded_at: payload.refundedAt || null,
    last_error: payload.lastError || null,
    provider_event_type: payload.providerEventType,
    provider_event_id: payload.providerEventId,
    updated_at: new Date().toISOString(),
  };

  if (existing?.id) {
    const { error: updateError } = await adminClient.from('payments').update(updateData).eq('id', existing.id);
    if (updateError) {
      throw new Error(updateError.message);
    }
    return existing.id;
  }

  if (!payload.bookingId || !payload.businessId || payload.amount == null) {
    return null;
  }

  const { data: inserted, error: insertError } = await adminClient
    .from('payments')
    .insert({
      booking_id: payload.bookingId,
      business_id: payload.businessId,
      stripe_payment_intent_id: payload.paymentIntentId || null,
      stripe_checkout_session_id: payload.checkoutSessionId || null,
      amount: payload.amount,
      currency: normalizeCurrency(payload.currency),
      status: payload.status,
      refunded: payload.refunded,
      paid_at: payload.paidAt || null,
      refunded_at: payload.refundedAt || null,
      last_error: payload.lastError || null,
      provider_event_type: payload.providerEventType,
      provider_event_id: payload.providerEventId,
      metadata: {
        source: 'stripe_webhook',
      },
    })
    .select('id')
    .single();

  if (insertError || !inserted) {
    throw new Error(insertError?.message || 'Failed to insert payment row from webhook.');
  }

  return inserted.id;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: 'Missing required environment configuration.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return new Response(JSON.stringify({ error: 'Missing stripe-signature header.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid webhook signature.';
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const paymentStatus = session.payment_status;
      const amount = typeof session.amount_total === 'number' ? Number((session.amount_total / 100).toFixed(2)) : null;

      await upsertPayment({
        paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : null,
        checkoutSessionId: session.id,
        bookingId: session.metadata?.booking_id || null,
        businessId: session.metadata?.business_id || null,
        amount,
        currency: session.currency || 'usd',
        status: paymentStatus === 'paid' ? 'succeeded' : 'pending',
        refunded: false,
        paidAt: paymentStatus === 'paid' ? new Date().toISOString() : null,
        providerEventType: 'payment_succeeded',
        providerEventId: event.id,
      });
    }

    if (event.type === 'payment_intent.succeeded') {
      const intent = event.data.object as Stripe.PaymentIntent;
      await upsertPayment({
        paymentIntentId: intent.id,
        checkoutSessionId: null,
        bookingId: intent.metadata?.booking_id || null,
        businessId: intent.metadata?.business_id || null,
        amount: Number((intent.amount / 100).toFixed(2)),
        currency: intent.currency || 'usd',
        status: 'succeeded',
        refunded: false,
        paidAt: new Date().toISOString(),
        providerEventType: 'payment_succeeded',
        providerEventId: event.id,
      });
    }

    if (event.type === 'payment_intent.payment_failed') {
      const intent = event.data.object as Stripe.PaymentIntent;
      const lastError = intent.last_payment_error?.message || 'Payment failed.';
      await upsertPayment({
        paymentIntentId: intent.id,
        checkoutSessionId: null,
        bookingId: intent.metadata?.booking_id || null,
        businessId: intent.metadata?.business_id || null,
        amount: Number((intent.amount / 100).toFixed(2)),
        currency: intent.currency || 'usd',
        status: 'failed',
        refunded: false,
        lastError,
        providerEventType: 'payment_failed',
        providerEventId: event.id,
      });
    }

    if (event.type === 'charge.refunded') {
      const charge = event.data.object as Stripe.Charge;
      await upsertPayment({
        paymentIntentId: typeof charge.payment_intent === 'string' ? charge.payment_intent : null,
        checkoutSessionId: null,
        status: 'refunded',
        refunded: true,
        refundedAt: new Date().toISOString(),
        providerEventType: 'refund',
        providerEventId: event.id,
      });
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Webhook processing failed.';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
