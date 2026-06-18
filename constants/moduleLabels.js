export const MODULE_LABELS = {
  core_booking: 'Appointments',
  client_profiles: 'Client profiles',
  staff_management: 'Staff management',
  public_booking: 'Online booking',
  payments: 'Payments & deposits',
  calendar_sync: 'Calendar sync',
  notification_center: 'Notification center',
  sms_reminders: 'SMS reminders',
  reception_desk: 'Reception desk',
  loyalty: 'Loyalty',
  memberships: 'Memberships',
  marketing: 'Marketing',
  analytics: 'Analytics',
  ai_assistant: 'AI assistant',
  ai_receptionist: 'AI receptionist',
};

export function getModuleLabel(moduleKey) {
  const key = String(moduleKey || '').trim();

  if (!key) {
    return '';
  }

  if (MODULE_LABELS[key]) {
    return MODULE_LABELS[key];
  }

  return key
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
