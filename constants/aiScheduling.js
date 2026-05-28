import {
  buildBookedIntervals,
  parseTimeToMinutes,
} from './bookingSlots';
import {
  normalizeBusinessHours,
  timeToMinutes,
} from './availability';

function getDayRule(businessHours, date) {
  const weekday = date.getDay();
  return normalizeBusinessHours(businessHours).find((row) => row.weekday === weekday) || null;
}

function getStaffRule(staffAvailability, staffId, weekday) {
  return (staffAvailability || []).find(
    (row) => row.staff_member_id === staffId && row.weekday === weekday
  );
}

function getActiveStaff(staffMembers) {
  return (staffMembers || []).filter((member) => member.is_active !== false);
}

function getStaffWorkloadMap(bookings, activeStaff, excludeBookingId) {
  const map = new Map(activeStaff.map((member) => [member.id, 0]));

  (bookings || []).forEach((booking) => {
    if (booking?.id === excludeBookingId) {
      return;
    }

    const status = booking?.status || 'confirmed';
    if (status === 'cancelled') {
      return;
    }

    const staffId = booking?.staff_member_id || booking?.booking_metadata?.staff_member_id;
    if (!staffId || !map.has(staffId)) {
      return;
    }

    map.set(staffId, (map.get(staffId) || 0) + 1);
  });

  return map;
}

function isSlotFreeForStaff({
  slotStart,
  slotEnd,
  staffId,
  intervals,
}) {
  const overlaps = intervals.some((interval) => {
    const blocksThisStaff = interval.staffMemberId === null || interval.staffMemberId === staffId;
    return blocksThisStaff && slotStart < interval.endMinutes && slotEnd > interval.startMinutes;
  });

  return !overlaps;
}

function getEligibleStaffForSlot({
  slotValue,
  date,
  businessHours,
  staffMembers,
  staffAvailability,
  existingBookings,
  serviceDurationMinutes,
  selectedStaffId,
  excludeBookingId,
}) {
  const slotStart = parseTimeToMinutes(slotValue);
  if (slotStart === null) {
    return [];
  }

  const duration = Number(serviceDurationMinutes);
  if (Number.isNaN(duration) || duration <= 0) {
    return [];
  }

  const slotEnd = slotStart + duration;
  const dayRule = getDayRule(businessHours, date);
  if (!dayRule || dayRule.is_closed) {
    return [];
  }

  const businessOpen = timeToMinutes(dayRule.open_time);
  const businessClose = timeToMinutes(dayRule.close_time);
  if (businessOpen === null || businessClose === null) {
    return [];
  }

  const activeStaff = getActiveStaff(staffMembers);
  const candidateStaff = selectedStaffId
    ? activeStaff.filter((member) => member.id === selectedStaffId)
    : activeStaff;

  const weekday = date.getDay();
  const intervals = buildBookedIntervals(existingBookings, excludeBookingId);

  return candidateStaff.filter((member) => {
    const rule = getStaffRule(staffAvailability, member.id, weekday);

    let openMinutes = businessOpen;
    let closeMinutes = businessClose;

    if (rule) {
      if (rule.is_closed) {
        return false;
      }

      const staffOpen = timeToMinutes(rule.open_time);
      const staffClose = timeToMinutes(rule.close_time);
      if (staffOpen === null || staffClose === null || staffClose <= staffOpen) {
        return false;
      }

      openMinutes = Math.max(openMinutes, staffOpen);
      closeMinutes = Math.min(closeMinutes, staffClose);
    }

    if (slotStart < openMinutes || slotEnd > closeMinutes) {
      return false;
    }

    return isSlotFreeForStaff({
      slotStart,
      slotEnd,
      staffId: member.id,
      intervals,
    });
  });
}

function buildReasoning({ type, slot, eligibleStaff, staffWorkloadMap, staffId }) {
  const totalEligible = eligibleStaff.length;
  const avgLoad = totalEligible
    ? Number(
      (
        eligibleStaff.reduce((sum, member) => sum + (staffWorkloadMap.get(member.id) || 0), 0) / totalEligible
      ).toFixed(2)
    )
    : null;

  const selectedLoad = staffId ? staffWorkloadMap.get(staffId) || 0 : null;

  return {
    recommendation_type: type,
    slot_value: slot.value,
    slot_label: slot.label,
    eligible_staff_count: totalEligible,
    eligible_staff_ids: eligibleStaff.map((member) => member.id),
    selected_staff_id: staffId || null,
    selected_staff_workload: selectedLoad,
    average_workload_for_slot: avgLoad,
  };
}

export function getDeterministicSchedulingRecommendations({
  date,
  slots,
  businessHours,
  staffMembers,
  selectedStaffId,
  staffAvailability,
  existingBookings,
  serviceDurationMinutes,
  excludeBookingId,
}) {
  if (!date || !Array.isArray(slots) || !slots.length) {
    return [];
  }

  const activeStaff = getActiveStaff(staffMembers);
  const staffWorkloadMap = getStaffWorkloadMap(existingBookings, activeStaff, excludeBookingId);

  const evaluated = slots
    .map((slot) => {
      const startMinutes = parseTimeToMinutes(slot.value);
      const eligibleStaff = getEligibleStaffForSlot({
        slotValue: slot.value,
        date,
        businessHours,
        staffMembers,
        staffAvailability,
        existingBookings,
        serviceDurationMinutes,
        selectedStaffId,
        excludeBookingId,
      });

      if (startMinutes === null || !eligibleStaff.length) {
        return null;
      }

      const workloadAverage = eligibleStaff.reduce(
        (sum, member) => sum + (staffWorkloadMap.get(member.id) || 0),
        0
      ) / eligibleStaff.length;

      return {
        slot,
        startMinutes,
        eligibleStaff,
        workloadAverage,
      };
    })
    .filter(Boolean);

  if (!evaluated.length) {
    return [];
  }

  const fastest = evaluated.reduce((best, item) => {
    if (!best || item.startMinutes < best.startMinutes) {
      return item;
    }
    return best;
  }, null);

  const bestAvailable = evaluated.reduce((best, item) => {
    if (!best) {
      return item;
    }

    if (item.eligibleStaff.length > best.eligibleStaff.length) {
      return item;
    }

    if (item.eligibleStaff.length < best.eligibleStaff.length) {
      return best;
    }

    if (item.workloadAverage < best.workloadAverage) {
      return item;
    }

    if (item.workloadAverage > best.workloadAverage) {
      return best;
    }

    return item.startMinutes < best.startMinutes ? item : best;
  }, null);

  let preferredStaffId = selectedStaffId || null;
  if (!preferredStaffId && activeStaff.length) {
    preferredStaffId = activeStaff
      .slice()
      .sort((a, b) => {
        const loadDiff = (staffWorkloadMap.get(a.id) || 0) - (staffWorkloadMap.get(b.id) || 0);
        if (loadDiff !== 0) {
          return loadDiff;
        }
        return a.name.localeCompare(b.name);
      })[0].id;
  }

  let preferred = null;
  if (preferredStaffId) {
    preferred = evaluated.find((item) =>
      item.eligibleStaff.some((member) => member.id === preferredStaffId)
    ) || null;
  }

  const recommendations = [];

  if (bestAvailable) {
    const topStaff = bestAvailable.eligibleStaff
      .slice()
      .sort((a, b) => {
        const diff = (staffWorkloadMap.get(a.id) || 0) - (staffWorkloadMap.get(b.id) || 0);
        if (diff !== 0) {
          return diff;
        }
        return a.name.localeCompare(b.name);
      })[0];

    recommendations.push({
      type: 'best_available',
      title: 'Best Available',
      subtitle: `Balanced availability across ${bestAvailable.eligibleStaff.length} staff`,
      slotValue: bestAvailable.slot.value,
      slotLabel: bestAvailable.slot.label,
      staffId: topStaff?.id || null,
      staffName: topStaff?.name || null,
      reasoning: buildReasoning({
        type: 'best_available',
        slot: bestAvailable.slot,
        eligibleStaff: bestAvailable.eligibleStaff,
        staffWorkloadMap,
        staffId: topStaff?.id || null,
      }),
    });
  }

  if (fastest) {
    const topStaff = fastest.eligibleStaff
      .slice()
      .sort((a, b) => {
        const diff = (staffWorkloadMap.get(a.id) || 0) - (staffWorkloadMap.get(b.id) || 0);
        if (diff !== 0) {
          return diff;
        }
        return a.name.localeCompare(b.name);
      })[0];

    recommendations.push({
      type: 'fastest_appointment',
      title: 'Fastest Appointment',
      subtitle: 'Earliest deterministic open slot',
      slotValue: fastest.slot.value,
      slotLabel: fastest.slot.label,
      staffId: topStaff?.id || null,
      staffName: topStaff?.name || null,
      reasoning: buildReasoning({
        type: 'fastest_appointment',
        slot: fastest.slot,
        eligibleStaff: fastest.eligibleStaff,
        staffWorkloadMap,
        staffId: topStaff?.id || null,
      }),
    });
  }

  if (preferred) {
    const preferredMember = activeStaff.find((member) => member.id === preferredStaffId) || null;
    recommendations.push({
      type: 'preferred_staff',
      title: 'Preferred Staff',
      subtitle: preferredMember
        ? `Optimized around ${preferredMember.name}`
        : 'Optimized around selected team member',
      slotValue: preferred.slot.value,
      slotLabel: preferred.slot.label,
      staffId: preferredMember?.id || preferredStaffId,
      staffName: preferredMember?.name || null,
      reasoning: buildReasoning({
        type: 'preferred_staff',
        slot: preferred.slot,
        eligibleStaff: preferred.eligibleStaff,
        staffWorkloadMap,
        staffId: preferredMember?.id || preferredStaffId,
      }),
    });
  }

  const deduped = [];
  const seenTypes = new Set();
  recommendations.forEach((item) => {
    if (seenTypes.has(item.type)) {
      return;
    }
    seenTypes.add(item.type);
    deduped.push(item);
  });

  return deduped;
}
