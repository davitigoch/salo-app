import {
  formatTimeDisplay,
  normalizeBusinessHours,
  timeToMinutes,
  WEEKDAY_LABELS,
} from './availability';

export function formatDateValue(value) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function minutesToTimeString(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function parseTimeToMinutes(value) {
  if (!value) {
    return null;
  }

  const strict = timeToMinutes(String(value));
  if (strict !== null) {
    return strict;
  }

  const lowerValue = String(value).trim().toLowerCase();
  const twelveHour = lowerValue.match(/^(\d{1,2}):(\d{2})\s?(am|pm)$/);
  if (twelveHour) {
    const hourValue = Number(twelveHour[1]);
    const minuteValue = Number(twelveHour[2]);
    const period = twelveHour[3];
    const normalizedHour =
      period === 'pm' && hourValue < 12
        ? hourValue + 12
        : period === 'am' && hourValue === 12
          ? 0
          : hourValue;

    if (!Number.isNaN(normalizedHour) && !Number.isNaN(minuteValue)) {
      return normalizedHour * 60 + minuteValue;
    }
  }

  return null;
}

export function getBookingDurationMinutes(booking, fallbackDuration = 60) {
  const metadataDuration = Number(booking?.booking_metadata?.service_duration_minutes);
  if (!Number.isNaN(metadataDuration) && metadataDuration > 0) {
    return metadataDuration;
  }

  const rawDuration = Number(booking?.duration_minutes);
  if (!Number.isNaN(rawDuration) && rawDuration > 0) {
    return rawDuration;
  }

  return fallbackDuration;
}

export function buildBookedIntervals(bookings, excludeBookingId) {
  return (bookings || [])
    .filter((booking) => booking?.id !== excludeBookingId)
    .map((booking) => {
      const startMinutes = parseTimeToMinutes(booking?.time);
      const duration = getBookingDurationMinutes(booking);

      if (startMinutes === null || duration <= 0) {
        return null;
      }

      return {
        id: booking.id,
        startMinutes,
        endMinutes: startMinutes + duration,
        staffMemberId: booking?.staff_member_id || booking?.booking_metadata?.staff_member_id || null,
      };
    })
    .filter(Boolean);
}

function normalizeStaffAvailability(rows) {
  return (rows || []).map((row) => ({
    staff_member_id: row.staff_member_id,
    weekday: row.weekday,
    is_closed: Boolean(row.is_closed),
    open_time: row.open_time,
    close_time: row.close_time,
  }));
}

function getStaffDayRule(staffAvailability, staffId, weekday) {
  return normalizeStaffAvailability(staffAvailability).find(
    (row) => row.staff_member_id === staffId && row.weekday === weekday
  );
}

function isStaffSlotAvailable({
  staffId,
  startMinutes,
  endMinutes,
  intervals,
}) {
  const overlaps = intervals.some((interval) => {
    const blocksThisStaff = interval.staffMemberId === null || interval.staffMemberId === staffId;
    return blocksThisStaff
      && startMinutes < interval.endMinutes
      && endMinutes > interval.startMinutes;
  });

  return !overlaps;
}

export function generateAvailableTimeSlots({
  businessHours,
  date,
  serviceDurationMinutes,
  existingBookings,
  staffMembers = [],
  selectedStaffId,
  staffAvailability = [],
  stepMinutes = 15,
  excludeBookingId,
}) {
  if (!date) {
    return { slots: [], reason: 'Select a date first.' };
  }

  const duration = Number(serviceDurationMinutes);
  if (Number.isNaN(duration) || duration <= 0) {
    return { slots: [], reason: 'Select a valid service duration first.' };
  }

  const weekday = date.getDay();
  const rules = normalizeBusinessHours(businessHours);
  const dayRule = rules.find((rule) => rule.weekday === weekday);

  if (!dayRule || dayRule.is_closed) {
    return {
      slots: [],
      reason: `${WEEKDAY_LABELS[weekday]} is closed.`,
    };
  }

  const openMinutes = parseTimeToMinutes(dayRule.open_time);
  const closeMinutes = parseTimeToMinutes(dayRule.close_time);

  if (openMinutes === null || closeMinutes === null || closeMinutes <= openMinutes) {
    return {
      slots: [],
      reason: `${WEEKDAY_LABELS[weekday]} has invalid business hours.`,
    };
  }

  if (duration > closeMinutes - openMinutes) {
    return {
      slots: [],
      reason: 'Service duration is longer than available business hours.',
    };
  }

  const intervals = buildBookedIntervals(existingBookings, excludeBookingId);

  const activeStaff = (staffMembers || []).filter((member) => member.is_active !== false);
  const candidateStaffIds = selectedStaffId
    ? [selectedStaffId]
    : activeStaff.map((member) => member.id);

  if (!candidateStaffIds.length) {
    return {
      slots: [],
      reason: 'No active team members are available for booking.',
    };
  }

  const slots = [];

  for (let startMinutes = openMinutes; startMinutes + duration <= closeMinutes; startMinutes += stepMinutes) {
    const endMinutes = startMinutes + duration;

    const isCoveredByStaff = candidateStaffIds.some((staffId) => {
      const staffRule = getStaffDayRule(staffAvailability, staffId, weekday);

      let staffOpen = openMinutes;
      let staffClose = closeMinutes;

      if (staffRule) {
        if (staffRule.is_closed) {
          return false;
        }

        const parsedOpen = parseTimeToMinutes(staffRule.open_time);
        const parsedClose = parseTimeToMinutes(staffRule.close_time);

        if (parsedOpen === null || parsedClose === null || parsedClose <= parsedOpen) {
          return false;
        }

        staffOpen = Math.max(openMinutes, parsedOpen);
        staffClose = Math.min(closeMinutes, parsedClose);
      }

      if (startMinutes < staffOpen || endMinutes > staffClose) {
        return false;
      }

      return isStaffSlotAvailable({
        staffId,
        startMinutes,
        endMinutes,
        intervals,
      });
    });

    if (isCoveredByStaff) {
      const value = minutesToTimeString(startMinutes);
      slots.push({
        value,
        label: formatTimeDisplay(value),
      });
    }
  }

  if (!slots.length) {
    return {
      slots: [],
      reason: selectedStaffId
        ? 'Selected team member has no available slots for this date.'
        : 'No available team slots for this date. Try another date.',
    };
  }

  return { slots, reason: '' };
}
