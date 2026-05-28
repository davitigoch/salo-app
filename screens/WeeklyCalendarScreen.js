import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import BackButton from '../components/BackButton';
import ScreenContainer from '../components/ScreenContainer';
import { COLORS } from '../constants/colors';
import { useBookings } from '../context/BookingsContext';
import { useStaff } from '../context/StaffContext';

const DAY_MS = 24 * 60 * 60 * 1000;

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getStartOfWeek(baseDate) {
  const date = new Date(baseDate);
  date.setHours(0, 0, 0, 0);
  const dayOfWeek = date.getDay();
  const diffToMonday = (dayOfWeek + 6) % 7;
  date.setDate(date.getDate() - diffToMonday);
  return date;
}

function parseBookingDate(dateValue) {
  const parsed = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function toDayLabel(dateValue) {
  return dateValue.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
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

function AppointmentRow({ booking, staffName }) {
  const status = booking.status || 'confirmed';
  const statusStyles = getStatusStyles(status);

  return (
    <TouchableOpacity
      onPress={() => {
        Alert.alert(
          booking.service,
          `${booking.client_name}\n${booking.date} at ${booking.time}${
            staffName ? `\nStaff: ${staffName}` : ''
          }${booking.notes ? `\n\n${booking.notes}` : ''}`
        );
      }}
      style={{
        backgroundColor: '#17171D',
        borderColor: '#2A2A33',
        borderWidth: 1,
        borderRadius: 16,
        padding: 14,
        marginTop: 10,
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={{ color: COLORS.accent, fontWeight: '700', fontSize: 15 }}>{booking.time}</Text>
          <Text style={{ color: COLORS.textPrimary, fontSize: 16, fontWeight: '700', marginTop: 4 }}>
            {booking.service}
          </Text>
          <Text style={{ color: COLORS.textSecondary, marginTop: 4 }}>{booking.client_name}</Text>
          {staffName ? (
            <Text style={{ color: COLORS.textSecondary, marginTop: 3, fontSize: 12 }}>
              Staff: {staffName}
            </Text>
          ) : null}
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

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
        <Text style={{ color: COLORS.textSecondary, fontSize: 12 }}>
          {booking.notes || 'No additional notes'}
        </Text>
        <Text style={{ color: COLORS.accent, fontWeight: '700' }}>{formatPrice(booking.price)}</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function WeeklyCalendarScreen({ navigation }) {
  const { bookings, fetchBookings, isBookingsLoading, bookingsError } = useBookings();
  const { staff } = useStaff();
  const [selectedWeekStart, setSelectedWeekStart] = useState(() => getStartOfWeek(new Date()));

  useFocusEffect(
    React.useCallback(() => {
      fetchBookings();
    }, [fetchBookings])
  );

  const weekRangeLabel = useMemo(() => {
    const weekEnd = new Date(selectedWeekStart.getTime() + 6 * DAY_MS);
    const startLabel = selectedWeekStart.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
    const endLabel = weekEnd.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

    return `${startLabel} - ${endLabel}`;
  }, [selectedWeekStart]);

  const dayCards = useMemo(() => {
    const weeklyDays = Array.from({ length: 7 }).map((_, index) => {
      const dayDate = new Date(selectedWeekStart.getTime() + index * DAY_MS);
      return {
        key: formatDateKey(dayDate),
        date: dayDate,
        label: toDayLabel(dayDate),
        bookings: [],
      };
    });

    const dayMap = new Map(weeklyDays.map((day) => [day.key, day]));

    bookings.forEach((booking) => {
      const parsedDate = parseBookingDate(booking.date);
      if (!parsedDate) {
        return;
      }

      const day = dayMap.get(formatDateKey(parsedDate));
      if (day) {
        day.bookings.push(booking);
      }
    });

    return weeklyDays.map((day) => ({
      ...day,
      bookings: day.bookings.sort((a, b) => a.time.localeCompare(b.time)),
    }));
  }, [bookings, selectedWeekStart]);

  const goToPreviousWeek = () => {
    setSelectedWeekStart((previous) => new Date(previous.getTime() - 7 * DAY_MS));
  };

  const goToNextWeek = () => {
    setSelectedWeekStart((previous) => new Date(previous.getTime() + 7 * DAY_MS));
  };

  return (
    <ScreenContainer style={{ padding: 0 }}>
      <BackButton navigation={navigation} />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 88, paddingBottom: 140 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={{ color: COLORS.textPrimary, fontSize: 30, fontWeight: '700' }}>
          Weekly Calendar
        </Text>
        <Text style={{ color: COLORS.textSecondary, marginTop: 8, marginBottom: 14 }}>
          All appointments for the selected week.
        </Text>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 14,
          }}
        >
          <TouchableOpacity
            onPress={goToPreviousWeek}
            style={{
              backgroundColor: COLORS.card,
              borderWidth: 1,
              borderColor: '#2D2D38',
              borderRadius: 12,
              paddingHorizontal: 14,
              paddingVertical: 10,
            }}
          >
            <Text style={{ color: COLORS.textPrimary, fontWeight: '600' }}>Prev Week</Text>
          </TouchableOpacity>

          <Text style={{ color: COLORS.textSecondary, fontWeight: '600' }}>{weekRangeLabel}</Text>

          <TouchableOpacity
            onPress={goToNextWeek}
            style={{
              backgroundColor: COLORS.card,
              borderWidth: 1,
              borderColor: '#2D2D38',
              borderRadius: 12,
              paddingHorizontal: 14,
              paddingVertical: 10,
            }}
          >
            <Text style={{ color: COLORS.textPrimary, fontWeight: '600' }}>Next Week</Text>
          </TouchableOpacity>
        </View>

        {isBookingsLoading ? (
          <Text style={{ color: COLORS.textSecondary, marginBottom: 12 }}>Loading appointments...</Text>
        ) : null}

        {bookingsError ? (
          <Text style={{ color: '#FCA5A5', marginBottom: 12 }}>{bookingsError}</Text>
        ) : null}

        {dayCards.map((day) => {
          const appointmentCount = day.bookings.length;
          return (
            <View
              key={day.key}
              style={{
                backgroundColor: COLORS.card,
                borderRadius: 22,
                padding: 18,
                marginBottom: 14,
                borderWidth: 1,
                borderColor: '#2D2D38',
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={{ color: COLORS.textPrimary, fontSize: 20, fontWeight: '700' }}>
                    {day.label}
                  </Text>
                  <Text style={{ color: COLORS.textSecondary, marginTop: 4 }}>
                    {appointmentCount
                      ? `${appointmentCount} appointment${appointmentCount === 1 ? '' : 's'}`
                      : 'No bookings'}
                  </Text>
                </View>
                <View
                  style={{
                    backgroundColor: '#17171D',
                    borderColor: '#2A2A33',
                    borderWidth: 1,
                    borderRadius: 999,
                    paddingHorizontal: 10,
                    paddingVertical: 5,
                  }}
                >
                  <Text style={{ color: COLORS.accent, fontSize: 11, fontWeight: '700' }}>
                    {appointmentCount || 0}
                  </Text>
                </View>
              </View>

              {appointmentCount ? (
                day.bookings.map((booking) => {
                  const staffMember = staff.find((member) => member.id === booking.staff_member_id);
                  return (
                    <AppointmentRow
                      key={booking.id}
                      booking={booking}
                      staffName={staffMember?.name || ''}
                    />
                  );
                })
              ) : (
                <View
                  style={{
                    marginTop: 14,
                    backgroundColor: '#15151B',
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: '#27272A',
                    padding: 16,
                  }}
                >
                  <Text style={{ color: COLORS.textSecondary }}>No bookings</Text>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
    </ScreenContainer>
  );
}
