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

function isValidBookingDate(value: string) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }

  if (year < 2000 || year > 2100) {
    return false;
  }

  const parsed = new Date(year, month - 1, day, 0, 0, 0, 0);
  return parsed.getFullYear() === year
    && parsed.getMonth() === month - 1
    && parsed.getDate() === day;
}

function isValidBookingTime(value: string) {
  const match = String(value || '').trim().match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    return false;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  return Number.isInteger(hours)
    && Number.isInteger(minutes)
    && hours >= 0
    && hours <= 23
    && minutes >= 0
    && minutes <= 59;
}

function toMajorUnits(amount: number) {
  return Number((amount / 100).toFixed(2));
}

function toErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string' && error) {
    return error;
  }

  return fallback;
}

function toErrorDetails(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return error;
}

function errorResponse({
  status,
  step,
  error,
  details,
}: {
  status: number;
  step: string;
  error: string;
  details?: unknown;
}) {
  return new Response(
    JSON.stringify({
      error,
      step,
      details: details ?? null,
    }),
    {
      status,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    const details = { method: req.method };
    console.error('[finalize-public-booking-payment] method_not_allowed', details);
    return errorResponse({
      status: 405,
      step: 'method_check',
      error: 'Method not allowed',
      details,
    });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !STRIPE_SECRET_KEY) {
    const details = {
      hasSupabaseUrl: Boolean(SUPABASE_URL),
      hasServiceRoleKey: Boolean(SUPABASE_SERVICE_ROLE_KEY),
      hasStripeSecretKey: Boolean(STRIPE_SECRET_KEY),
    };
    console.error('[finalize-public-booking-payment] missing_environment_configuration', details);
    return errorResponse({
      status: 500,
      step: 'environment_validation',
      error: 'Missing required environment configuration.',
      details,
    });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch (parseError) {
    const details = {
      parseError: toErrorDetails(parseError),
    };
    console.error('[finalize-public-booking-payment] request_body_parse_failed', details);
    return errorResponse({
      status: 400,
      step: 'request_body_parse',
      error: 'Invalid JSON body.',
      details,
    });
  }

  const checkoutSessionId = body?.checkoutSessionId as string | undefined;
  const bookingDraft = (body?.bookingDraft || {}) as BookingDraft;

  if (!checkoutSessionId) {
    const details = {
      hasCheckoutSessionId: Boolean(checkoutSessionId),
    };
    console.error('[finalize-public-booking-payment] missing_checkout_session_id', details);
    return errorResponse({
      status: 400,
      step: 'request_validation',
      error: 'checkoutSessionId is required.',
      details,
    });
  }

  if (!bookingDraft.business_id || !bookingDraft.service_id || !bookingDraft.client_name || !bookingDraft.date || !bookingDraft.time) {
    const details = {
      hasBusinessId: Boolean(bookingDraft.business_id),
      hasServiceId: Boolean(bookingDraft.service_id),
      hasClientName: Boolean(bookingDraft.client_name),
      hasDate: Boolean(bookingDraft.date),
      hasTime: Boolean(bookingDraft.time),
    };
    console.error('[finalize-public-booking-payment] incomplete_booking_draft_payload', details);
    return errorResponse({
      status: 400,
      step: 'request_validation',
      error: 'Incomplete booking draft payload.',
      details,
    });
  }

  if (!isValidBookingDate(bookingDraft.date) || !isValidBookingTime(bookingDraft.time)) {
    const details = {
      date: bookingDraft.date,
      time: bookingDraft.time,
    };
    console.error('[finalize-public-booking-payment] invalid_booking_draft_datetime', details);
    return errorResponse({
      status: 400,
      step: 'request_validation',
      error: 'Invalid booking date or time in booking draft payload.',
      details,
    });
  }

  const { data: existingPayment, error: existingPaymentError } = await adminClient
    .from('payments')
    .select('id, booking_id, status')
    .eq('stripe_checkout_session_id', checkoutSessionId)
    .maybeSingle();

  if (existingPaymentError) {
    const details = {
      checkoutSessionId,
      queryError: toErrorDetails(existingPaymentError),
    };
    console.error('[finalize-public-booking-payment] existing_payment_lookup_failed', details);
    return errorResponse({
      status: 500,
      step: 'existing_payment_lookup',
      error: toErrorMessage(existingPaymentError, 'Failed to lookup existing payment.'),
      details,
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
    .select('id, owner_user_id, slug, public_booking_enabled, deposits_enabled, deposit_percentage')
    .eq('id', bookingDraft.business_id)
    .eq('public_booking_enabled', true)
    .single();

  if (businessError || !business) {
    const details = {
      businessId: bookingDraft.business_id,
      queryError: toErrorDetails(businessError),
    };
    console.error('[finalize-public-booking-payment] business_lookup_failed', details);
    return errorResponse({
      status: 404,
      step: 'business_lookup',
      error: 'Business not found or unavailable.',
      details,
    });
  }

  const { data: service, error: serviceError } = await adminClient
    .from('services')
    .select('id, name, price, duration_minutes, category, color, is_active')
    .eq('id', bookingDraft.service_id)
    .eq('business_id', business.id)
    .single();

  if (serviceError || !service || !service.is_active) {
    const details = {
      serviceId: bookingDraft.service_id,
      businessId: business.id,
      queryError: toErrorDetails(serviceError),
      hasService: Boolean(service),
      isActive: Boolean(service?.is_active),
    };
    console.error('[finalize-public-booking-payment] service_lookup_failed', details);
    return errorResponse({
      status: 404,
      step: 'service_lookup',
      error: 'Service not found or unavailable.',
      details,
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
      const details = {
        staffMemberId: bookingDraft.staff_member_id,
        businessId: business.id,
      };
      console.error('[finalize-public-booking-payment] staff_validation_failed', details);
      return errorResponse({
        status: 400,
        step: 'staff_validation',
        error: 'Selected team member is unavailable.',
        details,
      });
    }
  }

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(checkoutSessionId, {
      expand: ['payment_intent'],
    });
  } catch (error) {
    const details = {
      checkoutSessionId,
      stripeError: toErrorDetails(error),
    };
    console.error('[finalize-public-booking-payment] stripe_checkout_session_retrieve_failed', details);
    return errorResponse({
      status: 400,
      step: 'stripe_checkout_session_retrieve',
      error: toErrorMessage(error, 'Failed to verify checkout session.'),
      details,
    });
  }

  if (session.payment_status !== 'paid') {
    const details = {
      checkoutSessionId,
      paymentStatus: session.payment_status,
    };
    console.error('[finalize-public-booking-payment] checkout_session_not_paid', details);
    return errorResponse({
      status: 409,
      step: 'session_payment_status_validation',
      error: 'Checkout session is not paid yet.',
      details,
    });
  }

  const metadataBusinessId = session.metadata?.business_id || '';
  const metadataServiceId = session.metadata?.service_id || '';

  if (metadataBusinessId !== business.id || metadataServiceId !== service.id) {
    const details = {
      checkoutSessionId,
      metadataBusinessId,
      expectedBusinessId: business.id,
      metadataServiceId,
      expectedServiceId: service.id,
    };
    console.error('[finalize-public-booking-payment] session_metadata_validation_failed', details);
    return errorResponse({
      status: 400,
      step: 'session_metadata_validation',
      error: 'Checkout session metadata does not match booking draft.',
      details,
    });
  }

  const amountPaid = typeof session.amount_total === 'number' ? toMajorUnits(session.amount_total) : 0;
  const chargeMode = session.metadata?.charge_mode || 'full';

  const fullServicePrice = Number(service.price || 0);
  const expectedAmount = chargeMode === 'deposit'
    ? Number(((fullServicePrice * Number(business.deposit_percentage || 0)) / 100).toFixed(2))
    : Number(fullServicePrice.toFixed(2));

  if (Math.abs(amountPaid - expectedAmount) > 0.01) {
    const details = {
      checkoutSessionId,
      amountPaid,
      expectedAmount,
      chargeMode,
    };
    console.error('[finalize-public-booking-payment] amount_validation_failed', details);
    return errorResponse({
      status: 400,
      step: 'amount_validation',
      error: 'Paid amount does not match expected service pricing.',
      details,
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
    const details = {
      bookingInsertPayload,
      insertError: toErrorDetails(bookingInsertError),
      hasInsertedBooking: Boolean(insertedBooking),
    };
    console.error('[finalize-public-booking-payment] booking_insert_failed', details);
    return errorResponse({
      status: 500,
      step: 'booking_insert',
      error: toErrorMessage(bookingInsertError, 'Failed to create booking.'),
      details,
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
      const details = {
        paymentId: existingPayment.id,
        bookingId: insertedBooking.id,
        updateError: toErrorDetails(updatePaymentError),
      };
      console.error('[finalize-public-booking-payment] payment_update_failed', details);
      return errorResponse({
        status: 500,
        step: 'payment_update',
        error: toErrorMessage(updatePaymentError, 'Failed to update payment.'),
        details,
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
    const details = {
      bookingId: insertedBooking.id,
      checkoutSessionId: session.id,
      insertError: toErrorDetails(paymentInsertError),
      hasInsertedPayment: Boolean(insertedPayment),
    };
    console.error('[finalize-public-booking-payment] payment_insert_failed', details);
    return errorResponse({
      status: 500,
      step: 'payment_insert',
      error: toErrorMessage(paymentInsertError, 'Failed to create payment.'),
      details,
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
