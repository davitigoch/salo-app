const DEV_FALLBACK_BOOKING_SITE_URL = 'https://salo-web-gamma.vercel.app';

function stripTrailingSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

export function getBookingSiteBaseUrl() {
  const fromEnv = stripTrailingSlash(process.env.EXPO_PUBLIC_BOOKING_SITE_URL);

  if (fromEnv) {
    return fromEnv;
  }

  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    return DEV_FALLBACK_BOOKING_SITE_URL;
  }

  return '';
}

export function getPublicBookingUrl(slug) {
  const normalizedSlug = String(slug || '').trim();

  if (!normalizedSlug) {
    return '';
  }

  const baseUrl = getBookingSiteBaseUrl();

  if (!baseUrl) {
    return '';
  }

  return `${baseUrl}/book/${normalizedSlug}`;
}
