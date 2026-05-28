import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Platform, ScrollView, Switch, Text, TouchableOpacity, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';

import BackButton from '../components/BackButton';
import PrimaryButton from '../components/PrimaryButton';
import ScreenContainer from '../components/ScreenContainer';
import {
  formatTimeDisplay,
  normalizeBusinessHours,
  timeToMinutes,
  WEEKDAY_LABELS,
} from '../constants/availability';
import { COLORS } from '../constants/colors';
import { useStaff } from '../context/StaffContext';

function timeStringToDate(value) {
  const [hours, minutes] = String(value || '09:00').split(':').map((part) => Number(part));
  const date = new Date();
  date.setHours(Number.isNaN(hours) ? 9 : hours, Number.isNaN(minutes) ? 0 : minutes, 0, 0);
  return date;
}

function dateToTimeString(value) {
  return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
}

export default function StaffAvailabilityScreen({ navigation, route }) {
  const staffId = route?.params?.staffId;
  const {
    staff,
    staffAvailability,
    isStaffAvailabilityLoading,
    staffAvailabilityError,
    saveStaffAvailability,
  } = useStaff();

  const selectedStaff = useMemo(
    () => staff.find((member) => member.id === staffId),
    [staff, staffId]
  );

  const normalizedRows = useMemo(() => {
    const matching = (staffAvailability || []).filter((row) => row.staff_member_id === staffId);
    return normalizeBusinessHours(matching);
  }, [staffAvailability, staffId]);

  const [draftRows, setDraftRows] = useState(normalizedRows);
  const [isSaving, setIsSaving] = useState(false);
  const [pickerState, setPickerState] = useState(null);

  useEffect(() => {
    setDraftRows(normalizedRows);
  }, [normalizedRows]);

  const updateDay = (weekday, updates) => {
    setDraftRows((previous) =>
      previous.map((row) => (row.weekday === weekday ? { ...row, ...updates } : row))
    );
  };

  const onSave = async () => {
    for (const day of draftRows) {
      if (day.is_closed) {
        continue;
      }

      const open = timeToMinutes(day.open_time);
      const close = timeToMinutes(day.close_time);
      if (open === null || close === null || close <= open) {
        Alert.alert(
          'Invalid hours',
          `${WEEKDAY_LABELS[day.weekday]} requires close time later than open time.`
        );
        return;
      }
    }

    setIsSaving(true);
    const { error } = await saveStaffAvailability(staffId, draftRows);
    setIsSaving(false);

    if (error) {
      Alert.alert('Save failed', error.message);
      return;
    }

    Alert.alert('Saved', 'Staff availability updated.');
  };

  const pickerValue = useMemo(() => {
    if (!pickerState) {
      return new Date();
    }

    const row = draftRows.find((item) => item.weekday === pickerState.weekday);
    return timeStringToDate(row?.[pickerState.field]);
  }, [draftRows, pickerState]);

  return (
    <ScreenContainer style={{ paddingTop: 0 }}>
      <BackButton navigation={navigation} />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingTop: 92,
          paddingBottom: 40,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={{ color: COLORS.textPrimary, fontSize: 30, fontWeight: '700' }}>
          Staff Availability
        </Text>

        <Text style={{ color: COLORS.textSecondary, marginTop: 8, marginBottom: 18 }}>
          {selectedStaff?.name
            ? `${selectedStaff.name} weekly schedule`
            : 'Set weekly schedule for this team member'}
        </Text>

        {isStaffAvailabilityLoading ? (
          <Text style={{ color: COLORS.textSecondary, marginBottom: 12 }}>
            Loading availability...
          </Text>
        ) : null}

        {staffAvailabilityError ? (
          <Text style={{ color: '#FCA5A5', marginBottom: 12 }}>{staffAvailabilityError}</Text>
        ) : null}

        {draftRows.map((day) => (
          <View
            key={day.weekday}
            style={{
              backgroundColor: COLORS.card,
              borderRadius: 18,
              padding: 16,
              borderWidth: 1,
              borderColor: '#2A2A33',
              marginBottom: 12,
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: COLORS.textPrimary, fontSize: 17, fontWeight: '700' }}>
                {WEEKDAY_LABELS[day.weekday]}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ color: COLORS.textSecondary, marginRight: 8 }}>Closed</Text>
                <Switch
                  value={Boolean(day.is_closed)}
                  onValueChange={(value) => updateDay(day.weekday, { is_closed: value })}
                  trackColor={{ false: '#3A3A46', true: '#45305F' }}
                  thumbColor={day.is_closed ? '#A78BFA' : '#F4F4F5'}
                />
              </View>
            </View>

            {day.is_closed ? (
              <Text style={{ color: COLORS.textSecondary, marginTop: 10 }}>Unavailable all day.</Text>
            ) : (
              <View style={{ flexDirection: 'row', marginTop: 12 }}>
                <TouchableOpacity
                  onPress={() => setPickerState({ weekday: day.weekday, field: 'open_time' })}
                  style={{
                    flex: 1,
                    backgroundColor: '#16161D',
                    borderWidth: 1,
                    borderColor: '#2D2D38',
                    borderRadius: 12,
                    padding: 12,
                    marginRight: 8,
                  }}
                >
                  <Text style={{ color: COLORS.textSecondary, fontSize: 12 }}>Open</Text>
                  <Text style={{ color: COLORS.textPrimary, marginTop: 3, fontWeight: '600' }}>
                    {formatTimeDisplay(day.open_time)}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => setPickerState({ weekday: day.weekday, field: 'close_time' })}
                  style={{
                    flex: 1,
                    backgroundColor: '#16161D',
                    borderWidth: 1,
                    borderColor: '#2D2D38',
                    borderRadius: 12,
                    padding: 12,
                    marginLeft: 8,
                  }}
                >
                  <Text style={{ color: COLORS.textSecondary, fontSize: 12 }}>Close</Text>
                  <Text style={{ color: COLORS.textPrimary, marginTop: 3, fontWeight: '600' }}>
                    {formatTimeDisplay(day.close_time)}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        ))}

        <PrimaryButton
          title={isSaving ? 'Saving...' : 'Save Staff Availability'}
          onPress={onSave}
        />
      </ScrollView>

      {pickerState ? (
        <View
          style={{
            backgroundColor: COLORS.card,
            borderTopWidth: 1,
            borderColor: '#2A2A33',
            paddingBottom: Platform.OS === 'ios' ? 20 : 0,
          }}
        >
          <DateTimePicker
            mode="time"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            value={pickerValue}
            onChange={(_event, selectedValue) => {
              if (!selectedValue) {
                if (Platform.OS !== 'ios') {
                  setPickerState(null);
                }
                return;
              }

              updateDay(pickerState.weekday, {
                [pickerState.field]: dateToTimeString(selectedValue),
              });

              if (Platform.OS !== 'ios') {
                setPickerState(null);
              }
            }}
            themeVariant="dark"
          />

          {Platform.OS === 'ios' ? (
            <PrimaryButton
              title="Done"
              onPress={() => setPickerState(null)}
              style={{ marginHorizontal: 24, marginTop: 6, marginBottom: 10 }}
            />
          ) : null}
        </View>
      ) : null}
    </ScreenContainer>
  );
}
