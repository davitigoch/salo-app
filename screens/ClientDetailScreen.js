import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Linking,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import BackButton from '../components/BackButton';
import ScreenContainer from '../components/ScreenContainer';
import { getClientSourceLabel } from '../constants/clientSource';
import { COLORS } from '../constants/colors';
import { ROUTES } from '../constants/routes';
import { useBookings } from '../context/BookingsContext';
import { useClients } from '../context/ClientsContext';
import { useStaff } from '../context/StaffContext';
import {
  buildBookingTimelineEvent,
  getClientCrmStats,
  getClientInitials,
  getClientTimelineEvents,
} from '../utils/clients';
import { formatClientSinceLabel, getClientDisplayName } from '../utils/clientProfiles';

function SectionCard({ title, subtitle, children, style }) {
  return (
    <View
      style={{
        backgroundColor: COLORS.card,
        borderColor: '#2A2A33',
        borderWidth: 1,
        borderRadius: 18,
        padding: 18,
        marginBottom: 14,
        ...style,
      }}
    >
      {title ? (
        <Text style={{ color: COLORS.textPrimary, fontSize: 16, fontWeight: '700', marginBottom: subtitle ? 4 : 12 }}>
          {title}
        </Text>
      ) : null}
      {subtitle ? (
        <Text style={{ color: COLORS.textSecondary, fontSize: 12, marginBottom: 12, lineHeight: 18 }}>
          {subtitle}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

function StatCard({ label, value }) {
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
      }}
    >
      <Text style={{ color: COLORS.textSecondary, fontSize: 10, letterSpacing: 0.35 }}>
        {label}
      </Text>
      <Text
        style={{
          color: COLORS.textPrimary,
          fontSize: String(value).length > 8 ? 18 : 24,
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

function InfoRow({ label, value, isEmpty = false }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={{ color: COLORS.textSecondary, fontSize: 12, marginBottom: 4 }}>{label}</Text>
      <Text
        style={{
          color: isEmpty ? COLORS.textSecondary : COLORS.textPrimary,
          fontSize: 16,
          fontWeight: isEmpty ? '500' : '700',
        }}
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

function BookingRow({ event, navigation, isLast }) {
  const { statusStyles } = event;

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
        paddingVertical: 16,
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
          marginTop: 6,
          marginRight: 14,
        }}
      />
      <View style={{ flex: 1, paddingRight: 10 }}>
        <Text style={{ color: COLORS.textPrimary, fontWeight: '700', fontSize: 16 }}>
          {event.dateLabel}
        </Text>
        <View
          style={{
            alignSelf: 'flex-start',
            backgroundColor: statusStyles.background,
            borderColor: statusStyles.border,
            borderWidth: 1,
            borderRadius: 999,
            paddingHorizontal: 8,
            paddingVertical: 4,
            marginTop: 8,
          }}
        >
          <Text style={{ color: statusStyles.text, fontSize: 10, fontWeight: '700' }}>
            {event.statusLabel}
          </Text>
        </View>
        <Text style={{ color: COLORS.textPrimary, fontWeight: '700', fontSize: 15, marginTop: 10 }}>
          {event.serviceLabel}
        </Text>
        <Text style={{ color: COLORS.textSecondary, marginTop: 6, fontSize: 14 }}>
          {event.timeLabel}
        </Text>
        <Text style={{ color: COLORS.accent, marginTop: 8, fontWeight: '800', fontSize: 16 }}>
          {event.priceLabel}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color="#6D6D7A" style={{ marginTop: 6 }} />
    </TouchableOpacity>
  );
}

function BookingList({ events, navigation, emptyLabel }) {
  if (!events.length) {
    return <Text style={{ color: COLORS.textSecondary, paddingVertical: 8 }}>{emptyLabel}</Text>;
  }

  return events.map((event, index) => (
    <BookingRow
      key={event.id}
      event={event}
      navigation={navigation}
      isLast={index === events.length - 1}
    />
  ));
}

export default function ClientDetailScreen({ navigation, route }) {
  const clientId = route?.params?.clientId;
  const insets = useSafeAreaInsets();
  const { clients, updateClient, getClientProfile } = useClients();
  const { bookings } = useBookings();
  const { staff } = useStaff();
  const [notesDraft, setNotesDraft] = useState('');
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [profileData, setProfileData] = useState(null);
  const [hasResolvedProfile, setHasResolvedProfile] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [profileError, setProfileError] = useState('');
  const scrollViewRef = useRef(null);

  const headerOffset = insets.top + 58;

  const listClient = useMemo(
    () => clients.find((item) => item.id === clientId),
    [clients, clientId]
  );

  const client = profileData?.client || listClient;

  const loadProfile = useCallback(
    async ({ userInitiated = false } = {}) => {
      if (!clientId) {
        setProfileData(null);
        setHasResolvedProfile(true);
        return;
      }

      if (userInitiated) {
        setIsRefreshing(true);
      }

      setProfileError('');

      const { data, error } = await getClientProfile(clientId);

      if (error) {
        setProfileError(error.message || 'Unable to load client profile.');
      } else {
        setProfileData(data);
      }

      setHasResolvedProfile(true);

      if (userInitiated) {
        setIsRefreshing(false);
      }
    },
    [clientId, getClientProfile]
  );

  useFocusEffect(
    useCallback(() => {
      loadProfile();
    }, [loadProfile])
  );

  useEffect(() => {
    requestAnimationFrame(() => {
      scrollViewRef.current?.scrollTo({ y: 0, animated: false });
    });
  }, [clientId]);

  const handleRefresh = useCallback(() => {
    loadProfile({ userInitiated: true });
  }, [loadProfile]);

  const stats = useMemo(() => {
    if (!client) {
      return null;
    }

    return getClientCrmStats(client, bookings);
  }, [bookings, client]);

  const upcomingEvents = useMemo(() => {
    if (profileData?.upcoming_appointments?.length) {
      return profileData.upcoming_appointments.map((booking) => buildBookingTimelineEvent(booking));
    }

    if (!client) {
      return [];
    }

    return getClientTimelineEvents(client, bookings)
      .filter((event) => ['pending', 'confirmed'].includes(event.status))
      .filter((event) => event.sortTime >= Date.now())
      .sort((first, second) => first.sortTime - second.sortTime);
  }, [bookings, client, profileData?.upcoming_appointments]);

  const historyEvents = useMemo(() => {
    if (profileData?.appointment_history?.length) {
      return profileData.appointment_history.map((booking) => buildBookingTimelineEvent(booking));
    }

    if (!client) {
      return [];
    }

    return getClientTimelineEvents(client, bookings)
      .filter((event) => ['confirmed', 'completed'].includes(event.status))
      .filter((event) => event.sortTime < Date.now())
      .sort((first, second) => second.sortTime - first.sortTime);
  }, [bookings, client, profileData?.appointment_history]);

  const preferredStaffName = useMemo(() => {
    if (!client?.preferred_staff_member_id) {
      return null;
    }

    return staff.find((member) => member.id === client.preferred_staff_member_id)?.name || null;
  }, [client?.preferred_staff_member_id, staff]);

  useEffect(() => {
    setProfileData(null);
    setHasResolvedProfile(false);
    setProfileError('');
    setNotesDraft('');
  }, [clientId]);

  useEffect(() => {
    setNotesDraft(client?.notes || '');
  }, [client?.id, client?.notes]);

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
      clientName: getClientDisplayName(client),
      clientId: client.id,
    });
  };

  const saveNotes = async () => {
    if (!client) {
      return;
    }

    const trimmedNotes = notesDraft.trim();
    if (trimmedNotes === String(client.notes || '').trim()) {
      return;
    }

    setIsSavingNotes(true);
    const { error } = await updateClient(client.id, { notes: trimmedNotes });
    setIsSavingNotes(false);

    if (error) {
      Alert.alert('Save failed', error.message);
      return;
    }

    await loadProfile();
  };

  const isLoadingContent = !client && !hasResolvedProfile;
  const isNotFound = !client && hasResolvedProfile;

  if (isNotFound) {
    return (
      <ScreenContainer centered style={{ padding: 24 }}>
        <BackButton navigation={navigation} />
        <Text style={{ color: COLORS.textPrimary, fontSize: 20, fontWeight: '700' }}>
          Client not found
        </Text>
      </ScreenContainer>
    );
  }

  const phone = String(client?.phone || '').trim();
  const email = String(client?.email || '').trim();
  const displayName = client ? getClientDisplayName(client) : '';
  const initials = client ? getClientInitials(client) : '?';
  const notesChanged = notesDraft.trim() !== String(client?.notes || '').trim();

  return (
    <ScreenContainer style={{ paddingTop: 0 }}>
      <BackButton navigation={navigation} />
      <ScrollView
        ref={scrollViewRef}
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingTop: headerOffset,
          paddingBottom: insets.bottom + 40,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets={false}
        contentInsetAdjustmentBehavior="never"
        refreshControl={
          client ? (
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={COLORS.accent}
            />
          ) : undefined
        }
      >
        {isLoadingContent ? (
          <Text style={{ color: COLORS.textSecondary, fontSize: 16, paddingVertical: 24 }}>
            Loading client profile...
          </Text>
        ) : null}

        {client && stats ? (
          <>
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
              {displayName}
            </Text>
            <Text style={{ color: COLORS.textSecondary, marginTop: 4, fontSize: 13 }}>
              {formatClientSinceLabel(client.created_at)}
            </Text>
          </View>
        </View>

        {profileError ? (
          <Text style={{ color: '#FCA5A5', marginBottom: 12 }}>{profileError}</Text>
        ) : null}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <StatCard label="LIFETIME BOOKINGS" value={String(stats.totalVisits)} />
          <StatCard label="LIFETIME REVENUE" value={`$${stats.lifetimeRevenue.toFixed(0)}`} />
          <StatCard label="AVERAGE SPEND" value={`$${stats.averageTicket.toFixed(0)}`} />
          <StatCard label="NO-SHOWS" value={String(stats.noShows)} />
          <StatCard label="CANCELLATIONS" value={String(stats.cancellationCount || 0)} />
          <StatCard label="RESCHEDULED" value={String(stats.rescheduledCount || 0)} />
        </View>

        <SectionCard title="Relationship">
          <InfoRow
            label="Preferred staff"
            value={preferredStaffName || 'Not set'}
            isEmpty={!preferredStaffName}
          />
          <InfoRow
            label="Source"
            value={getClientSourceLabel(client.source)}
            isEmpty={!client.source}
          />
        </SectionCard>

        <SectionCard title="Contact">
          <Text style={{ color: COLORS.textSecondary, fontSize: 14, marginBottom: 6 }}>
            {phone || 'No phone on file'}
          </Text>
          <Text style={{ color: COLORS.textSecondary, fontSize: 14, marginBottom: 12 }}>
            {email || 'No email on file'}
          </Text>

          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              marginTop: 6,
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
        </SectionCard>

        <SectionCard
          title="Notes"
          subtitle="Preferences, appointment details, and reminders for this client."
        >
          <TextInput
            value={notesDraft}
            onChangeText={setNotesDraft}
            placeholder={'Prefers afternoon appointments\nFollow-up instructions\nImportant reminders'}
            placeholderTextColor="#6D6D7A"
            multiline
            textAlignVertical="top"
            style={{
              backgroundColor: '#121218',
              borderColor: '#2A2A33',
              borderWidth: 1,
              borderRadius: 14,
              color: COLORS.textPrimary,
              fontSize: 14,
              lineHeight: 20,
              minHeight: 120,
              paddingHorizontal: 14,
              paddingVertical: 12,
            }}
          />
          <TouchableOpacity
            onPress={saveNotes}
            disabled={!notesChanged || isSavingNotes}
            activeOpacity={0.9}
            style={{
              marginTop: 12,
              backgroundColor: notesChanged ? COLORS.accent : '#15151B',
              borderColor: notesChanged ? '#8B5CF6' : '#2D2D38',
              borderWidth: 1,
              borderRadius: 12,
              paddingVertical: 12,
              alignItems: 'center',
              opacity: !notesChanged || isSavingNotes ? 0.6 : 1,
            }}
          >
            <Text style={{ color: COLORS.textPrimary, fontWeight: '700' }}>
              {isSavingNotes ? 'Saving...' : 'Save Notes'}
            </Text>
          </TouchableOpacity>
        </SectionCard>

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
        <Text style={{ color: COLORS.textSecondary, fontSize: 13, marginBottom: 8 }}>
          Confirmed and pending appointments ahead
        </Text>
        <SectionCard>
          <BookingList
            events={upcomingEvents}
            navigation={navigation}
            emptyLabel="No upcoming appointments."
          />
        </SectionCard>

        <Text style={{ color: COLORS.textPrimary, fontSize: 17, fontWeight: '700', marginBottom: 4 }}>
          Past Appointments
        </Text>
        <Text style={{ color: COLORS.textSecondary, fontSize: 13, marginBottom: 8 }}>
          Completed and confirmed appointment history
        </Text>
        <SectionCard>
          <BookingList
            events={historyEvents}
            navigation={navigation}
            emptyLabel="No past appointments yet."
          />
        </SectionCard>
          </>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}
