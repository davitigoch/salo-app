import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Dimensions,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import ScreenContainer from '../components/ScreenContainer';
import { COLORS } from '../constants/colors';
import { useBookings } from '../context/BookingsContext';

const DAY_MS = 24 * 60 * 60 * 1000;
const SCREEN_WIDTH = Dimensions.get('window').width;
const CARD_WIDTH = Math.max(SCREEN_WIDTH - 56, 260);

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

function toDisplayDay(dateValue) {
  return dateValue.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function AppointmentCard({ booking }) {
  return (
    <TouchableOpacity
      onPress={() => {
        Alert.alert(
          booking.service,
          `${booking.client_name}\n${booking.date} at ${booking.time}${
            booking.notes ? `\n\n${booking.notes}` : ''
          }`
        );
      }}
      style={{
        backgroundColor: '#1E1E25',
        borderColor: '#2A2A33',
        borderWidth: 1,
        borderRadius: 16,
        padding: 14,
        marginTop: 12,
      }}
    >
      <Text
        style={{
          color: COLORS.textPrimary,
          fontSize: 16,
          fontWeight: '700',
        }}
      >
        {booking.service}
      </Text>
      <Text
        style={{
          color: COLORS.accent,
          marginTop: 4,
          fontWeight: '600',
        }}
      >
        {booking.time}
      </Text>
      <Text
        style={{
          color: COLORS.textSecondary,
          marginTop: 5,
        }}
      >
        {booking.client_name}
      </Text>
      <Text
        style={{
          color: COLORS.textSecondary,
          marginTop: 3,
          fontSize: 12,
        }}
      >
        {booking.notes || 'No additional notes'}
      </Text>
    </TouchableOpacity>
  );
}

export default function WeeklyCalendarScreen() {
  const { bookings, fetchBookings, isBookingsLoading, bookingsError } = useBookings();
  const horizontalScrollRef = useRef(null);
  const [selectedWeekStart, setSelectedWeekStart] = useState(() =>
    getStartOfWeek(new Date())
  );

  useEffect(() => {
    if (horizontalScrollRef.current) {
      horizontalScrollRef.current.scrollTo({ x: 0, animated: true });
    }
  }, [selectedWeekStart]);

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

  const goToPreviousWeek = () => {
    setSelectedWeekStart(
      (previous) => new Date(previous.getTime() - 7 * DAY_MS)
    );
  };

  const goToNextWeek = () => {
    setSelectedWeekStart(
      (previous) => new Date(previous.getTime() + 7 * DAY_MS)
    );
  };

  const weeklyDays = useMemo(() => {
    return Array.from({ length: 7 }).map((_, index) => {
      const dayDate = new Date(selectedWeekStart.getTime() + index * DAY_MS);
      const key = formatDateKey(dayDate);
      return {
        key,
        label: toDisplayDay(dayDate),
        bookings: [],
      };
    });
  }, [selectedWeekStart]);

  const dayCards = useMemo(() => {
    const dayMap = new Map(weeklyDays.map((day) => [day.key, { ...day, bookings: [] }]));

    bookings.forEach((booking) => {
      const parsedDate = parseBookingDate(booking.date);
      if (!parsedDate) {
        return;
      }
      const key = formatDateKey(parsedDate);
      const day = dayMap.get(key);
      if (day) {
        day.bookings.push(booking);
      }
    });

    return Array.from(dayMap.values()).map((day) => ({
      ...day,
      bookings: day.bookings.sort((a, b) => a.time.localeCompare(b.time)),
    }));
  }, [bookings, weeklyDays]);

  return (
    <ScreenContainer
      style={{
        paddingTop: 68,
      }}
    >
      <View style={{ paddingHorizontal: 24 }}>
        <Text
          style={{
            color: COLORS.textPrimary,
            fontSize: 30,
            fontWeight: '700',
          }}
        >
          Weekly Calendar
        </Text>
        <Text
          style={{
            color: COLORS.textSecondary,
            marginTop: 8,
            marginBottom: 12,
          }}
        >
          Swipe through this week's appointments
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
            <Text
              style={{
                color: COLORS.textPrimary,
                fontWeight: '600',
              }}
            >
              Prev
            </Text>
          </TouchableOpacity>

          <Text
            style={{
              color: COLORS.textSecondary,
              fontWeight: '600',
            }}
          >
            {weekRangeLabel}
          </Text>

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
            <Text
              style={{
                color: COLORS.textPrimary,
                fontWeight: '600',
              }}
            >
              Next
            </Text>
          </TouchableOpacity>
        </View>

        {isBookingsLoading ? (
          <Text style={{ color: COLORS.textSecondary, marginBottom: 12 }}>
            Loading appointments...
          </Text>
        ) : null}

        {bookingsError ? (
          <Text style={{ color: '#FCA5A5', marginBottom: 12 }}>{bookingsError}</Text>
        ) : null}
      </View>

      <ScrollView
        ref={horizontalScrollRef}
        horizontal
        pagingEnabled
        decelerationRate="fast"
        snapToInterval={CARD_WIDTH + 14}
        snapToAlignment="start"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingBottom: 24,
        }}
      >
        {dayCards.map((day) => (
          <View
            key={day.key}
            style={{
              width: CARD_WIDTH,
              backgroundColor: COLORS.card,
              borderRadius: 20,
              padding: 18,
              marginRight: 14,
              borderWidth: 1,
              borderColor: '#2D2D38',
            }}
          >
            <Text
              style={{
                color: COLORS.textPrimary,
                fontSize: 20,
                fontWeight: '700',
              }}
            >
              {day.label}
            </Text>

            <Text
              style={{
                color: COLORS.textSecondary,
                marginTop: 4,
                marginBottom: 8,
              }}
            >
              {day.bookings.length
                ? `${day.bookings.length} appointment${day.bookings.length > 1 ? 's' : ''}`
                : 'No appointments'}
            </Text>

            <ScrollView
              showsVerticalScrollIndicator={false}
              style={{ maxHeight: 470 }}
              contentContainerStyle={{ paddingBottom: 8 }}
            >
              {day.bookings.length ? (
                day.bookings.map((booking) => (
                  <AppointmentCard key={booking.id} booking={booking} />
                ))
              ) : (
                <View
                  style={{
                    marginTop: 10,
                    backgroundColor: '#15151B',
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: '#27272A',
                    padding: 16,
                  }}
                >
                  <Text style={{ color: COLORS.textSecondary }}>
                    No bookings scheduled for this day.
                  </Text>
                </View>
              )}
            </ScrollView>
          </View>
        ))}
      </ScrollView>
    </ScreenContainer>
  );
}
