import React, { useMemo, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import BackButton from '../components/BackButton';
import ScreenContainer from '../components/ScreenContainer';
import { formatTimeDisplay, normalizeBusinessHours, timeToMinutes } from '../constants/availability';
import { COLORS } from '../constants/colors';
import { useAuth } from '../context/AuthContext';
import { useBookings } from '../context/BookingsContext';
import { useStaff } from '../context/StaffContext';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MINUTES = 60;

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseBookingDate(dateValue) {
  const parsed = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function getStatusStyles(status) {
  switch (status) {
    case 'pending':
      return { background: '#2B2310', text: '#FDE68A', border: '#5B4B1A' };
    case 'confirmed':
      return { background: '#122A42', text: '#93C5FD', border: '#25476B' };
    case 'completed':
      return { background: '#153325', text: '#86EFAC', border: '#1F4A34' };
    case 'cancelled':
      return { background: '#342023', text: '#FCA5A5', border: '#5A252A' };
    case 'no_show':
      return { background: '#301F35', text: '#D8B4FE', border: '#5B2C69' };
    default:
      return { background: '#122A42', text: '#93C5FD', border: '#25476B' };
  }
}

function formatPrice(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function formatHourLabel(totalMinutes) {
  const hour24 = Math.floor(totalMinutes / 60);
  const minute = String(totalMinutes % 60).padStart(2, '0');
  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${minute} ${suffix}`;
}

function formatFullDate(date) {
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function BookingCard({ booking, staffName }) {
  const status = booking.status || 'confirmed';
  const statusStyles = getStatusStyles(status);

  return (
    <View
      style={{
        backgroundColor: '#181820',
        borderColor: '#2E2B4A',
        borderWidth: 1,
        borderRadius: 14,
        padding: 12,
        marginTop: 8,
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, paddingRight: 10 }}>
          <Text style={{ color: COLORS.accent, fontWeight: '700', fontSize: 13 }}>{booking.time}</Text>
          <Text style={{ color: COLORS.textPrimary, fontSize: 15, fontWeight: '700', marginTop: 2 }}>
            {booking.service}
          </Text>
          <Text style={{ color: COLORS.textSecondary, marginTop: 3 }}>{booking.client_name}</Text>
          <Text style={{ color: COLORS.textSecondary, marginTop: 2, fontSize: 12 }}>
            {staffName ? `Staff: ${staffName}` : 'Staff: Unassigned'}
          </Text>
        </View>

        <View
          style={{
            backgroundColor: statusStyles.background,
            borderColor: statusStyles.border,
            borderWidth: 1,
            borderRadius: 999,
            paddingHorizontal: 10,
            paddingVertical: 4,
          }}
        >
          <Text style={{ color: statusStyles.text, fontSize: 11, fontWeight: '700' }}>
            {String(status).replace('_', ' ').toUpperCase()}
          </Text>
        </View>
      </View>

      <Text style={{ color: COLORS.accent, marginTop: 8, fontWeight: '700' }}>{formatPrice(booking.price)}</Text>
    </View>
  );
}

export default function DailyScheduleScreen({ navigation }) {
  const { bookings, fetchBookings, isBookingsLoading, bookingsError } = useBookings();
  const { staff } = useStaff();
  const { businessHours } = useAuth();
  const [selectedDate, setSelectedDate] = useState(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now;
  });
  const [selectedStaffId, setSelectedStaffId] = useState('all');

  useFocusEffect(
    React.useCallback(() => {
      fetchBookings();
    }, [fetchBookings])
  );

  const dayHours = useMemo(() => {
    const normalized = normalizeBusinessHours(businessHours || []);
    const dayRule = normalized.find((row) => row.weekday === selectedDate.getDay());

    if (!dayRule || dayRule.is_closed) {
      return {
        isClosed: true,
        openMinutes: 9 * 60,
        closeMinutes: 17 * 60,
        openTime: '09:00',
        closeTime: '17:00',
      };
    }

    const openMinutes = timeToMinutes(dayRule.open_time);
    const closeMinutes = timeToMinutes(dayRule.close_time);

    if (openMinutes === null || closeMinutes === null || closeMinutes <= openMinutes) {
      return {
        isClosed: true,
        openMinutes: 9 * 60,
        closeMinutes: 17 * 60,
        openTime: '09:00',
        closeTime: '17:00',
      };
    }

    return {
      isClosed: false,
      openMinutes,
      closeMinutes,
      openTime: dayRule.open_time,
      closeTime: dayRule.close_time,
    };
  }, [businessHours, selectedDate]);

  const staffOptions = useMemo(() => {
    const activeStaff = (staff || []).filter((member) => member.is_active !== false);
    return [{ id: 'all', label: 'All staff' }].concat(
      activeStaff.map((member) => ({ id: member.id, label: member.name }))
    );
  }, [staff]);

  const staffLookup = useMemo(() => {
    return new Map((staff || []).map((member) => [member.id, member.name]));
  }, [staff]);

  const dayBookings = useMemo(() => {
    const dateKey = toDateKey(selectedDate);

    return bookings
      .filter((booking) => {
        const parsedDate = parseBookingDate(booking.date);
        if (!parsedDate) {
          return false;
        }

        if (toDateKey(parsedDate) !== dateKey) {
          return false;
        }

        if (selectedStaffId === 'all') {
          return true;
        }

        return booking.staff_member_id === selectedStaffId;
      })
      .sort((a, b) => {
        const left = timeToMinutes(a.time) ?? 0;
        const right = timeToMinutes(b.time) ?? 0;
        return left - right;
      });
  }, [bookings, selectedDate, selectedStaffId]);

  const slotMap = useMemo(() => {
    const byHour = new Map();

    dayBookings.forEach((booking) => {
      const minutes = timeToMinutes(booking.time);
      if (minutes === null) {
        return;
      }

      if (minutes < dayHours.openMinutes || minutes >= dayHours.closeMinutes) {
        return;
      }

      const slotStart = Math.floor(minutes / 60) * 60;
      if (!byHour.has(slotStart)) {
        byHour.set(slotStart, []);
      }
      byHour.get(slotStart).push(booking);
    });

    return byHour;
  }, [dayBookings, dayHours.closeMinutes, dayHours.openMinutes]);

  const hourlySlots = useMemo(() => {
    const slots = [];
    const slotStart = Math.floor(dayHours.openMinutes / HOUR_MINUTES) * HOUR_MINUTES;
    const slotEnd = Math.ceil(dayHours.closeMinutes / HOUR_MINUTES) * HOUR_MINUTES;

    for (let minute = slotStart; minute < slotEnd; minute += HOUR_MINUTES) {
      slots.push(minute);
    }
    return slots;
  }, [dayHours.closeMinutes, dayHours.openMinutes]);

  const goPrevDay = () => {
    setSelectedDate((previous) => new Date(previous.getTime() - DAY_MS));
  };

  const goNextDay = () => {
    setSelectedDate((previous) => new Date(previous.getTime() + DAY_MS));
  };

  return (
    <ScreenContainer style={{ padding: 0 }}>
      <BackButton navigation={navigation} />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 88, paddingBottom: 140 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={{ color: COLORS.textPrimary, fontSize: 30, fontWeight: '700' }}>Daily Schedule</Text>
        <Text style={{ color: COLORS.textSecondary, marginTop: 8 }}>{formatFullDate(selectedDate)}</Text>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 16,
            marginBottom: 12,
          }}
        >
          <TouchableOpacity
            onPress={goPrevDay}
            style={{
              backgroundColor: COLORS.card,
              borderWidth: 1,
              borderColor: '#2D2D38',
              borderRadius: 12,
              paddingHorizontal: 14,
              paddingVertical: 10,
            }}
          >
            <Text style={{ color: COLORS.textPrimary, fontWeight: '600' }}>Prev Day</Text>
          </TouchableOpacity>

          <Text style={{ color: COLORS.textSecondary, fontWeight: '600' }}>
            {formatTimeDisplay(dayHours.openTime)} - {formatTimeDisplay(dayHours.closeTime)}
          </Text>

          <TouchableOpacity
            onPress={goNextDay}
            style={{
              backgroundColor: COLORS.card,
              borderWidth: 1,
              borderColor: '#2D2D38',
              borderRadius: 12,
              paddingHorizontal: 14,
              paddingVertical: 10,
            }}
          >
            <Text style={{ color: COLORS.textPrimary, fontWeight: '600' }}>Next Day</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 8 }}
          style={{ marginBottom: 14 }}
        >
          {staffOptions.map((option) => {
            const isSelected = selectedStaffId === option.id;
            return (
              <TouchableOpacity
                key={option.id}
                onPress={() => setSelectedStaffId(option.id)}
                style={{
                  backgroundColor: isSelected ? COLORS.accent : '#17171D',
                  borderColor: isSelected ? '#8B5CF6' : '#2A2A33',
                  borderWidth: 1,
                  borderRadius: 999,
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  marginRight: 8,
                }}
              >
                <Text
                  style={{
                    color: isSelected ? '#FFFFFF' : COLORS.textSecondary,
                    fontWeight: '700',
                    fontSize: 12,
                  }}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {isBookingsLoading ? (
          <Text style={{ color: COLORS.textSecondary, marginBottom: 12 }}>Loading appointments...</Text>
        ) : null}

        {bookingsError ? (
          <Text style={{ color: '#FCA5A5', marginBottom: 12 }}>{bookingsError}</Text>
        ) : null}

        {dayHours.isClosed ? (
          <View
            style={{
              backgroundColor: '#15151B',
              borderColor: '#2D2D38',
              borderWidth: 1,
              borderRadius: 16,
              padding: 18,
            }}
          >
            <Text style={{ color: COLORS.textPrimary, fontWeight: '700' }}>Business Closed</Text>
            <Text style={{ color: COLORS.textSecondary, marginTop: 6 }}>
              This day is marked closed in business hours.
            </Text>
          </View>
        ) : (
          hourlySlots.map((slotMinute) => {
            const slotBookings = slotMap.get(slotMinute) || [];
            return (
              <View
                key={slotMinute}
                style={{
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: '#272734',
                  backgroundColor: '#121218',
                  marginBottom: 10,
                  overflow: 'hidden',
                }}
              >
                <View
                  style={{
                    backgroundColor: '#171723',
                    paddingHorizontal: 14,
                    paddingVertical: 8,
                    borderBottomWidth: 1,
                    borderBottomColor: '#2D2D38',
                  }}
                >
                  <Text style={{ color: COLORS.textSecondary, fontSize: 12, fontWeight: '700' }}>
                    {formatHourLabel(slotMinute)}
                  </Text>
                </View>

                <View style={{ paddingHorizontal: 12, paddingVertical: 10 }}>
                  {slotBookings.length ? (
                    slotBookings.map((booking) => (
                      <BookingCard
                        key={booking.id}
                        booking={booking}
                        staffName={staffLookup.get(booking.staff_member_id) || ''}
                      />
                    ))
                  ) : (
                    <View
                      style={{
                        borderColor: '#2A2A35',
                        borderWidth: 1,
                        borderStyle: 'dashed',
                        borderRadius: 10,
                        paddingVertical: 12,
                        paddingHorizontal: 10,
                        backgroundColor: '#12121A',
                      }}
                    >
                      <Text style={{ color: '#6D6D7A', fontSize: 12 }}>No appointments</Text>
                    </View>
                  )}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
