import React from 'react';
import { View } from 'react-native';

import { COLORS } from '../constants/colors';

export default function ScreenContainer({ children, centered = false, style }) {
  return (
    <View
      style={[
        {
          flex: 1,
          backgroundColor: COLORS.background,
        },
        centered
          ? {
              justifyContent: 'center',
              alignItems: 'center',
            }
          : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}
