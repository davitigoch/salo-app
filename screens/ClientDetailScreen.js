import React, { useMemo } from 'react';
import { Alert, Linking, ScrollView, Text, TouchableOpacity, View } from 'react-native';

import BackButton from '../components/BackButton';
import PrimaryButton from '../components/PrimaryButton';
import ScreenContainer from '../components/ScreenContainer';
import { getStatusLabel, getStatusStyles } from '../constants/bookingStatus';
import { COLORS } from '../constants/colors';
import { ROUTES } from '../constants/routes';
import { useBookings } from '../context/BookingsContext';
import { useClients } from '../context/ClientsContext';
import { getClientCrmStats } from '../utils/clients';

function DetailRow({ label, value }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={{ color: COLORS.textSecondary, fontSize: 12, marginBottom: 4 }}>{label}</Text>
      <Text style={{ color: COLORS.textPrimary, fontSize: 15, lineHeight: 22 }}>{value || '—'}</Text>
    </View>
  );
}

function BookingListItem({ booking, navigation }) {
  const status = booking.status || 'confirmed';
  const statusStyles = getStatusStyles(status);

  return (
    <TouchableOpacity
      onPress={() => navigation.navigate(ROUTES.BookingDetail, { bookingId: booking.id })}
      activeOpacity={0.9}
      style={{
        backgroundColor: '#17171D',
        borderColor: '#2A2A33',
        borderWidth: 1,
        borderRadius: 14,
        padding: 14,
        marginTop: 10,
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, paddingRight: 10 }}>
          <Text style={{ color: COLORS.textPrimary, fontWeight: '700', fontSize: 15 }}>
            {booking.service}
          </Text>
          <Text style={{ color: COLORS.textSecondary, marginTop: 4 }}>
            {booking.date} at {booking.time}
          </Text>
        </View>
        <View
          style={{
            backgroundColor: statusStyles.background,
            borderColor: statusStyles.border,
            borderWidth: 1,
            borderRadius: 999,
            paddingHorizontal: 8,
            paddingVertical: 4,
          }}
        >
          <Text style={{ color: statusStyles.text, fontSize: 10, fontWeight: '700' }}>
            {getStatusLabel(status).toUpperCase()}
          </Text>
        </View>
      </View>
      <Text style={{ color: COLORS.accent, marginTop: 8, fontWeight: '700' }}>
        ${Number(booking.price || 0).toFixed(2)}
      </Text>
    </TouchableOpacity>
  );
}

export default function ClientDetailScreen({ navigation, route }) {
  const clientId = route?.params?.clientId;
  const { clients } = useClients();
  const { bookings } = useBookings();

  const client = useMemo(
    () => clients.find((item) => item.id === clientId),
    [clients, clientId]
  );

  const stats = useMemo(
    () => (client ? getClientCrmStats(client, bookings) : null),
    [client, bookings]
  );

  const openPhone = (phone) => {
    Linking.openURL(`tel:${phone}`).catch(() => {
      Alert.alert('Unable to open phone', 'This device could not start a phone call.');
    });
  };

  const openEmail = (email) => {
    Linking.openURL(`mailto:${email}`).catch(() => {
      Alert.alert('Unable to open email', 'This device could not open your mail app.');
    });
  };

  if (!client || !stats) {
    return (
      <ScreenContainer centered style={{ padding: 24 }}>
        <BackButton navigation={navigation} />
        <Text style={{ color: COLORS.textPrimary, fontSize: 20, fontWeight: '700' }}>
          Client not found
        </Text>
      </ScreenContainer>
    );
  }

  const phone = String(client.phone || '').trim();
  const email = String(client.email || '').trim();

  return (
    <ScreenContainer style={{ paddingTop: 0 }}>
      <BackButton navigation={navigation} />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 92, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={{ color: COLORS.textPrimary, fontSize: 30, fontWeight: '700' }}>
          {client.client_name}
        </Text>
        <Text style={{ color: COLORS.textSecondary, marginTop: 8, marginBottom: 18 }}>
          Client profile and appointment history
        </Text>

        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            marginBottom: 14,
          }}
        >
          <View
            style={{
              width: '48%',
              backgroundColor: COLORS.card,
              borderColor: '#2A2A33',
              borderWidth: 1,
              borderRadius: 14,
              padding: 14,
              marginRight: '4%',
              marginBottom: 10,
            }}
          >
            <Text style={{ color: COLORS.textSecondary, fontSize: 11 }}>TOTAL VISITS</Text>
            <Text style={{ color: COLORS.textPrimary, fontSize: 24, fontWeight: '800', marginTop: 6 }}>
              {stats.totalVisits}
            </Text>
          </View>
          <View
            style={{
              width: '48%',
              backgroundColor: COLORS.card,
              borderColor: '#2A2A33',
              borderWidth: 1,
              borderRadius: 14,
              padding: 14,
              marginBottom: 10,
            }}
          >
            <Text style={{ color: COLORS.textSecondary, fontSize: 11 }}>LIFETIME REVENUE</Text>
            <Text style={{ color: COLORS.textPrimary, fontSize: 24, fontWeight: '800', marginTop: 6 }}>
              ${stats.lifetimeRevenue.toFixed(0)}
            </Text>
          </View>
        </View>

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
          <Text style={{ color: COLORS.textPrimary, fontSize: 16, fontWeight: '700', marginBottom: 12 }}>
            Contact
          </Text>
          {phone ? (
            <TouchableOpacity onPress={() => openPhone(phone)} style={{ marginBottom: 10 }}>
              <Text style={{ color: COLORS.accent, fontSize: 15, fontWeight: '600' }}>{phone}</Text>
            </TouchableOpacity>
          ) : (
            <DetailRow label="Phone" value="No phone" />
          )}
          {email ? (
            <TouchableOpacity onPress={() => openEmail(email)}>
              <Text style={{ color: COLORS.accent, fontSize: 15, fontWeight: '600' }}>{email}</Text>
            </TouchableOpacity>
          ) : (
            <DetailRow label="Email" value="No email" />
          )}
          <View style={{ marginTop: 12 }}>
            <DetailRow label="Notes / preferences" value={client.notes || 'No notes yet'} />
          </View>
          <DetailRow label="Last visit" value={stats.lastVisitLabel} />
          <DetailRow label="Next appointment" value={stats.nextAppointmentLabel} />
        </View>

        <PrimaryButton
          title="New Booking"
          onPress={() =>
            navigation.navigate(ROUTES.AddBooking, {
              clientName: client.client_name,
            })
          }
          style={{ marginBottom: 10 }}
        />

        <TouchableOpacity
          onPress={() =>
            navigation.navigate(ROUTES.AddClient, {
              clientId: client.id,
            })
          }
          style={{
            backgroundColor: '#15151B',
            borderColor: '#2D2D38',
            borderWidth: 1,
            borderRadius: 14,
            paddingVertical: 14,
            alignItems: 'center',
            marginBottom: 18,
          }}
        >
          <Text style={{ color: COLORS.textPrimary, fontWeight: '700' }}>Edit Client</Text>
        </TouchableOpacity>

        <Text style={{ color: COLORS.textPrimary, fontSize: 17, fontWeight: '700', marginBottom: 4 }}>
          Upcoming Appointments
        </Text>
        {stats.upcomingAppointments.length ? (
          stats.upcomingAppointments.map((booking) => (
            <BookingListItem key={booking.id} booking={booking} navigation={navigation} />
          ))
        ) : (
          <Text style={{ color: COLORS.textSecondary, marginTop: 8 }}>
            No upcoming appointments for this client.
          </Text>
        )}

        <Text
          style={{
            color: COLORS.textPrimary,
            fontSize: 17,
            fontWeight: '700',
            marginTop: 20,
            marginBottom: 4,
          }}
        >
          Appointment History
        </Text>
        {stats.appointmentHistory.length ? (
          stats.appointmentHistory.map((booking) => (
            <BookingListItem key={booking.id} booking={booking} navigation={navigation} />
          ))
        ) : (
          <Text style={{ color: COLORS.textSecondary, marginTop: 8 }}>
            No past appointments yet.
          </Text>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
