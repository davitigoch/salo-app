import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import PrimaryButton from '../components/PrimaryButton';
import ScreenContainer from '../components/ScreenContainer';
import SearchField from '../components/SearchField';
import { COLORS } from '../constants/colors';
import { ROUTES } from '../constants/routes';
import { useBookings } from '../context/BookingsContext';
import { useClients } from '../context/ClientsContext';
import { filterClients, getClientVisitStats } from '../utils/clients';

export default function ClientsScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const { clients, isClientsLoading, clientsError, deleteClient } = useClients();
  const { bookings } = useBookings();
  const [searchQuery, setSearchQuery] = useState('');

  const visibleClients = useMemo(
    () => filterClients(clients, searchQuery),
    [clients, searchQuery]
  );

  const onDeleteClient = (clientId) => {
    Alert.alert('Delete client?', 'This action cannot be undone.', [
      {
        text: 'Cancel',
        style: 'cancel',
      },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const { error } = await deleteClient(clientId);
          if (error) {
            Alert.alert('Delete failed', error.message);
          }
        },
      },
    ]);
  };

  return (
    <ScreenContainer
      style={{
        flex: 1,
        paddingHorizontal: 24,
        paddingTop: insets.top + 10,
      }}
    >
      <Text
        style={{
          color: COLORS.textPrimary,
          fontSize: 32,
          fontWeight: '700',
        }}
      >
        Clients
      </Text>

      <Text
        style={{
          color: COLORS.textSecondary,
          marginTop: 8,
          marginBottom: 16,
        }}
      >
        Premium guest profiles
      </Text>

      <SearchField
        value={searchQuery}
        onChangeText={setSearchQuery}
        placeholder="Search by name, phone, or email"
      />

      <PrimaryButton
        title="+ New Client"
        onPress={() => navigation.navigate(ROUTES.AddClient)}
        style={{ marginTop: 12 }}
      />

      {isClientsLoading ? (
        <Text style={{ color: COLORS.textSecondary, marginTop: 16 }}>Loading clients...</Text>
      ) : null}

      {clientsError ? (
        <Text style={{ color: '#FCA5A5', marginTop: 12 }}>{clientsError}</Text>
      ) : null}

      <ScrollView
        style={{ flex: 1, marginTop: 8 }}
        contentContainerStyle={{ paddingBottom: tabBarHeight + insets.bottom + 24 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {visibleClients.map((client) => {
          const { visitCount, lastVisitLabel } = getClientVisitStats(client, bookings);

          return (
            <View
              key={client.id}
              style={{
                backgroundColor: COLORS.card,
                padding: 18,
                borderRadius: 18,
                marginTop: 12,
                borderWidth: 1,
                borderColor: '#2A2A33',
              }}
            >
              <TouchableOpacity
                onPress={() =>
                  navigation.navigate(ROUTES.ClientDetail, {
                    clientId: client.id,
                  })
                }
                activeOpacity={0.9}
              >
                <Text
                  style={{
                    color: COLORS.textPrimary,
                    fontSize: 18,
                    fontWeight: '600',
                  }}
                >
                  {client.client_name}
                </Text>
                <Text style={{ color: COLORS.textSecondary, marginTop: 4 }}>
                  {client.phone || 'No phone'}
                </Text>
                <Text style={{ color: COLORS.textSecondary, marginTop: 4, fontSize: 12 }}>
                  {client.email || 'No email'}
                </Text>
                <View style={{ flexDirection: 'row', marginTop: 10 }}>
                  <View
                    style={{
                      backgroundColor: '#17171D',
                      borderColor: '#2A2A33',
                      borderWidth: 1,
                      borderRadius: 999,
                      paddingHorizontal: 10,
                      paddingVertical: 5,
                      marginRight: 8,
                    }}
                  >
                    <Text style={{ color: COLORS.accent, fontSize: 11, fontWeight: '700' }}>
                      {visitCount} {visitCount === 1 ? 'visit' : 'visits'}
                    </Text>
                  </View>
                  <Text style={{ color: COLORS.textSecondary, fontSize: 12, flex: 1, marginTop: 4 }}>
                    Last visit: {lastVisitLabel}
                  </Text>
                </View>
                <Text
                  style={{
                    color: COLORS.textSecondary,
                    marginTop: 8,
                    fontSize: 12,
                  }}
                >
                  {client.notes || 'No notes'}
                </Text>
              </TouchableOpacity>

              <View style={{ flexDirection: 'row', marginTop: 14 }}>
                <TouchableOpacity
                  onPress={() =>
                    navigation.navigate(ROUTES.AddClient, {
                      clientId: client.id,
                    })
                  }
                  style={{
                    backgroundColor: COLORS.accent,
                    paddingVertical: 10,
                    paddingHorizontal: 18,
                    borderRadius: 12,
                    marginRight: 10,
                  }}
                >
                  <Text style={{ color: COLORS.textPrimary, fontWeight: '600' }}>Edit</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => onDeleteClient(client.id)}
                  style={{
                    backgroundColor: '#2A1618',
                    borderColor: '#5A252A',
                    borderWidth: 1,
                    paddingVertical: 10,
                    paddingHorizontal: 18,
                    borderRadius: 12,
                  }}
                >
                  <Text style={{ color: '#FCA5A5', fontWeight: '600' }}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}

        {!isClientsLoading && clients.length > 0 && !visibleClients.length ? (
          <Text style={{ color: COLORS.textSecondary, marginTop: 16 }}>
            No clients match your search.
          </Text>
        ) : null}

        {!isClientsLoading && !clients.length && !clientsError ? (
          <Text style={{ color: COLORS.textSecondary, marginTop: 16 }}>
            No clients yet. Clients will appear automatically when customers book appointments.
          </Text>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}
