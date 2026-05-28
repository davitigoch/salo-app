import Stripe from 'npm:stripe@16.12.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') || '';

const stripe = new Stripe(STRIPE_SECRET_KEY);
const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type BookingDraft = {
  client_name: string;
  date: string;
  time: string;
  notes?: string;
  customer_email?: string;
  customer_phone?: string;
  staff_member_id?: string | null;
  business_id: string;
  business_slug: string;
  service_id: string;
  booking_token?: string;
};

function toMajorUnits(amount: number) {
  return Number((amount / 100).toFixed(2));
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
  const checkoutSessionId = body?.checkoutSessionId as string | undefined;
  const bookingDraft = (body?.bookingDraft || {}) as BookingDraft;

  if (!checkoutSessionId) {
    return new Response(JSON.stringify({ error: 'checkoutSessionId is required.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!bookingDraft.business_id || !bookingDraft.service_id || !bookingDraft.client_name || !bookingDraft.date || !bookingDraft.time) {
    return new Response(JSON.stringify({ error: 'Incomplete booking draft payload.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { data: existingPayment, error: existingPaymentError } = await adminClient
    .from('payments')
    .select('id, booking_id, status')
    .eq('stripe_checkout_session_id', checkoutSessionId)
    .maybeSingle();

  if (existingPaymentError) {
    return new Response(JSON.stringify({ error: existingPaymentError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (existingPayment?.booking_id) {
    const { data: existingBookingTokenRow } = await adminClient
      .from('bookings')
      .select('booking_token, status')
      .eq('id', existingPayment.booking_id)
      .maybeSingle();

    return new Response(
      JSON.stringify({
        bookingId: existingPayment.booking_id,
        bookingToken: existingBookingTokenRow?.booking_token || null,
        bookingStatus: existingBookingTokenRow?.status || null,
        paymentId: existingPayment.id,
        status: existingPayment.status,
        alreadyFinalized: true,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const { data: business, error: businessError } = await adminClient
    .from('businesses')
    .select('id, owner_user_id, slug, public_booking_enabled, stripe_account_id, deposits_enabled, deposit_percentage')
    .eq('id', bookingDraft.business_id)
    .eq('public_booking_enabled', true)
    .single();

  if (businessError || !business) {
    return new Response(JSON.stringify({ error: 'Business not found or unavailable.' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!business.stripe_account_id) {
    return new Response(JSON.stringify({ error: 'Business has no connected Stripe account.' }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { data: service, error: serviceError } = await adminClient
    .from('services')
    .select('id, name, price, duration_minutes, category, color, is_active')
    .eq('id', bookingDraft.service_id)
    .eq('business_id', business.id)
    .single();

  if (serviceError || !service || !service.is_active) {
    return new Response(JSON.stringify({ error: 'Service not found or unavailable.' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (bookingDraft.staff_member_id) {
    const { data: staffMatch } = await adminClient
      .from('staff_members')
      .select('id')
      .eq('id', bookingDraft.staff_member_id)
      .eq('business_id', business.id)
      .eq('is_active', true)
      .maybeSingle();

    if (!staffMatch) {
      return new Response(JSON.stringify({ error: 'Selected team member is unavailable.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(
      checkoutSessionId,
      {
        expand: ['payment_intent'],
      },
      {
        stripeAccount: business.stripe_account_id,
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to verify checkout session.';
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (session.payment_status !== 'paid') {
    return new Response(JSON.stringify({ error: 'Checkout session is not paid yet.' }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const metadataBusinessId = session.metadata?.business_id || '';
  const metadataServiceId = session.metadata?.service_id || '';

  if (metadataBusinessId !== business.id || metadataServiceId !== service.id) {
    return new Response(JSON.stringify({ error: 'Checkout session metadata does not match booking draft.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const amountPaid = typeof session.amount_total === 'number' ? toMajorUnits(session.amount_total) : 0;
  const chargeMode = session.metadata?.charge_mode || 'full';

  const fullServicePrice = Number(service.price || 0);
  const expectedAmount = chargeMode === 'deposit'
    ? Number(((fullServicePrice * Number(business.deposit_percentage || 0)) / 100).toFixed(2))
    : Number(fullServicePrice.toFixed(2));

  if (Math.abs(amountPaid - expectedAmount) > 0.01) {
    return new Response(JSON.stringify({ error: 'Paid amount does not match expected service pricing.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const paymentIntentId = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id || null;

  const bookingMetadata = {
    service_id: service.id,
    service_name: service.name,
    service_duration_minutes: service.duration_minutes,
    service_category: service.category,
    service_color: service.color,
    staff_member_id: bookingDraft.staff_member_id || null,
    stripe_checkout_session_id: session.id,
    stripe_payment_intent_id: paymentIntentId,
    payment_charge_mode: chargeMode,
    payment_status: 'succeeded',
    notification_hooks: {
      confirmed_sms: 'pending',
    },
  };

  const bookingInsertPayload = {
    client_name: bookingDraft.client_name.trim(),
    service: service.name,
    price: fullServicePrice,
    date: bookingDraft.date,
    time: bookingDraft.time,
    notes: (bookingDraft.notes || '').trim(),
    customer_email: (bookingDraft.customer_email || '').trim(),
    customer_phone: (bookingDraft.customer_phone || '').trim(),
    staff_member_id: bookingDraft.staff_member_id || null,
    user_id: business.owner_user_id,
    business_id: business.id,
    business_slug: business.slug,
    booking_token: bookingDraft.booking_token || null,
    booking_source: 'public',
    status: 'confirmed',
    booking_metadata: bookingMetadata,
  };

  const { data: insertedBooking, error: bookingInsertError } = await adminClient
    .from('bookings')
    .insert(bookingInsertPayload)
    .select('id, booking_token, status')
    .single();

  if (bookingInsertError || !insertedBooking) {
    return new Response(JSON.stringify({ error: bookingInsertError?.message || 'Failed to create booking.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (existingPayment?.id) {
    const { error: updatePaymentError } = await adminClient
      .from('payments')
      .update({
        booking_id: insertedBooking.id,
        business_id: business.id,
        status: 'succeeded',
        refunded: false,
        paid_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingPayment.id);

    if (updatePaymentError) {
      return new Response(JSON.stringify({ error: updatePaymentError.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({
        bookingId: insertedBooking.id,
        bookingToken: insertedBooking.booking_token,
        bookingStatus: insertedBooking.status,
        paymentId: existingPayment.id,
        finalized: true,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const { data: insertedPayment, error: paymentInsertError } = await adminClient
    .from('payments')
    .insert({
      booking_id: insertedBooking.id,
      business_id: business.id,
      stripe_payment_intent_id: paymentIntentId,
      stripe_checkout_session_id: session.id,
      amount: amountPaid,
      currency: (session.currency || 'usd').toLowerCase(),
      status: 'succeeded',
      refunded: false,
      provider_event_type: 'payment_succeeded',
      provider_event_id: `finalize:${session.id}`,
      paid_at: new Date().toISOString(),
      metadata: {
        source: 'public_booking_finalize',
        charge_mode: chargeMode,
      },
    })
    .select('id')
    .single();

  if (paymentInsertError || !insertedPayment) {
    return new Response(JSON.stringify({ error: paymentInsertError?.message || 'Failed to create payment.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(
    JSON.stringify({
      bookingId: insertedBooking.id,
        bookingToken: insertedBooking.booking_token,
        bookingStatus: insertedBooking.status,
      paymentId: insertedPayment.id,
      finalized: true,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
});
