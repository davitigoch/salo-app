import React from 'react';
import { TouchableOpacity, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ROUTES } from '../constants/routes';
import { COLORS } from '../constants/colors';

export default function BackButton({ navigation }) {
  const insets = useSafeAreaInsets();

  const onPress = () => {
    if (!navigation) {
      return;
    }

    if (navigation.canGoBack?.()) {
      navigation.goBack();
      return;
    }

    navigation.navigate(ROUTES.MainTabs, { screen: ROUTES.Home });
  };

  return (
    <View
      style={{
        position: 'absolute',
        top: insets.top + 10,
        left: 16,
        zIndex: 20,
      }}
    >
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.85}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: '#16161D',
          borderWidth: 1,
          borderColor: '#312E81',
          borderRadius: 14,
          paddingHorizontal: 10,
          paddingVertical: 8,
        }}
      >
        <Ionicons name="arrow-back" size={18} color={COLORS.accent} />
        <Text
          style={{
            color: COLORS.textPrimary,
            fontSize: 12,
            fontWeight: '700',
            marginLeft: 4,
            letterSpacing: 0.2,
          }}
        >
          Back
        </Text>
      </TouchableOpacity>
    </View>
  );
}