import React, { useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

import PrimaryButton from '../components/PrimaryButton';
import ScreenContainer from '../components/ScreenContainer';
import { COLORS } from '../constants/colors';
import { ROUTES } from '../constants/routes';
import { useServices } from '../context/ServicesContext';

function Field({ label, value, onChangeText, placeholder, keyboardType = 'default', multiline = false }) {
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
        multiline={multiline}
        style={{
          backgroundColor: COLORS.card,
          color: COLORS.textPrimary,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: '#27272A',
          paddingHorizontal: 14,
          paddingVertical: 12,
          minHeight: multiline ? 100 : 50,
          textAlignVertical: multiline ? 'top' : 'center',
          fontSize: 15,
        }}
      />
    </View>
  );
}

const COLOR_PRESETS = ['#7C3AED', '#2563EB', '#DC2626', '#059669', '#D97706', '#DB2777'];

export default function AddServiceScreen({ navigation, route }) {
  const { services, addService, updateService } = useServices();
  const serviceId = route?.params?.serviceId;
  const serviceToEdit = useMemo(
    () => services.find((item) => item.id === serviceId),
    [services, serviceId]
  );
  const isEditing = Boolean(serviceToEdit);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [duration, setDuration] = useState('60');
  const [price, setPrice] = useState('0');
  const [category, setCategory] = useState('General');
  const [color, setColor] = useState(COLOR_PRESETS[0]);
  const [isActive, setIsActive] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    if (!serviceToEdit) {
      return;
    }

    setName(serviceToEdit.name || '');
    setDescription(serviceToEdit.description || '');
    setDuration(String(serviceToEdit.duration_minutes || 60));
    setPrice(String(serviceToEdit.price || 0));
    setCategory(serviceToEdit.category || 'General');
    setColor(serviceToEdit.color || COLOR_PRESETS[0]);
    setIsActive(Boolean(serviceToEdit.is_active));
  }, [serviceToEdit]);

  const onSave = async () => {
    const durationValue = Number(duration);
    const priceValue = Number(String(price).replace(',', '.'));

    if (!name.trim()) {
      Alert.alert('Missing details', 'Please enter service name.');
      return;
    }

    if (Number.isNaN(durationValue) || durationValue <= 0) {
      Alert.alert('Invalid duration', 'Duration must be greater than 0.');
      return;
    }

    if (Number.isNaN(priceValue) || priceValue < 0) {
      Alert.alert('Invalid price', 'Price must be a non-negative number.');
      return;
    }

    setIsSaving(true);
    setSaveError('');

    const payload = {
      name: name.trim(),
      description: description.trim(),
      duration_minutes: durationValue,
      price: priceValue,
      category: category.trim() || 'General',
      color: color.trim() || COLOR_PRESETS[0],
      is_active: isActive,
    };

    if (isEditing) {
      const { error } = await updateService(serviceToEdit.id, payload);
      setIsSaving(false);

      if (error) {
        setSaveError(error.message);
        Alert.alert('Update failed', error.message);
        return;
      }

      Alert.alert('Service updated', 'Service details were updated.');
    } else {
      const { error } = await addService(payload);
      setIsSaving(false);

      if (error) {
        setSaveError(error.message);
        Alert.alert('Save failed', error.message);
        return;
      }

      Alert.alert('Service saved', 'New service has been added.');
    }

    navigation.navigate(ROUTES.Services);
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
            {isEditing ? 'Edit Service' : 'Add Service'}
          </Text>

          <Text
            style={{
              color: COLORS.textSecondary,
              marginTop: 8,
              marginBottom: 24,
            }}
          >
            {isEditing
              ? 'Refine your premium offer details'
              : 'Create a premium service offer'}
          </Text>

          {saveError ? (
            <Text style={{ color: '#FCA5A5', marginBottom: 12 }}>{saveError}</Text>
          ) : null}

          <Field
            label="Name"
            value={name}
            onChangeText={setName}
            placeholder="Service name"
          />
          <Field
            label="Description"
            value={description}
            onChangeText={setDescription}
            placeholder="Service details"
            multiline
          />
          <Field
            label="Duration (minutes)"
            value={duration}
            onChangeText={setDuration}
            placeholder="60"
            keyboardType="number-pad"
          />
          <Field
            label="Price"
            value={price}
            onChangeText={setPrice}
            placeholder="0.00"
            keyboardType="decimal-pad"
          />
          <Field
            label="Category"
            value={category}
            onChangeText={setCategory}
            placeholder="Hair, Nails, Facial"
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
                  ? 'Update Service'
                  : 'Save Service'
            }
            onPress={onSave}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}
