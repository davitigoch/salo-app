import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { COLORS } from '../constants/colors';

export default function ScreenContainer({ children, centered = false, style }) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        {
          flex: 1,
          backgroundColor: COLORS.background,
          paddingTop: centered ? 0 : insets.top,
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
