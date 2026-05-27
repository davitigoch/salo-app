import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import PrimaryButton from '../components/PrimaryButton';
import ScreenContainer from '../components/ScreenContainer';
import { COLORS } from '../constants/colors';
import { ROUTES } from '../constants/routes';
import { useStaff } from '../context/StaffContext';

const COLOR_PRESETS = ['#7C3AED', '#2563EB', '#DC2626', '#059669', '#D97706', '#DB2777'];

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
}) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text
        style={{
          color: COLORS.textSecondary,
          marginBottom: 8,
          fontSize: 13,
          letterSpacing: 0.3,
        }}
      >
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={COLORS.textSecondary}
        keyboardType={keyboardType}
        style={{
          backgroundColor: COLORS.card,
          color: COLORS.textPrimary,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: '#27272A',
          paddingHorizontal: 14,
          paddingVertical: 12,
          minHeight: 50,
          fontSize: 15,
        }}
      />
    </View>
  );
}

export default function AddStaffScreen({ navigation, route }) {
  const { staff, addStaffMember, updateStaffMember } = useStaff();
  const staffId = route?.params?.staffId;

  const staffToEdit = useMemo(
    () => staff.find((member) => member.id === staffId),
    [staff, staffId]
  );
  const isEditing = Boolean(staffToEdit);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('Stylist');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [color, setColor] = useState(COLOR_PRESETS[0]);
  const [isActive, setIsActive] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    if (!staffToEdit) {
      return;
    }

    setName(staffToEdit.name || '');
    setEmail(staffToEdit.email || '');
    setRole(staffToEdit.role || 'Stylist');
    setAvatarUrl(staffToEdit.avatar_url || '');
    setColor(staffToEdit.color || COLOR_PRESETS[0]);
    setIsActive(Boolean(staffToEdit.is_active));
  }, [staffToEdit]);

  const onSave = async () => {
    if (!name.trim()) {
      Alert.alert('Missing details', 'Please enter staff member name.');
      return;
    }

    setIsSaving(true);
    setSaveError('');

    const payload = {
      name: name.trim(),
      email: email.trim(),
      role: role.trim() || 'Stylist',
      avatar_url: avatarUrl.trim(),
      color: color.trim() || COLOR_PRESETS[0],
      is_active: isActive,
    };

    if (isEditing) {
      const { error } = await updateStaffMember(staffToEdit.id, payload);
      setIsSaving(false);

      if (error) {
        setSaveError(error.message);
        Alert.alert('Update failed', error.message);
        return;
      }

      Alert.alert('Staff updated', 'Team member details updated.');
    } else {
      const { error } = await addStaffMember(payload);
      setIsSaving(false);

      if (error) {
        setSaveError(error.message);
        Alert.alert('Save failed', error.message);
        return;
      }

      Alert.alert('Staff added', 'Team member added successfully.');
    }

    navigation.navigate(ROUTES.Staff);
  };

  return (
    <ScreenContainer style={{ paddingTop: 62 }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: 24,
            paddingBottom: 36,
          }}
          showsVerticalScrollIndicator={false}
        >
          <Text
            style={{
              color: COLORS.textPrimary,
              fontSize: 30,
              fontWeight: '700',
            }}
          >
            {isEditing ? 'Edit Team Member' : 'Add Team Member'}
          </Text>

          <Text
            style={{
              color: COLORS.textSecondary,
              marginTop: 8,
              marginBottom: 24,
            }}
          >
            Configure team member profile and booking assignment details
          </Text>

          {saveError ? (
            <Text style={{ color: '#FCA5A5', marginBottom: 12 }}>{saveError}</Text>
          ) : null}

          <Field
            label="Name"
            value={name}
            onChangeText={setName}
            placeholder="Team member name"
          />
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="teammate@example.com"
            keyboardType="email-address"
          />
          <Field
            label="Role"
            value={role}
            onChangeText={setRole}
            placeholder="Stylist, Barber, Assistant"
          />
          <Field
            label="Avatar URL"
            value={avatarUrl}
            onChangeText={setAvatarUrl}
            placeholder="https://..."
          />
          <Field
            label="Color"
            value={color}
            onChangeText={setColor}
            placeholder="#7C3AED"
          />

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ marginBottom: 14 }}
          >
            {COLOR_PRESETS.map((preset) => (
              <TouchableOpacity
                key={preset}
                onPress={() => setColor(preset)}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  backgroundColor: preset,
                  marginRight: 10,
                  borderWidth: color === preset ? 3 : 1,
                  borderColor: color === preset ? COLORS.textPrimary : '#2D2D38',
                }}
              />
            ))}
          </ScrollView>

          <TouchableOpacity
            onPress={() => setIsActive((previous) => !previous)}
            style={{
              backgroundColor: COLORS.card,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: '#27272A',
              paddingHorizontal: 14,
              minHeight: 50,
              justifyContent: 'center',
              marginBottom: 14,
            }}
          >
            <Text style={{ color: COLORS.textPrimary, fontWeight: '600' }}>
              Status: {isActive ? 'Active' : 'Inactive'}
            </Text>
          </TouchableOpacity>

          <PrimaryButton
            title={
              isSaving
                ? isEditing
                  ? 'Updating...'
                  : 'Saving...'
                : isEditing
                  ? 'Update Team Member'
                  : 'Save Team Member'
            }
            onPress={onSave}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}
