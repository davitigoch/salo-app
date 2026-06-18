export type SmsNotificationType =
  | 'booking_confirmed'
  | 'booking_rescheduled'
  | 'booking_cancelled'
  | 'reminder_24h'
  | 'reminder_2h';

export type BookingSmsContext = {
  service?: string | null;
  date?: string | null;
  time?: string | null;
  client_name?: string | null;
};

export function buildSmsMessage(
  notificationType: string,
  booking: BookingSmsContext
): string {
  const serviceName = booking?.service || 'appointment';
  const bookingDate = booking?.date || 'your date';
  const bookingTime = booking?.time || 'your time';
  const clientName = booking?.client_name || 'there';

  switch (notificationType) {
    case 'booking_confirmed':
      return `SALO: Hi ${clientName}, your ${serviceName} is confirmed for ${bookingDate} at ${bookingTime}.`;
    case 'booking_cancelled':
      return `SALO: Hi ${clientName}, your ${serviceName} on ${bookingDate} at ${bookingTime} was cancelled.`;
    case 'booking_rescheduled':
      return `SALO: Hi ${clientName}, your ${serviceName} was rescheduled to ${bookingDate} at ${bookingTime}.`;
    case 'reminder_24h':
      return `SALO: Reminder — your ${serviceName} is tomorrow (${bookingDate}) at ${bookingTime}.`;
    case 'reminder_2h':
      return `SALO: Reminder — your ${serviceName} starts in about 2 hours (${bookingTime}).`;
    default:
      return `SALO: Update for your ${serviceName} on ${bookingDate} at ${bookingTime}.`;
  }
}
