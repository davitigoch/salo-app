import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import { COLORS } from '../constants/colors';

export default function SegmentedControl({ options, value, onChange, style }) {
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          backgroundColor: '#15151B',
          borderColor: '#2D2D38',
          borderWidth: 1,
          borderRadius: 14,
          padding: 4,
        },
        style,
      ]}
    >
      {options.map((option) => {
        const isSelected = value === option.key;

        return (
          <TouchableOpacity
            key={option.key}
            onPress={() => onChange(option.key)}
            style={{
              flex: 1,
              backgroundColor: isSelected ? '#231B3A' : 'transparent',
              borderRadius: 10,
              paddingVertical: 10,
              alignItems: 'center',
            }}
          >
            <Text
              style={{
                color: isSelected ? COLORS.textPrimary : COLORS.textSecondary,
                fontWeight: '700',
                fontSize: 13,
              }}
            >
              {option.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
