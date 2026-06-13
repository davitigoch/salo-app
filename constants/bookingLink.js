const DEFAULT_BOOKING_SITE_URL = 'https://salo-web-gamma.vercel.app';

function stripTrailingSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

export function getBookingSiteBaseUrl() {
  const fromEnv = stripTrailingSlash(process.env.EXPO_PUBLIC_BOOKING_SITE_URL);

  if (fromEnv) {
    return fromEnv;
  }

  return DEFAULT_BOOKING_SITE_URL;
}

export function getBusinessPublicBookingSlug(business) {
  return String(business?.public_slug || business?.slug || '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/^book\//i, '')
    .toLowerCase();
}

export function getPublicBookingUrl(slugOrBusiness) {
  const normalizedSlug =
    typeof slugOrBusiness === 'object' && slugOrBusiness !== null
      ? getBusinessPublicBookingSlug(slugOrBusiness)
      : String(slugOrBusiness || '')
          .trim()
          .replace(/^\/+|\/+$/g, '')
          .replace(/^book\//i, '')
          .toLowerCase();

  if (!normalizedSlug) {
    return '';
  }

  const baseUrl = getBookingSiteBaseUrl();

  if (!baseUrl) {
    return '';
  }

  return `${baseUrl}/book/${normalizedSlug}`;
}
