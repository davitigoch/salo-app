import Stripe from 'npm:stripe@16.12.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') || '';

const stripe = new Stripe(STRIPE_SECRET_KEY);
const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function toMinorUnits(amount: number) {
  return Math.max(0, Math.round(amount * 100));
}

function resolveChargeAmount({
  fullAmount,
  depositsEnabled,
  depositPercentage,
  paymentMode,
}: {
  fullAmount: number;
  depositsEnabled: boolean;
  depositPercentage: number;
  paymentMode: string;
}) {
  if (depositsEnabled && paymentMode !== 'full') {
    return Math.max(0, (fullAmount * depositPercentage) / 100);
  }

  return Math.max(0, fullAmount);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !STRIPE_SECRET_KEY) {
    return new Response(JSON.stringify({ error: 'Missing required environment configuration.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = await req.json().catch(() => ({}));
  const bookingId = body?.bookingId as string | undefined;
  const businessId = body?.businessId as string | undefined;
  const serviceId = body?.serviceId as string | undefined;
  const customerEmail = body?.customerEmail as string | undefined;
  const clientName = body?.clientName as string | undefined;
  const successUrl = body?.successUrl as string | undefined;
  const cancelUrl = body?.cancelUrl as string | undefined;
  const paymentMode = (body?.paymentMode as string | undefined) || 'auto';

  if (!successUrl || !cancelUrl) {
    return new Response(JSON.stringify({ error: 'successUrl and cancelUrl are required.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!bookingId && (!businessId || !serviceId || !clientName)) {
    return new Response(
      JSON.stringify({
        error:
          'Either bookingId or businessId + serviceId + clientName must be provided.',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  let bookingBusinessId: string | null = null;
  let bookingServiceName = '';
  let bookingClientName = clientName || 'Guest';
  let bookingCustomerEmail = customerEmail || '';
  let fullAmount = 0;

  if (bookingId) {
    const { data: booking, error: bookingError } = await adminClient
      .from('bookings')
      .select('id, business_id, client_name, customer_email, service, price')
      .eq('id', bookingId)
      .single();

    if (bookingError || !booking || !booking.business_id) {
      return new Response(JSON.stringify({ error: 'Booking not found.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    bookingBusinessId = booking.business_id;
    bookingServiceName = booking.service;
    bookingClientName = booking.client_name;
    bookingCustomerEmail = booking.customer_email || '';
    fullAmount = Number(booking.price || 0);
  } else {
    bookingBusinessId = businessId || null;

    const { data: service, error: serviceError } = await adminClient
      .from('services')
      .select('id, business_id, name, price, is_active')
      .eq('id', serviceId)
      .single();

    if (serviceError || !service || !service.business_id || !service.is_active) {
      return new Response(JSON.stringify({ error: 'Service not found or unavailable.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (bookingBusinessId !== service.business_id) {
      return new Response(JSON.stringify({ error: 'Service does not belong to this business.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    bookingServiceName = service.name;
    fullAmount = Number(service.price || 0);
  }

  const { data: business, error: businessError } = await adminClient
    .from('businesses')
    .select(
      'id, business_name, stripe_account_id, stripe_charges_enabled, stripe_card_payments_enabled, deposits_enabled, deposit_percentage, require_card_on_booking'
    )
    .eq('id', bookingBusinessId)
    .single();

  if (businessError || !business) {
    return new Response(JSON.stringify({ error: 'Business not found.' }), {
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

  if (!business.stripe_charges_enabled || !business.stripe_card_payments_enabled) {
    return new Response(
      JSON.stringify({
        error:
          'This salon has not finished payment setup. Card payments must be enabled on the connected Stripe account.',
      }),
      {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  let amountToCharge = fullAmount;

  if (!business.require_card_on_booking) {
    return new Response(
      JSON.stringify({
        requiresPayment: false,
        reason: 'Card is not required on booking for this business.',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const pct = Number(business.deposit_percentage || 0);
  amountToCharge = resolveChargeAmount({
    fullAmount,
    depositsEnabled: Boolean(business.deposits_enabled),
    depositPercentage: pct,
    paymentMode,
  });

  const amountMinor = toMinorUnits(amountToCharge);

  if (amountMinor <= 0) {
    return new Response(
      JSON.stringify({
        requiresPayment: false,
        reason: 'Calculated amount is zero.',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const currency = 'usd';

  try {
    const chargeMode = business.deposits_enabled && paymentMode !== 'full' ? 'deposit' : 'full';

    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        success_url: successUrl,
        cancel_url: cancelUrl,
        customer_email: bookingCustomerEmail || undefined,
        metadata: {
          booking_id: bookingId || '',
          business_id: business.id,
          service_id: serviceId || '',
          charge_mode: chargeMode,
          source_flow: bookingId ? 'owner_booking_checkout' : 'public_booking_checkout',
        },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency,
              unit_amount: amountMinor,
              product_data: {
                name: `${bookingServiceName} booking`,
                description:
                  chargeMode === 'deposit'
                    ? `Deposit for ${bookingClientName}`
                    : `Full prepayment for ${bookingClientName}`,
              },
            },
          },
        ],
        payment_intent_data: {
          metadata: {
            booking_id: bookingId || '',
            business_id: business.id,
            service_id: serviceId || '',
            charge_mode: chargeMode,
            source_flow: bookingId ? 'owner_booking_checkout' : 'public_booking_checkout',
          },
        },
      },
      {
        stripeAccount: business.stripe_account_id,
      }
    );

    return new Response(
      JSON.stringify({
        requiresPayment: true,
        checkoutSessionId: session.id,
        checkoutUrl: session.url,
        amount: Number((amountMinor / 100).toFixed(2)),
        currency,
        chargeMode,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create checkout session.';

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
