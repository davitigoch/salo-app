import React from 'react';
import { TouchableOpacity, Text } from 'react-native';

import { COLORS } from '../constants/colors';

export default function PrimaryButton({ title, onPress, fullWidth = false, style }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        {
          backgroundColor: COLORS.accent,
          padding: 18,
          borderRadius: 20,
        },
        fullWidth ? { width: '100%' } : null,
        style,
      ]}
    >
      <Text
        style={{
          color: COLORS.textPrimary,
          textAlign: 'center',
          fontWeight: '600',
          fontSize: 16,
        }}
      >
        {title}
      </Text>
    </TouchableOpacity>
  );
}
