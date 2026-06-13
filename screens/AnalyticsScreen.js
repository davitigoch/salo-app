import React, { useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';

import BackButton from '../components/BackButton';
import ScreenContainer from '../components/ScreenContainer';
import { COLORS } from '../constants/colors';
import { useBookings } from '../context/BookingsContext';
import { useClients } from '../context/ClientsContext';
import { useStaff } from '../context/StaffContext';
import { computeOwnerAnalytics } from '../utils/analytics';

function SectionCard({ title, children }) {
  return (
    <View
      style={{
        backgroundColor: COLORS.card,
        borderColor: '#2A2A33',
        borderWidth: 1,
        borderRadius: 18,
        padding: 18,
        marginBottom: 14,
      }}
    >
      <Text style={{ color: COLORS.textPrimary, fontSize: 16, fontWeight: '700', marginBottom: 14 }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function MetricRow({ label, value, isLast = false }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 10,
        borderBottomWidth: isLast ? 0 : 1,
        borderBottomColor: '#2A2A33',
      }}
    >
      <Text style={{ color: COLORS.textSecondary, fontSize: 14, flex: 1, paddingRight: 12 }}>
        {label}
      </Text>
      <Text style={{ color: COLORS.textPrimary, fontSize: 16, fontWeight: '700' }}>{value}</Text>
    </View>
  );
}

function PerformerRow({ label, count, subtitle, isLast = false }) {
  return (
    <View
      style={{
        paddingVertical: 12,
        borderBottomWidth: isLast ? 0 : 1,
        borderBottomColor: '#2A2A33',
      }}
    >
      <Text style={{ color: COLORS.textPrimary, fontSize: 16, fontWeight: '700' }}>{label}</Text>
      <Text style={{ color: COLORS.textSecondary, marginTop: 4, fontSize: 13 }}>{subtitle}</Text>
      <Text style={{ color: COLORS.accent, marginTop: 6, fontWeight: '700' }}>
        {count} {count === 1 ? 'booking' : 'bookings'}
      </Text>
    </View>
  );
}

function formatCurrency(value) {
  return `$${Number(value || 0).toFixed(0)}`;
}

export default function AnalyticsScreen({ navigation }) {
  const { bookings, isBookingsLoading } = useBookings();
  const { clients, isClientsLoading } = useClients();
  const { staff, isStaffLoading } = useStaff();

  const analytics = useMemo(
    () =>
      computeOwnerAnalytics({
        bookings,
        clients,
        staff,
      }),
    [bookings, clients, staff]
  );

  const isLoading = isBookingsLoading || isClientsLoading || isStaffLoading;

  return (
    <ScreenContainer style={{ paddingTop: 0 }}>
      <BackButton navigation={navigation} />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 92, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={{ color: COLORS.textPrimary, fontSize: 30, fontWeight: '700' }}>Analytics</Text>
        <Text style={{ color: COLORS.textSecondary, marginTop: 8, marginBottom: 18 }}>
          Owner insights from bookings, clients, and team activity
        </Text>

        {isLoading ? (
          <Text style={{ color: COLORS.textSecondary, marginBottom: 16 }}>Loading analytics...</Text>
        ) : null}

        {!isLoading && !analytics.hasData ? (
          <View
            style={{
              backgroundColor: COLORS.card,
              borderColor: '#2A2A33',
              borderWidth: 1,
              borderRadius: 18,
              padding: 18,
              marginBottom: 14,
            }}
          >
            <Text style={{ color: COLORS.textPrimary, fontWeight: '700', fontSize: 16 }}>
              Analytics will appear once you start receiving bookings.
            </Text>
          </View>
        ) : null}

        {!isLoading && analytics.hasData ? (
          <>
            <SectionCard title="Revenue">
              <MetricRow label="Revenue Today" value={formatCurrency(analytics.revenueToday)} />
              <MetricRow label="Revenue This Week" value={formatCurrency(analytics.revenueThisWeek)} />
              <MetricRow
                label="Revenue This Month"
                value={formatCurrency(analytics.revenueThisMonth)}
                isLast
              />
            </SectionCard>

            <SectionCard title="Appointments">
              <MetricRow label="Appointments Today" value={String(analytics.appointmentsToday)} />
              <MetricRow
                label="Appointments This Week"
                value={String(analytics.appointmentsThisWeek)}
              />
              <MetricRow
                label="Pending Requests"
                value={String(analytics.pendingRequests)}
                isLast
              />
            </SectionCard>

            <SectionCard title="Clients">
              <MetricRow label="New Clients This Month" value={String(analytics.newClientsThisMonth)} />
              <MetricRow label="Total Clients" value={String(analytics.totalClients)} isLast />
            </SectionCard>

            <SectionCard title="Top Performers">
              <PerformerRow
                label={analytics.topService.label}
                count={analytics.topService.count}
                subtitle="Top Service"
              />
              <PerformerRow
                label={analytics.topStaff.label}
                count={analytics.topStaff.count}
                subtitle="Top Staff"
                isLast
              />
            </SectionCard>
          </>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}
