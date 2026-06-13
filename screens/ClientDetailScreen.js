import React, { useMemo } from 'react';
import { Alert, Linking, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import BackButton from '../components/BackButton';
import ScreenContainer from '../components/ScreenContainer';
import { COLORS } from '../constants/colors';
import { ROUTES } from '../constants/routes';
import { useBookings } from '../context/BookingsContext';
import { useClients } from '../context/ClientsContext';
import {
  formatShortBookingDate,
  getClientCrmStats,
  getClientInitials,
  getClientTimelineEvents,
} from '../utils/clients';

function StatCard({ label, value, style }) {
  return (
    <View
      style={{
        width: '48%',
        backgroundColor: COLORS.card,
        borderColor: '#2A2A33',
        borderWidth: 1,
        borderRadius: 14,
        padding: 14,
        marginBottom: 10,
        ...style,
      }}
    >
      <Text style={{ color: COLORS.textSecondary, fontSize: 10, letterSpacing: 0.35 }}>
        {label}
      </Text>
      <Text
        style={{
          color: COLORS.textPrimary,
          fontSize: value.length > 8 ? 18 : 24,
          fontWeight: '800',
          marginTop: 8,
        }}
        numberOfLines={2}
      >
        {value}
      </Text>
    </View>
  );
}

function ActionButton({ label, icon, onPress, disabled }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.9}
      style={{
        width: '48%',
        backgroundColor: disabled ? '#121218' : '#17171D',
        borderColor: disabled ? '#24242E' : '#2A2A33',
        borderWidth: 1,
        borderRadius: 14,
        paddingVertical: 16,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 10,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <Ionicons
        name={icon}
        size={18}
        color={disabled ? '#6D6D7A' : COLORS.accent}
        style={{ marginBottom: 8 }}
      />
      <Text style={{ color: disabled ? '#6D6D7A' : COLORS.textPrimary, fontWeight: '700', fontSize: 13 }}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function TimelineItem({ event, navigation, isLast }) {
  return (
    <TouchableOpacity
      onPress={() =>
        navigation.navigate(ROUTES.BookingDetail, {
          bookingId: event.booking.id,
        })
      }
      activeOpacity={0.9}
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingVertical: 14,
        borderBottomWidth: isLast ? 0 : 1,
        borderBottomColor: '#2A2A33',
      }}
    >
      <View
        style={{
          width: 10,
          height: 10,
          borderRadius: 999,
          backgroundColor: COLORS.accent,
          marginTop: 5,
          marginRight: 14,
        }}
      />
      <View style={{ flex: 1 }}>
        <Text style={{ color: COLORS.textPrimary, fontWeight: '700', fontSize: 15 }}>
          {event.dateLabel}
        </Text>
        <Text style={{ color: COLORS.textSecondary, marginTop: 4, fontSize: 14 }}>
          {event.label}
        </Text>
        <Text style={{ color: '#8B8BA2', marginTop: 4, fontSize: 12 }}>
          {event.booking.service}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color="#6D6D7A" style={{ marginTop: 4 }} />
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

  const timelineEvents = useMemo(
    () => (client ? getClientTimelineEvents(client, bookings) : []),
    [client, bookings]
  );

  const openPhone = (phone) => {
    Linking.openURL(`tel:${phone}`).catch(() => {
      Alert.alert('Unable to open phone', 'This device could not start a phone call.');
    });
  };

  const openText = (phone) => {
    Linking.openURL(`sms:${phone}`).catch(() => {
      Alert.alert('Unable to open messages', 'This device could not open your messaging app.');
    });
  };

  const openEmail = (email) => {
    Linking.openURL(`mailto:${email}`).catch(() => {
      Alert.alert('Unable to open email', 'This device could not open your mail app.');
    });
  };

  const openNewBooking = () => {
    navigation.navigate(ROUTES.AddBooking, {
      clientName: client.client_name,
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
  const initials = getClientInitials(client.client_name);

  return (
    <ScreenContainer style={{ paddingTop: 0 }}>
      <BackButton navigation={navigation} />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 92, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20 }}>
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: 999,
              backgroundColor: '#231B3A',
              borderColor: '#4C3A7E',
              borderWidth: 1,
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: 16,
            }}
          >
            <Text style={{ color: '#DDD6FE', fontSize: 22, fontWeight: '800' }}>{initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: COLORS.textPrimary, fontSize: 28, fontWeight: '700' }}>
              {client.client_name}
            </Text>
            <Text style={{ color: COLORS.textSecondary, marginTop: 4, fontSize: 13 }}>
              Client profile
            </Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <StatCard label="VISITS" value={String(stats.totalVisits)} />
          <StatCard label="REVENUE" value={`$${stats.lifetimeRevenue.toFixed(0)}`} />
          <StatCard
            label="LAST VISIT"
            value={stats.lastVisit ? formatShortBookingDate(stats.lastVisit) : 'None'}
          />
          <StatCard
            label="NEXT APPOINTMENT"
            value={stats.nextAppointment ? formatShortBookingDate(stats.nextAppointment) : 'None'}
          />
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
          <Text style={{ color: COLORS.textSecondary, fontSize: 14, marginBottom: 6 }}>
            {phone || 'No phone on file'}
          </Text>
          <Text style={{ color: COLORS.textSecondary, fontSize: 14, marginBottom: 12 }}>
            {email || 'No email on file'}
          </Text>
          <Text style={{ color: COLORS.textSecondary, fontSize: 12, marginBottom: 4 }}>
            Notes / preferences
          </Text>
          <Text style={{ color: COLORS.textPrimary, fontSize: 14, lineHeight: 20 }}>
            {client.notes || 'No notes yet'}
          </Text>

          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              marginTop: 18,
            }}
          >
            <ActionButton
              label="Call"
              icon="call-outline"
              disabled={!phone}
              onPress={() => {
                if (!phone) {
                  Alert.alert('No phone number', 'Add a phone number to call this client.');
                  return;
                }
                openPhone(phone);
              }}
            />
            <ActionButton
              label="Text"
              icon="chatbubble-outline"
              disabled={!phone}
              onPress={() => {
                if (!phone) {
                  Alert.alert('No phone number', 'Add a phone number to text this client.');
                  return;
                }
                openText(phone);
              }}
            />
            <ActionButton
              label="Email"
              icon="mail-outline"
              disabled={!email}
              onPress={() => {
                if (!email) {
                  Alert.alert('No email address', 'Add an email address to contact this client.');
                  return;
                }
                openEmail(email);
              }}
            />
            <ActionButton
              label="New Booking"
              icon="calendar-outline"
              disabled={false}
              onPress={openNewBooking}
            />
          </View>
        </View>

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
          Client Timeline
        </Text>
        <Text style={{ color: COLORS.textSecondary, fontSize: 13, marginBottom: 8 }}>
          Appointment activity in chronological order
        </Text>

        <View
          style={{
            backgroundColor: COLORS.card,
            borderColor: '#2A2A33',
            borderWidth: 1,
            borderRadius: 18,
            paddingHorizontal: 16,
            paddingVertical: 4,
          }}
        >
          {timelineEvents.length ? (
            timelineEvents.map((event, index) => (
              <TimelineItem
                key={event.id}
                event={event}
                navigation={navigation}
                isLast={index === timelineEvents.length - 1}
              />
            ))
          ) : (
            <Text style={{ color: COLORS.textSecondary, paddingVertical: 16 }}>
              No appointment activity yet.
            </Text>
          )}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
