import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import BackButton from '../components/BackButton';
import PrimaryButton from '../components/PrimaryButton';
import ScreenContainer from '../components/ScreenContainer';
import { COLORS } from '../constants/colors';
import { ROUTES } from '../constants/routes';
import { useClients } from '../context/ClientsContext';

function Field({ label, value, onChangeText, placeholder, multiline = false, keyboardType = 'default' }) {
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
        multiline={multiline}
        keyboardType={keyboardType}
        autoCapitalize={keyboardType === 'email-address' ? 'none' : 'sentences'}
        autoCorrect={keyboardType !== 'email-address'}
        style={{
          backgroundColor: COLORS.card,
          color: COLORS.textPrimary,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: '#27272A',
          paddingHorizontal: 14,
          paddingVertical: 12,
          minHeight: multiline ? 110 : 50,
          textAlignVertical: multiline ? 'top' : 'center',
          fontSize: 15,
        }}
      />
    </View>
  );
}

export default function AddClientScreen({ navigation, route }) {
  const { clients, addClient, updateClient } = useClients();
  const clientId = route?.params?.clientId;
  const clientToEdit = useMemo(
    () => clients.find((client) => client.id === clientId),
    [clients, clientId]
  );
  const isEditing = Boolean(clientToEdit);

  const [clientName, setClientName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    if (!clientToEdit) {
      return;
    }

    setClientName(clientToEdit.client_name || '');
    setPhone(clientToEdit.phone || '');
    setEmail(clientToEdit.email || '');
    setNotes(clientToEdit.notes || '');
  }, [clientToEdit]);

  const onSave = async () => {
    if (!clientName.trim()) {
      Alert.alert('Missing details', 'Please fill client name.');
      return;
    }

    setIsSaving(true);
    setSaveError('');

    const payload = {
      client_name: clientName.trim(),
      phone: phone.trim(),
      email: email.trim(),
      notes: notes.trim(),
    };

    if (isEditing) {
      const { error } = await updateClient(clientToEdit.id, payload);
      setIsSaving(false);

      if (error) {
        setSaveError(error.message);
        Alert.alert('Update failed', error.message);
        return;
      }

      Alert.alert('Client updated', 'Your client profile was updated.');
    } else {
      const { error } = await addClient(payload);
      setIsSaving(false);

      if (error) {
        setSaveError(error.message);
        Alert.alert('Save failed', error.message);
        return;
      }

      Alert.alert('Client saved', 'Your new client has been added.');
    }

    navigation.navigate(ROUTES.MainTabs, {
      screen: ROUTES.Clients,
    });
  };

  return (
    <ScreenContainer style={{ paddingTop: 0 }}>
      <BackButton navigation={navigation} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: 24,
            paddingTop: 92,
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
            {isEditing ? 'Edit Client' : 'Add Client'}
          </Text>

          <Text
            style={{
              color: COLORS.textSecondary,
              marginTop: 8,
              marginBottom: 24,
            }}
          >
            {isEditing
              ? 'Update your premium client profile'
              : 'Create a premium client profile'}
          </Text>

          {saveError ? (
            <Text
              style={{
                color: '#FCA5A5',
                marginBottom: 12,
              }}
            >
              {saveError}
            </Text>
          ) : null}

          <Field
            label="Client name"
            value={clientName}
            onChangeText={setClientName}
            placeholder="Enter client name"
          />
          <Field
            label="Phone"
            value={phone}
            onChangeText={setPhone}
            placeholder="+1 555 123 4567"
            keyboardType="phone-pad"
          />
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="client@email.com"
            keyboardType="email-address"
          />
          <Field
            label="Notes"
            value={notes}
            onChangeText={setNotes}
            placeholder="Client preferences and details"
            multiline
          />

          <PrimaryButton
            title={
              isSaving
                ? isEditing
                  ? 'Updating...'
                  : 'Saving...'
                : isEditing
                  ? 'Update Client'
                  : 'Save Client'
            }
            onPress={onSave}
            style={{ marginTop: 10 }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}
