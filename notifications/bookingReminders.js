import * as Notifications from 'expo-notifications';

const REMINDER_TYPE = 'booking-reminder';
const REMINDER_LEAD_MINUTES = 60;

function parseBookingDateTime(booking) {
  if (!booking?.date || !booking?.time) {
    return null;
  }

  const dateParts = booking.date.split('-').map((part) => Number(part));
  if (dateParts.length !== 3 || dateParts.some((part) => Number.isNaN(part))) {
    return null;
  }

  const timeParts = booking.time.split(':').map((part) => Number(part));
  if (timeParts.length < 2 || Number.isNaN(timeParts[0]) || Number.isNaN(timeParts[1])) {
    return null;
  }

  const [year, month, day] = dateParts;
  const [hours, minutes] = timeParts;

  return new Date(year, month - 1, day, hours, minutes, 0, 0);
}

function getReminderBody(booking) {
  return `${booking.service} with ${booking.client_name} at ${booking.time}`;
}

export async function getNotificationPermissionStatus() {
  const permissions = await Notifications.getPermissionsAsync();
  return permissions.status;
}

export async function requestNotificationPermissions() {
  const currentPermissions = await Notifications.getPermissionsAsync();
  if (currentPermissions.status === 'granted') {
    return 'granted';
  }

  const requestedPermissions = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: true,
      allowSound: true,
    },
  });

  return requestedPermissions.status;
}

export async function cancelBookingReminders() {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();

  await Promise.all(
    scheduled
      .filter((item) => item.content?.data?.type === REMINDER_TYPE)
      .map((item) => Notifications.cancelScheduledNotificationAsync(item.identifier))
  );
}

export async function syncBookingReminders(bookings, { soundEnabled = true } = {}) {
  const permissions = await Notifications.getPermissionsAsync();
  if (permissions.status !== 'granted') {
    return;
  }

  await cancelBookingReminders();

  const now = new Date();

  const upcomingBookings = (bookings || [])
    .map((booking) => ({
      booking,
      appointmentDate: parseBookingDateTime(booking),
    }))
    .filter((item) => item.appointmentDate && item.appointmentDate > now);

  await Promise.all(
    upcomingBookings.map(async ({ booking, appointmentDate }) => {
      const triggerDate = new Date(
        appointmentDate.getTime() - REMINDER_LEAD_MINUTES * 60 * 1000
      );

      if (triggerDate <= now) {
        return;
      }

      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'SALO appointment reminder',
          body: getReminderBody(booking),
          sound: soundEnabled,
          data: {
            type: REMINDER_TYPE,
            bookingId: booking.id,
          },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: triggerDate,
        },
      });
    })
  );
}
