import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import ScreenContainer from '../components/ScreenContainer';
import PrimaryButton from '../components/PrimaryButton';
import { getBookingSiteBaseUrl, getPublicBookingUrl } from '../constants/bookingLink';
import { COLORS } from '../constants/colors';
import { ROUTES } from '../constants/routes';
import {
  DEFAULT_BUSINESS_HOURS,
  WEEKDAY_LABELS,
  formatTimeDisplay,
  normalizeBusinessHours,
  timeToMinutes,
} from '../constants/availability';
import { useAuth } from '../context/AuthContext';
import { useServices } from '../context/ServicesContext';
import { useStaff } from '../context/StaffContext';

const STEPS = [
  'Business Profile',
  'Services',
  'Team',
  'Business Hours',
  'Payment Settings',
  'Public Booking Link',
];

function Field({ label, value, onChangeText, placeholder, multiline = false, keyboardType = 'default' }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={{ color: COLORS.textSecondary, marginBottom: 8, fontSize: 12, letterSpacing: 0.3 }}>
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#737381"
        multiline={multiline}
        keyboardType={keyboardType}
        style={{
          backgroundColor: '#15151D',
          color: COLORS.textPrimary,
          borderColor: '#2A2A36',
          borderWidth: 1,
          borderRadius: 12,
          paddingHorizontal: 12,
          paddingVertical: 11,
          minHeight: multiline ? 96 : 46,
          textAlignVertical: multiline ? 'top' : 'center',
          fontSize: 14,
        }}
      />
    </View>
  );
}

function Pill({ text, active }) {
  return (
    <View
      style={{
        marginRight: 8,
        marginBottom: 8,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderWidth: 1,
        borderColor: active ? '#8B5CF6' : '#2D2D38',
        backgroundColor: active ? '#2C1B4E' : '#14141A',
      }}
    >
      <Text style={{ color: active ? '#E9D5FF' : COLORS.textSecondary, fontSize: 11, fontWeight: '700' }}>
        {text}
      </Text>
    </View>
  );
}

export default function OnboardingWizardScreen({ navigation }) {
  const {
    business,
    businessHours,
    saveBusinessHours,
    saveBusinessPaymentSettings,
    saveBusinessProfile,
    updatePublicBookingEnabled,
    completeOnboarding,
  } = useAuth();
  const { services, addService } = useServices();
  const { staff, addStaffMember } = useStaff();

  const [step, setStep] = useState(0);
  const [isSaving, setIsSaving] = useState(false);

  const [businessName, setBusinessName] = useState('');
  const [businessDescription, setBusinessDescription] = useState('');
  const [timezone, setTimezone] = useState('UTC');

  const [serviceName, setServiceName] = useState('');
  const [serviceDuration, setServiceDuration] = useState('60');
  const [servicePrice, setServicePrice] = useState('0');

  const [staffName, setStaffName] = useState('');
  const [staffEmail, setStaffEmail] = useState('');
  const [staffRole, setStaffRole] = useState('Stylist');

  const [draftHours, setDraftHours] = useState(DEFAULT_BUSINESS_HOURS);

  const [depositsEnabled, setDepositsEnabled] = useState(false);
  const [depositPercentage, setDepositPercentage] = useState('30');
  const [requireCardOnBooking, setRequireCardOnBooking] = useState(false);
  const [publicBookingEnabled, setPublicBookingEnabled] = useState(true);

  useEffect(() => {
    if (!business) {
      return;
    }

    setBusinessName(business.business_name || '');
    setBusinessDescription(business.description || '');
    setTimezone(business.timezone || 'UTC');
    setDepositsEnabled(Boolean(business.deposits_enabled));
    setDepositPercentage(String(Number(business.deposit_percentage ?? 30)));
    setRequireCardOnBooking(Boolean(business.require_card_on_booking));
    setPublicBookingEnabled(business.public_booking_enabled !== false);
  }, [business]);

  useEffect(() => {
    setDraftHours(normalizeBusinessHours(businessHours));
  }, [businessHours]);

  const bookingUrl = useMemo(() => {
    if (!business?.slug) {
      const baseUrl = getBookingSiteBaseUrl();
      return baseUrl ? `${baseUrl}/book/your-salon-slug` : '';
    }

    return getPublicBookingUrl(business.slug);
  }, [business?.slug]);

  const completedFlags = useMemo(() => {
    const profileDone = Boolean(businessName.trim()) && Boolean(timezone.trim());
    const servicesDone = services.length > 0;
    const teamDone = staff.length > 0;
    const hoursDone = draftHours.some((row) => !row.is_closed);
    return [profileDone, servicesDone, teamDone, hoursDone, true, false];
  }, [businessName, timezone, services.length, staff.length, draftHours]);

  const updateHour = (weekday, updates) => {
    setDraftHours((previous) =>
      previous.map((row) => (row.weekday === weekday ? { ...row, ...updates } : row))
    );
  };

  const onSaveBusinessProfile = async () => {
    if (!businessName.trim()) {
      Alert.alert('Missing information', 'Please enter your salon name.');
      return false;
    }

    if (!timezone.trim()) {
      Alert.alert('Missing information', 'Please enter your timezone.');
      return false;
    }

    setIsSaving(true);
    const { error } = await saveBusinessProfile({
      business_name: businessName,
      description: businessDescription,
      timezone,
    });
    setIsSaving(false);

    if (error) {
      Alert.alert('Save failed', error.message);
      return false;
    }

    return true;
  };

  const onAddService = async () => {
    const durationValue = Number(serviceDuration);
    const priceValue = Number(String(servicePrice).replace(',', '.'));

    if (!serviceName.trim()) {
      Alert.alert('Missing service', 'Please enter a service name.');
      return;
    }

    if (Number.isNaN(durationValue) || durationValue <= 0) {
      Alert.alert('Invalid duration', 'Duration must be greater than 0.');
      return;
    }

    if (Number.isNaN(priceValue) || priceValue < 0) {
      Alert.alert('Invalid price', 'Price must be 0 or higher.');
      return;
    }

    setIsSaving(true);
    const { error } = await addService({
      name: serviceName.trim(),
      description: '',
      duration_minutes: durationValue,
      price: priceValue,
      category: 'General',
      color: '#7C3AED',
      is_active: true,
    });
    setIsSaving(false);

    if (error) {
      Alert.alert('Could not add service', error.message);
      return;
    }

    setServiceName('');
    setServiceDuration('60');
    setServicePrice('0');
  };

  const onAddStaff = async () => {
    if (!staffName.trim()) {
      Alert.alert('Missing team member', 'Please enter a staff member name.');
      return;
    }

    setIsSaving(true);
    const { error } = await addStaffMember({
      name: staffName.trim(),
      email: staffEmail.trim(),
      role: staffRole.trim() || 'Stylist',
      avatar_url: '',
      color: '#7C3AED',
      is_active: true,
    });
    setIsSaving(false);

    if (error) {
      Alert.alert('Could not add team member', error.message);
      return;
    }

    setStaffName('');
    setStaffEmail('');
    setStaffRole('Stylist');
  };

  const onSaveBusinessHours = async () => {
    for (const row of draftHours) {
      if (row.is_closed) {
        continue;
      }
      const open = timeToMinutes(row.open_time);
      const close = timeToMinutes(row.close_time);
      if (open === null || close === null || close <= open) {
        Alert.alert('Invalid hours', `${WEEKDAY_LABELS[row.weekday]} has invalid hours.`);
        return false;
      }
    }

    setIsSaving(true);
    const { error } = await saveBusinessHours(draftHours);
    setIsSaving(false);

    if (error) {
      Alert.alert('Could not save business hours', error.message);
      return false;
    }

    return true;
  };

  const onSavePayment = async () => {
    const parsed = Number.parseFloat(depositPercentage);
    if (Number.isNaN(parsed) || parsed < 0 || parsed > 100) {
      Alert.alert('Invalid deposit', 'Deposit percentage must be between 0 and 100.');
      return false;
    }

    setIsSaving(true);
    const { error } = await saveBusinessPaymentSettings({
      deposits_enabled: depositsEnabled,
      deposit_percentage: Number(parsed.toFixed(2)),
      require_card_on_booking: requireCardOnBooking,
    });
    setIsSaving(false);

    if (error) {
      Alert.alert('Could not save payment settings', error.message);
      return false;
    }

    return true;
  };

  const onNext = async () => {
    if (step === 0) {
      const ok = await onSaveBusinessProfile();
      if (!ok) {
        return;
      }
      setStep(1);
      return;
    }

    if (step === 1) {
      if (services.length === 0) {
        Alert.alert('Add a service', 'Please add at least one service to continue.');
        return;
      }
      setStep(2);
      return;
    }

    if (step === 2) {
      if (staff.length === 0) {
        Alert.alert('Add a team member', 'Please add at least one staff member to continue.');
        return;
      }
      setStep(3);
      return;
    }

    if (step === 3) {
      const ok = await onSaveBusinessHours();
      if (!ok) {
        return;
      }
      setStep(4);
      return;
    }

    if (step === 4) {
      const ok = await onSavePayment();
      if (!ok) {
        return;
      }
      setStep(5);
      return;
    }

    if (step === 5) {
      setIsSaving(true);
      const { error: publicBookingError } = await updatePublicBookingEnabled(publicBookingEnabled);

      if (publicBookingError) {
        setIsSaving(false);
        Alert.alert('Could not save public booking setting', publicBookingError.message);
        return;
      }

      const { error } = await completeOnboarding();
      setIsSaving(false);

      if (error) {
        Alert.alert('Could not complete onboarding', error.message);
        return;
      }

      navigation.reset({
        index: 0,
        routes: [
          {
            name: ROUTES.MainTabs,
            params: { screen: ROUTES.Home },
          },
        ],
      });
    }
  };

  const onBack = () => {
    if (step === 0) {
      return;
    }
    setStep((previous) => previous - 1);
  };

  return (
    <ScreenContainer style={{ padding: 0 }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 56, paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
        >
          <Text style={{ color: COLORS.textPrimary, fontSize: 30, fontWeight: '700' }}>Welcome to SALO</Text>
          <Text style={{ color: COLORS.textSecondary, marginTop: 8 }}>
            Complete your setup to unlock your salon dashboard.
          </Text>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 16, marginBottom: 10 }}>
            {STEPS.map((label, index) => (
              <Pill key={label} text={label} active={index === step || (index < step && completedFlags[index])} />
            ))}
          </View>

          <View
            style={{
              backgroundColor: COLORS.card,
              borderRadius: 18,
              borderWidth: 1,
              borderColor: '#2A2A34',
              padding: 16,
              marginTop: 8,
            }}
          >
            {step === 0 ? (
              <>
                <Text style={{ color: COLORS.textPrimary, fontSize: 20, fontWeight: '700', marginBottom: 10 }}>
                  Business profile
                </Text>
                <Field label="Salon name" value={businessName} onChangeText={setBusinessName} placeholder="Aurora Salon" />
                <Field
                  label="Description"
                  value={businessDescription}
                  onChangeText={setBusinessDescription}
                  placeholder="Premium cuts, color, and skin treatments"
                  multiline
                />
                <Field label="Timezone" value={timezone} onChangeText={setTimezone} placeholder="America/New_York" />
              </>
            ) : null}

            {step === 1 ? (
              <>
                <Text style={{ color: COLORS.textPrimary, fontSize: 20, fontWeight: '700', marginBottom: 10 }}>
                  Add your first services
                </Text>
                <Field label="Service name" value={serviceName} onChangeText={setServiceName} placeholder="Haircut" />
                <Field
                  label="Duration (minutes)"
                  value={serviceDuration}
                  onChangeText={setServiceDuration}
                  placeholder="60"
                  keyboardType="number-pad"
                />
                <Field
                  label="Price"
                  value={servicePrice}
                  onChangeText={setServicePrice}
                  placeholder="45"
                  keyboardType="decimal-pad"
                />
                <PrimaryButton title={isSaving ? 'Adding...' : 'Add Service'} onPress={onAddService} />

                <Text style={{ color: COLORS.textSecondary, marginTop: 14, marginBottom: 6 }}>Current services</Text>
                {services.length ? (
                  services.slice(0, 6).map((service) => (
                    <View
                      key={service.id}
                      style={{
                        backgroundColor: '#14141B',
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: '#2A2A34',
                        padding: 10,
                        marginBottom: 8,
                      }}
                    >
                      <Text style={{ color: COLORS.textPrimary, fontWeight: '700' }}>{service.name}</Text>
                      <Text style={{ color: COLORS.textSecondary, marginTop: 2 }}>
                        {service.duration_minutes} min • ${Number(service.price || 0).toFixed(2)}
                      </Text>
                    </View>
                  ))
                ) : (
                  <Text style={{ color: '#71717A' }}>No services added yet.</Text>
                )}
              </>
            ) : null}

            {step === 2 ? (
              <>
                <Text style={{ color: COLORS.textPrimary, fontSize: 20, fontWeight: '700', marginBottom: 10 }}>
                  Add your team
                </Text>
                <Field label="Name" value={staffName} onChangeText={setStaffName} placeholder="Alex Rivera" />
                <Field label="Email" value={staffEmail} onChangeText={setStaffEmail} placeholder="alex@example.com" keyboardType="email-address" />
                <Field label="Role" value={staffRole} onChangeText={setStaffRole} placeholder="Stylist" />
                <PrimaryButton title={isSaving ? 'Adding...' : 'Add Team Member'} onPress={onAddStaff} />

                <Text style={{ color: COLORS.textSecondary, marginTop: 14, marginBottom: 6 }}>Current team</Text>
                {staff.length ? (
                  staff.slice(0, 8).map((member) => (
                    <View
                      key={member.id}
                      style={{
                        backgroundColor: '#14141B',
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: '#2A2A34',
                        padding: 10,
                        marginBottom: 8,
                      }}
                    >
                      <Text style={{ color: COLORS.textPrimary, fontWeight: '700' }}>{member.name}</Text>
                      <Text style={{ color: COLORS.textSecondary, marginTop: 2 }}>
                        {member.role || 'Stylist'}
                      </Text>
                    </View>
                  ))
                ) : (
                  <Text style={{ color: '#71717A' }}>No team members added yet.</Text>
                )}
              </>
            ) : null}

            {step === 3 ? (
              <>
                <Text style={{ color: COLORS.textPrimary, fontSize: 20, fontWeight: '700', marginBottom: 10 }}>
                  Set weekly business hours
                </Text>
                {draftHours.map((row) => (
                  <View
                    key={row.weekday}
                    style={{
                      backgroundColor: '#14141B',
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: '#2A2A34',
                      padding: 10,
                      marginBottom: 8,
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Text style={{ color: COLORS.textPrimary, fontWeight: '700' }}>{WEEKDAY_LABELS[row.weekday]}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={{ color: COLORS.textSecondary, marginRight: 8, fontSize: 12 }}>Closed</Text>
                        <Switch
                          value={Boolean(row.is_closed)}
                          onValueChange={(value) => updateHour(row.weekday, { is_closed: value })}
                          trackColor={{ false: '#3A3A46', true: '#45305F' }}
                          thumbColor={row.is_closed ? '#A78BFA' : '#F4F4F5'}
                        />
                      </View>
                    </View>

                    {!row.is_closed ? (
                      <View style={{ marginTop: 8 }}>
                        <Field
                          label="Open (HH:MM)"
                          value={row.open_time}
                          onChangeText={(value) => updateHour(row.weekday, { open_time: value })}
                          placeholder="09:00"
                        />
                        <Field
                          label="Close (HH:MM)"
                          value={row.close_time}
                          onChangeText={(value) => updateHour(row.weekday, { close_time: value })}
                          placeholder="18:00"
                        />
                        <Text style={{ color: COLORS.textSecondary, fontSize: 11 }}>
                          {formatTimeDisplay(row.open_time)} - {formatTimeDisplay(row.close_time)}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                ))}
              </>
            ) : null}

            {step === 4 ? (
              <>
                <Text style={{ color: COLORS.textPrimary, fontSize: 20, fontWeight: '700', marginBottom: 10 }}>
                  Payment settings (optional)
                </Text>
                <View
                  style={{
                    backgroundColor: '#14141B',
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: '#2A2A34',
                    padding: 12,
                    marginBottom: 10,
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ color: COLORS.textPrimary, fontWeight: '600' }}>Enable deposits</Text>
                  <Switch
                    value={depositsEnabled}
                    onValueChange={setDepositsEnabled}
                    trackColor={{ false: '#353543', true: '#5B21B6' }}
                    thumbColor={depositsEnabled ? '#A78BFA' : '#9CA3AF'}
                  />
                </View>

                <Field
                  label="Deposit percentage"
                  value={depositPercentage}
                  onChangeText={setDepositPercentage}
                  placeholder="30"
                  keyboardType="decimal-pad"
                />

                <View
                  style={{
                    backgroundColor: '#14141B',
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: '#2A2A34',
                    padding: 12,
                    marginTop: 4,
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ color: COLORS.textPrimary, fontWeight: '600', flex: 1, paddingRight: 8 }}>
                    Require card on booking
                  </Text>
                  <Switch
                    value={requireCardOnBooking}
                    onValueChange={setRequireCardOnBooking}
                    trackColor={{ false: '#353543', true: '#5B21B6' }}
                    thumbColor={requireCardOnBooking ? '#A78BFA' : '#9CA3AF'}
                  />
                </View>
              </>
            ) : null}

            {step === 5 ? (
              <>
                <Text style={{ color: COLORS.textPrimary, fontSize: 20, fontWeight: '700', marginBottom: 10 }}>
                  Public booking link preview
                </Text>
                <View
                  style={{
                    backgroundColor: '#14141B',
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: '#2A2A34',
                    padding: 12,
                  }}
                >
                  <Text style={{ color: COLORS.textSecondary, fontSize: 12 }}>Share this booking page</Text>
                  <Text style={{ color: '#DDD6FE', marginTop: 6, fontSize: 14, fontWeight: '600' }}>
                    {bookingUrl}
                  </Text>
                </View>

                {!publicBookingEnabled ? (
                  <Text
                    style={{
                      color: '#FCA5A5',
                      marginTop: 12,
                      fontSize: 13,
                      lineHeight: 18,
                    }}
                  >
                    Public booking is currently disabled.
                  </Text>
                ) : null}

                <View
                  style={{
                    backgroundColor: '#14141B',
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: '#2A2A34',
                    padding: 12,
                    marginTop: 12,
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ color: COLORS.textPrimary, fontWeight: '600', flex: 1, paddingRight: 8 }}>
                    Public online booking
                  </Text>
                  <Switch
                    value={publicBookingEnabled}
                    onValueChange={setPublicBookingEnabled}
                    trackColor={{ false: '#353543', true: '#5B21B6' }}
                    thumbColor={publicBookingEnabled ? '#A78BFA' : '#9CA3AF'}
                  />
                </View>

                <Text style={{ color: COLORS.textSecondary, marginTop: 12, lineHeight: 20 }}>
                  Tap Finish Setup to mark onboarding complete and open your dashboard.
                </Text>
              </>
            ) : null}
          </View>

          <View style={{ flexDirection: 'row', marginTop: 16 }}>
            <TouchableOpacity
              onPress={onBack}
              disabled={step === 0 || isSaving}
              style={{
                flex: 1,
                backgroundColor: step === 0 ? '#121217' : '#161621',
                borderWidth: 1,
                borderColor: '#2A2A34',
                borderRadius: 14,
                minHeight: 50,
                alignItems: 'center',
                justifyContent: 'center',
                marginRight: 8,
                opacity: step === 0 ? 0.5 : 1,
              }}
            >
              <Text style={{ color: COLORS.textPrimary, fontWeight: '700' }}>Back</Text>
            </TouchableOpacity>

            <View style={{ flex: 2, marginLeft: 8 }}>
              <PrimaryButton
                title={
                  isSaving
                    ? 'Saving...'
                    : step === STEPS.length - 1
                      ? 'Finish Setup'
                      : 'Save & Continue'
                }
                onPress={onNext}
              />
            </View>
          </View>

        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}
