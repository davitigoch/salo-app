import React, { useState } from 'react';
import { TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { COLORS } from '../constants/colors';

export default function PasswordInput({
  value,
  onChangeText,
  placeholder = 'Password',
  editable = true,
  style,
  inputStyle,
  autoCapitalize = 'none',
  autoCorrect = false,
}) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: COLORS.card,
          borderColor: '#27272A',
          borderWidth: 1,
          borderRadius: 14,
          paddingLeft: 14,
          paddingRight: 6,
          minHeight: 52,
        },
        style,
      ]}
    >
      <TextInput
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={!isVisible}
        editable={editable}
        placeholder={placeholder}
        placeholderTextColor={COLORS.textSecondary}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        textContentType="password"
        style={[
          {
            flex: 1,
            color: COLORS.textPrimary,
            height: 52,
            fontSize: 15,
          },
          inputStyle,
        ]}
      />

      <TouchableOpacity
        onPress={() => setIsVisible((previous) => !previous)}
        hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
        accessibilityRole="button"
        accessibilityLabel={isVisible ? 'Hide password' : 'Show password'}
        style={{
          width: 44,
          height: 44,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons
          name={isVisible ? 'eye-off' : 'eye'}
          size={20}
          color={COLORS.textSecondary}
        />
      </TouchableOpacity>
    </View>
  );
}
