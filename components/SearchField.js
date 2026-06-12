import React from 'react';
import { View, TextInput, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { COLORS } from '../constants/colors';

export default function SearchField({
  value,
  onChangeText,
  placeholder = 'Search',
  autoCapitalize = 'none',
  autoCorrect = false,
  style,
}) {
  const hasValue = Boolean(String(value || '').length);

  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: COLORS.card,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: '#27272A',
          paddingHorizontal: 12,
          minHeight: 48,
        },
        style,
      ]}
    >
      <Ionicons name="search" size={18} color={COLORS.textSecondary} />

      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={COLORS.textSecondary}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        returnKeyType="search"
        clearButtonMode="never"
        style={{
          flex: 1,
          color: COLORS.textPrimary,
          fontSize: 15,
          paddingVertical: 10,
          paddingHorizontal: 10,
        }}
      />

      {hasValue ? (
        <TouchableOpacity
          onPress={() => onChangeText('')}
          hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
        >
          <Ionicons name="close-circle" size={18} color={COLORS.textSecondary} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
