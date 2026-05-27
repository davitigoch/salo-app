import React from 'react';
import { Alert, Text, TouchableOpacity, View } from 'react-native';

import PrimaryButton from '../components/PrimaryButton';
import ScreenContainer from '../components/ScreenContainer';
import { COLORS } from '../constants/colors';
import { ROUTES } from '../constants/routes';
import { useStaff } from '../context/StaffContext';

export default function StaffScreen({ navigation }) {
  const {
    staff,
    isStaffLoading,
    staffError,
    deleteStaffMember,
  } = useStaff();

  const onDelete = (staffId) => {
    Alert.alert('Delete team member?', 'This action cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const { error } = await deleteStaffMember(staffId);
          if (error) {
            Alert.alert('Delete failed', error.message);
          }
        },
      },
    ]);
  };

  return (
    <ScreenContainer style={{ padding: 24, paddingTop: 70 }}>
      <Text
        style={{
          color: COLORS.textPrimary,
          fontSize: 32,
          fontWeight: '700',
        }}
      >
        Team
      </Text>

      <Text
        style={{
          color: COLORS.textSecondary,
          marginTop: 8,
          marginBottom: 18,
        }}
      >
        Manage your staff roster and assignment readiness
      </Text>

      <PrimaryButton
        title="+ Add Team Member"
        onPress={() => navigation.navigate(ROUTES.AddStaff)}
      />

      {isStaffLoading ? (
        <Text style={{ color: COLORS.textSecondary, marginTop: 14 }}>
          Loading team members...
        </Text>
      ) : null}

      {staffError ? (
        <Text style={{ color: '#FCA5A5', marginTop: 10 }}>
          {staffError}
        </Text>
      ) : null}

      {staff.map((member) => (
        <View
          key={member.id}
          style={{
            backgroundColor: COLORS.card,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: '#2A2A33',
            padding: 16,
            marginTop: 12,
          }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <View style={{ flex: 1, paddingRight: 10 }}>
              <Text style={{ color: COLORS.textPrimary, fontSize: 18, fontWeight: '700' }}>
                {member.name}
              </Text>
              <Text style={{ color: COLORS.textSecondary, marginTop: 2 }}>
                {member.email || 'No email'}
              </Text>
              <Text style={{ color: COLORS.textSecondary, marginTop: 6, fontSize: 12 }}>
                {member.role || 'Stylist'}
              </Text>
            </View>

            <View
              style={{
                backgroundColor: member.is_active ? '#153325' : '#342023',
                borderRadius: 999,
                paddingHorizontal: 10,
                paddingVertical: 4,
                alignSelf: 'flex-start',
              }}
            >
              <Text
                style={{
                  color: member.is_active ? '#86EFAC' : '#FCA5A5',
                  fontSize: 11,
                  fontWeight: '700',
                }}
              >
                {member.is_active ? 'ACTIVE' : 'INACTIVE'}
              </Text>
            </View>
          </View>

          <View style={{ flexDirection: 'row', marginTop: 12 }}>
            <TouchableOpacity
              onPress={() => navigation.navigate(ROUTES.AddStaff, { staffId: member.id })}
              style={{
                backgroundColor: COLORS.accent,
                borderRadius: 12,
                paddingHorizontal: 18,
                paddingVertical: 10,
                marginRight: 10,
              }}
            >
              <Text style={{ color: COLORS.textPrimary, fontWeight: '600' }}>Edit</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => onDelete(member.id)}
              style={{
                backgroundColor: '#2A1618',
                borderColor: '#5A252A',
                borderWidth: 1,
                borderRadius: 12,
                paddingHorizontal: 18,
                paddingVertical: 10,
              }}
            >
              <Text style={{ color: '#FCA5A5', fontWeight: '600' }}>Delete</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}

      {!isStaffLoading && !staff.length && !staffError ? (
        <Text style={{ color: COLORS.textSecondary, marginTop: 14 }}>
          No staff yet. Add your first team member.
        </Text>
      ) : null}
    </ScreenContainer>
  );
}
