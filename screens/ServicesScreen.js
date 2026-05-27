import React from 'react';
import { Alert, Text, TouchableOpacity, View } from 'react-native';

import PrimaryButton from '../components/PrimaryButton';
import ScreenContainer from '../components/ScreenContainer';
import { COLORS } from '../constants/colors';
import { ROUTES } from '../constants/routes';
import { useServices } from '../context/ServicesContext';

function formatCurrency(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

export default function ServicesScreen({ navigation }) {
  const { services, isServicesLoading, servicesError, deleteService } = useServices();

  const onDeleteService = (serviceId) => {
    Alert.alert('Delete service?', 'This action cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const { error } = await deleteService(serviceId);
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
        Services
      </Text>

      <Text
        style={{
          color: COLORS.textSecondary,
          marginTop: 8,
          marginBottom: 18,
        }}
      >
        Manage your premium service catalog
      </Text>

      <PrimaryButton
        title="+ New Service"
        onPress={() => navigation.navigate(ROUTES.AddService)}
      />

      {isServicesLoading ? (
        <Text
          style={{
            color: COLORS.textSecondary,
            marginTop: 16,
          }}
        >
          Loading services...
        </Text>
      ) : null}

      {servicesError ? (
        <Text
          style={{
            color: '#FCA5A5',
            marginTop: 12,
          }}
        >
          {servicesError}
        </Text>
      ) : null}

      {services.map((service) => (
        <View
          key={service.id}
          style={{
            backgroundColor: COLORS.card,
            padding: 18,
            borderRadius: 18,
            marginTop: 12,
            borderWidth: 1,
            borderColor: '#2A2A33',
          }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text
              style={{
                color: COLORS.textPrimary,
                fontSize: 18,
                fontWeight: '700',
                flex: 1,
              }}
            >
              {service.name}
            </Text>

            <View
              style={{
                backgroundColor: service.is_active ? '#153325' : '#342023',
                borderRadius: 999,
                paddingHorizontal: 10,
                paddingVertical: 4,
                marginLeft: 10,
              }}
            >
              <Text
                style={{
                  color: service.is_active ? '#86EFAC' : '#FCA5A5',
                  fontSize: 11,
                  fontWeight: '700',
                }}
              >
                {service.is_active ? 'ACTIVE' : 'INACTIVE'}
              </Text>
            </View>
          </View>

          <Text style={{ color: COLORS.textSecondary, marginTop: 6 }}>
            {service.description || 'No description'}
          </Text>

          <Text style={{ color: COLORS.textSecondary, marginTop: 6, fontSize: 12 }}>
            {service.category || 'General'} • {service.duration_minutes || 0} mins
          </Text>

          <Text
            style={{
              color: COLORS.accent,
              marginTop: 8,
              fontWeight: '700',
              fontSize: 15,
            }}
          >
            {formatCurrency(service.price)}
          </Text>

          <View style={{ flexDirection: 'row', marginTop: 14 }}>
            <TouchableOpacity
              onPress={() =>
                navigation.navigate(ROUTES.AddService, {
                  serviceId: service.id,
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
              onPress={() => onDeleteService(service.id)}
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
      ))}

      {!isServicesLoading && !services.length && !servicesError ? (
        <Text
          style={{
            color: COLORS.textSecondary,
            marginTop: 16,
          }}
        >
          No services yet. Add your first offer.
        </Text>
      ) : null}
    </ScreenContainer>
  );
}
