export const CLIENT_SOURCE_LABELS = {
  public_booking: 'Public booking',
  owner_created: 'Owner created',
  import: 'Import',
  referral: 'Referral',
  unknown: 'Unknown',
};

export function getClientSourceLabel(source) {
  return CLIENT_SOURCE_LABELS[source] || CLIENT_SOURCE_LABELS.unknown;
}
