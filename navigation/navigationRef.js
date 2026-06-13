import { createNavigationContainerRef } from '@react-navigation/native';

import { ROUTES } from '../constants/routes';

export const navigationRef = createNavigationContainerRef();

export function navigateFromNotificationData(data) {
  if (!navigationRef.isReady()) {
    return false;
  }

  const bookingId = data?.bookingId;

  if (bookingId) {
    navigationRef.navigate(ROUTES.BookingDetail, { bookingId });
    return true;
  }

  navigationRef.navigate(ROUTES.MainTabs, {
    screen: ROUTES.Bookings,
  });
  return true;
}
