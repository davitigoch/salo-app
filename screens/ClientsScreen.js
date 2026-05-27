import React from 'react';
import { Alert, TouchableOpacity, View, Text } from 'react-native';

import PrimaryButton from '../components/PrimaryButton';
import ScreenContainer from '../components/ScreenContainer';
import { COLORS } from '../constants/colors';
import { ROUTES } from '../constants/routes';
import { useClients } from '../context/ClientsContext';

export default function ClientsScreen({ navigation }) {
  const { clients, isClientsLoading, clientsError, deleteClient } = useClients();

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
        padding: 24,
        paddingTop: 70,
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
          marginBottom: 18,
        }}
      >
        Premium guest profiles
      </Text>

      <PrimaryButton
        title="+ New Client"
        onPress={() => navigation.navigate(ROUTES.AddClient)}
      />

      {isClientsLoading ? (
        <Text
          style={{
            color: COLORS.textSecondary,
            marginTop: 16,
          }}
        >
          Loading clients...
        </Text>
      ) : null}

      {clientsError ? (
        <Text
          style={{
            color: '#FCA5A5',
            marginTop: 12,
          }}
        >
          {clientsError}
        </Text>
      ) : null}

      {clients.map((client) => (
        <View
          key={client.id}
          style={{
            backgroundColor: COLORS.card,
            padding: 18,
            borderRadius: 18,
            marginTop: 12,
          }}
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
          <Text
            style={{
              color: COLORS.textSecondary,
              marginTop: 4,
            }}
          >
            {client.phone || 'No phone'}
          </Text>
          <Text
            style={{
              color: COLORS.textSecondary,
              marginTop: 4,
              fontSize: 12,
            }}
          >
            {client.email || 'No email'}
          </Text>
          <Text
            style={{
              color: COLORS.textSecondary,
              marginTop: 4,
              fontSize: 12,
            }}
          >
            {client.notes || 'No notes'}
          </Text>

          <View
            style={{
              flexDirection: 'row',
              marginTop: 14,
            }}
          >
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
              <Text
                style={{
                  color: COLORS.textPrimary,
                  fontWeight: '600',
                }}
              >
                Edit
              </Text>
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
              <Text
                style={{
                  color: '#FCA5A5',
                  fontWeight: '600',
                }}
              >
                Delete
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}

      {!isClientsLoading && !clients.length && !clientsError ? (
        <Text
          style={{
            color: COLORS.textSecondary,
            marginTop: 16,
          }}
        >
          No clients yet. Add your first premium profile.
        </Text>
      ) : null}
    </ScreenContainer>
  );
}
