export const PAYMENT_MODES = {
  NONE: 'none',
  DEPOSIT: 'deposit',
  FULL: 'full',
};

export const PAYMENT_MODE_OPTIONS = [
  { key: PAYMENT_MODES.NONE, label: 'No deposit' },
  { key: PAYMENT_MODES.DEPOSIT, label: 'Deposit %' },
  { key: PAYMENT_MODES.FULL, label: 'Full payment' },
];

export function getStripeConnectStatus(business) {
  if (!business?.stripe_account_id) {
    return {
      key: 'not_connected',
      label: 'Not Connected',
      description: 'Connect Stripe to accept online payments from public bookings.',
      canCollectPayments: false,
    };
  }

  if (!business.stripe_charges_enabled) {
    return {
      key: 'pending_verification',
      label: 'Pending Verification',
      description: 'Finish Stripe onboarding to start accepting payments.',
      canCollectPayments: false,
    };
  }

  return {
    key: 'ready',
    label: 'Ready to Accept Payments',
    description: 'Your Stripe account is connected and can collect payments.',
    canCollectPayments: true,
  };
}

export function getStripeConnectButtonConfig(stripeStatus) {
  if (stripeStatus.key === 'not_connected') {
    return {
      show: true,
      title: 'Connect Stripe',
    };
  }

  if (stripeStatus.key === 'pending_verification') {
    return {
      show: true,
      title: 'Continue Stripe Setup',
    };
  }

  return {
    show: false,
    title: null,
  };
}

export function isPublicBookingPaymentRequired(business) {
  return (
    business?.require_card_on_booking === true || business?.deposits_enabled === true
  );
}

export function isPublicBookingStripeReady(business) {
  return Boolean(business?.stripe_account_id && business?.stripe_charges_enabled === true);
}

export function logPublicBookingPaymentSettings(business) {
  console.log('[SALO] public booking payment settings', {
    stripe_account_id: business?.stripe_account_id ?? null,
    stripe_charges_enabled: business?.stripe_charges_enabled === true,
    deposits_enabled: business?.deposits_enabled === true,
    deposit_percentage: business?.deposit_percentage ?? null,
    require_card_on_booking: business?.require_card_on_booking === true,
  });
}

export function getPaymentModeFromBusiness(business) {
  if (!business?.require_card_on_booking) {
    return PAYMENT_MODES.NONE;
  }

  if (business.deposits_enabled) {
    return PAYMENT_MODES.DEPOSIT;
  }

  return PAYMENT_MODES.FULL;
}

export function getPaymentModeLabel(mode) {
  const option = PAYMENT_MODE_OPTIONS.find((item) => item.key === mode);
  return option?.label || 'No deposit';
}

export function getBusinessPaymentSettingsFromMode(mode, depositPercentage) {
  const parsedPercentage = Number.parseFloat(depositPercentage);
  const normalizedPercentage = Number.isNaN(parsedPercentage)
    ? 30
    : Math.min(100, Math.max(0, parsedPercentage));

  if (mode === PAYMENT_MODES.DEPOSIT) {
    return {
      deposits_enabled: true,
      require_card_on_booking: true,
      deposit_percentage: Number(normalizedPercentage.toFixed(2)),
    };
  }

  if (mode === PAYMENT_MODES.FULL) {
    return {
      deposits_enabled: false,
      require_card_on_booking: true,
      deposit_percentage: 0,
    };
  }

  return {
    deposits_enabled: false,
    require_card_on_booking: false,
    deposit_percentage: Number(normalizedPercentage.toFixed(2)),
  };
}

export function formatCurrency(amount) {
  return `$${Number(amount || 0).toFixed(2)}`;
}

export function getPaymentStatusLabel(status) {
  switch (status) {
    case 'succeeded':
      return 'Paid';
    case 'pending':
      return 'Pending';
    case 'failed':
      return 'Failed';
    case 'refunded':
      return 'Refunded';
    case 'unpaid':
    default:
      return 'Unpaid';
  }
}

export function getChargeModeLabel(chargeMode) {
  switch (chargeMode) {
    case 'deposit':
      return 'Deposit';
    case 'full':
      return 'Full payment';
    default:
      return 'None';
  }
}

export function getBookingPaymentSummary(booking, paymentRow) {
  const metadata = booking?.booking_metadata || {};
  const paymentMetadata = paymentRow?.metadata || {};

  const paymentStatus =
    paymentRow?.status
    || metadata.payment_status
    || 'unpaid';

  const chargeMode =
    paymentMetadata.charge_mode
    || metadata.payment_charge_mode
    || (paymentRow?.status === 'succeeded' ? 'full' : 'none');

  const servicePrice = Number(booking?.price || 0);
  const depositPaid =
    paymentRow?.status === 'succeeded'
      ? Number(paymentRow.amount || 0)
      : 0;

  let amountDue = servicePrice;

  if (chargeMode === 'deposit' && paymentStatus === 'succeeded') {
    amountDue = Math.max(0, servicePrice - depositPaid);
  } else if (chargeMode === 'full' && paymentStatus === 'succeeded') {
    amountDue = 0;
  } else if (paymentStatus !== 'succeeded') {
    amountDue = servicePrice;
  }

  return {
    paymentStatus,
    chargeMode,
    depositPaid,
    amountDue,
    servicePrice,
    hasOnlinePayment: Boolean(paymentRow) || paymentStatus === 'succeeded',
  };
}

export function computeOnlinePaymentAnalytics(payments = []) {
  const succeededPayments = payments.filter((payment) => payment.status === 'succeeded');

  const revenueCollectedOnline = succeededPayments.reduce(
    (sum, payment) => sum + Number(payment.amount || 0),
    0
  );

  const depositRevenue = succeededPayments.reduce((sum, payment) => {
    const chargeMode = payment.metadata?.charge_mode;

    if (chargeMode === 'deposit') {
      return sum + Number(payment.amount || 0);
    }

    return sum;
  }, 0);

  return {
    revenueCollectedOnline,
    depositRevenue,
  };
}
