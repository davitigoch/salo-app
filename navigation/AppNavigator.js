import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { DEFAULT_BUSINESS_HOURS, normalizeBusinessHours } from '../constants/availability';
import { ROUTES } from '../constants/routes';
import {
  cancelBookingReminders,
  syncBookingReminders,
} from '../notifications/bookingReminders';
import { registerForPushNotificationsAsync } from '../notifications/pushTokens';
import { supabase } from '../constants/supabase';
import { AuthProvider } from '../context/AuthContext';
import { BookingsProvider } from '../context/BookingsContext';
import { ClientsProvider } from '../context/ClientsContext';
import { ServicesProvider } from '../context/ServicesContext';
import { StaffProvider } from '../context/StaffContext';
import AuthLoadingScreen from '../screens/AuthLoadingScreen';
import WelcomeScreen from '../screens/WelcomeScreen';
import LoginScreen from '../screens/LoginScreen';
import AddBookingScreen from '../screens/AddBookingScreen';
import AddClientScreen from '../screens/AddClientScreen';
import ServicesScreen from '../screens/ServicesScreen';
import AddServiceScreen from '../screens/AddServiceScreen';
import StaffScreen from '../screens/StaffScreen';
import AddStaffScreen from '../screens/AddStaffScreen';
import StaffAvailabilityScreen from '../screens/StaffAvailabilityScreen';
import BusinessHoursScreen from '../screens/BusinessHoursScreen';
import WeeklyCalendarScreen from '../screens/WeeklyCalendarScreen';
import DailyScheduleScreen from '../screens/DailyScheduleScreen';
import OnboardingWizardScreen from '../screens/OnboardingWizardScreen';
import PaymentSettingsScreen from '../screens/PaymentSettingsScreen';
import NotificationSettingsScreen from '../screens/NotificationSettingsScreen';
import PublicBookingScreen from '../screens/PublicBookingScreen';
import ClientAppointmentPortalScreen from '../screens/ClientAppointmentPortalScreen';
import MainTabNavigator from './MainTabNavigator';

const linking = {
  config: {
    screens: {
      AuthLoading: 'loading',
      Welcome: '',
      Login: 'login',
      OnboardingWizard: 'onboarding',
      AppointmentPortal: 'appointment/:bookingToken',
      PublicBooking: 'book/:businessSlug',
      MainTabs: 'app',
      AddBooking: 'booking/new',
      AddClient: 'client/new',
      Services: 'services',
      AddService: 'service/new',
      Staff: 'team',
      AddStaff: 'team/new',
      StaffAvailability: 'team/availability',
      BusinessHours: 'hours',
      WeeklyCalendar: 'calendar',
      DailySchedule: 'calendar/day',
      PaymentSettings: 'settings/payment',
      NotificationSettings: 'settings/notifications',
    },
  },
};

const Stack = createNativeStackNavigator();
const BUSINESS_SELECT_COLUMNS = 'id, owner_user_id, business_name, slug, description, timezone, services, public_booking_enabled, onboarding_completed, deposits_enabled, deposit_percentage, require_card_on_booking, stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled, created_at';
const BUSINESS_BOOTSTRAP_TIMEOUT_MS = 15000;

function isValidBookingDateText(value) {
  if (typeof value !== 'string') {
    return false;
  }

  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }

  if (year < 2000 || year > 2100) {
    return false;
  }

  const parsed = new Date(year, month - 1, day, 0, 0, 0, 0);
  return parsed.getFullYear() === year
    && parsed.getMonth() === month - 1
    && parsed.getDate() === day;
}

function isValidBookingTimeText(value) {
  if (typeof value !== 'string') {
    return false;
  }

  const match = value.trim().match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    return false;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  return Number.isInteger(hours)
    && Number.isInteger(minutes)
    && hours >= 0
    && hours <= 23
    && minutes >= 0
    && minutes <= 59;
}

function normalizeOnboardingStatus(businessRecord) {
  if (!businessRecord) {
    return null;
  }

  if (typeof businessRecord.onboarding_completed === 'boolean') {
    return businessRecord;
  }

  const createdAtValue = new Date(businessRecord.created_at || 0).getTime();
  const hasValidCreatedAt = !Number.isNaN(createdAtValue) && createdAtValue > 0;
  const isNewBusiness = hasValidCreatedAt
    ? Date.now() - createdAtValue <= 24 * 60 * 60 * 1000
    : false;

  const normalized = {
    ...businessRecord,
    onboarding_completed: !isNewBusiness,
  };

  console.log('[SALO] onboarding status normalized', {
    businessId: businessRecord.id,
    sourceValue: businessRecord.onboarding_completed,
    normalizedValue: normalized.onboarding_completed,
    isNewBusiness,
  });

  return normalized;
}

export default function AppNavigator() {
  const [session, setSession] = useState(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [unauthStartRoute, setUnauthStartRoute] = useState(ROUTES.Welcome);
  const [business, setBusiness] = useState(null);
  const [isBusinessLoading, setIsBusinessLoading] = useState(false);
  const [businessError, setBusinessError] = useState('');
  const [bookings, setBookings] = useState([]);
  const [isBookingsLoading, setIsBookingsLoading] = useState(false);
  const [bookingsError, setBookingsError] = useState('');
  const [clients, setClients] = useState([]);
  const [isClientsLoading, setIsClientsLoading] = useState(false);
  const [clientsError, setClientsError] = useState('');
  const [services, setServices] = useState([]);
  const [isServicesLoading, setIsServicesLoading] = useState(false);
  const [servicesError, setServicesError] = useState('');
  const [staff, setStaff] = useState([]);
  const [isStaffLoading, setIsStaffLoading] = useState(false);
  const [staffError, setStaffError] = useState('');
  const [staffAvailability, setStaffAvailability] = useState([]);
  const [isStaffAvailabilityLoading, setIsStaffAvailabilityLoading] = useState(false);
  const [staffAvailabilityError, setStaffAvailabilityError] = useState('');
  const [businessHours, setBusinessHours] = useState([]);
  const [isBusinessHoursLoading, setIsBusinessHoursLoading] = useState(false);
  const [businessHoursError, setBusinessHoursError] = useState('');
  const [businessBootstrapError, setBusinessBootstrapError] = useState('');

  useEffect(() => {
    let isMounted = true;

    async function loadSession() {
      console.log('[SALO] session load start');
      const {
        data: { session: currentSession },
      } = await supabase.auth.getSession();

      console.log('[SALO] session loaded', {
        hasSession: Boolean(currentSession),
        userId: currentSession?.user?.id || null,
      });

      if (isMounted) {
        setSession(currentSession);
        setIsAuthLoading(false);
      }
    }

    loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      console.log('[SALO] auth state changed', {
        event,
        hasSession: Boolean(nextSession),
        userId: nextSession?.user?.id || null,
      });
      setSession(nextSession);
      if (event === 'SIGNED_OUT') {
        setUnauthStartRoute(ROUTES.Login);
      }
      setIsAuthLoading(false);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const userId = session?.user?.id;

    if (!userId) {
      return;
    }

    console.log('PUSH registration started');
    console.log('PUSH user id', userId);

    registerForPushNotificationsAsync(userId).then((result) => {
      if (result?.status === 'saved') {
        console.log('PUSH saved', { userId });
        return;
      }

      if (result?.status === 'denied') {
        console.log('PUSH requested permission', 'denied');
        return;
      }

      if (result?.status === 'error') {
        console.log('PUSH error', {
          userId,
          reason: result?.reason || 'unknown_error',
        });
      }
    });
  }, [session?.user?.id]);

  const fetchBookings = useCallback(async () => {
    if (!session?.user?.id) {
      setBookings([]);
      return { error: null };
    }

    setIsBookingsLoading(true);
    setBookingsError('');

    const { data, error } = await supabase
      .from('bookings')
      .select('id, client_name, service, date, time, status, price, notes, staff_member_id, booking_metadata, user_id, created_at')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      setBookingsError(error.message);
      setIsBookingsLoading(false);
      return { error };
    }

    setBookings(Array.isArray(data) ? data : []);
    setIsBookingsLoading(false);
    return { error: null };
  }, [session?.user?.id]);

  useEffect(() => {
    fetchBookings();
  }, [fetchBookings]);

  const fetchOrCreateBusiness = useCallback(async () => {
    if (!session?.user?.id) {
      console.log('[SALO] business bootstrap skipped (no session)');
      setBusiness(null);
      setBusinessBootstrapError('');
      setIsBusinessLoading(false);
      return { error: null };
    }

    console.log('[SALO] business fetch start', { userId: session.user.id });

    setIsBusinessLoading(true);
    setBusinessError('');
    setBusinessBootstrapError('');

    const { data, error } = await supabase
      .from('businesses')
      .select(BUSINESS_SELECT_COLUMNS)
      .eq('owner_user_id', session.user.id)
      .order('created_at', { ascending: true });

    console.log('[SALO] business fetch end', {
      userId: session.user.id,
      resultCount: Array.isArray(data) ? data.length : 0,
      hasError: Boolean(error),
      errorMessage: error?.message || null,
    });

    if (error) {
      setBusinessError(error.message);
      setBusinessBootstrapError(`Could not load business profile: ${error.message}`);
      setIsBusinessLoading(false);
      return { error };
    }

    if (Array.isArray(data) && data.length > 0) {
      const normalizedBusiness = normalizeOnboardingStatus(data[0]);
      console.log('[SALO] business found', {
        businessId: normalizedBusiness?.id,
        onboardingCompleted: normalizedBusiness?.onboarding_completed,
      });
      setBusiness(normalizedBusiness);
      setIsBusinessLoading(false);
      return { error: null };
    }

    console.log('[SALO] business missing, creating default business', { userId: session.user.id });

    const slugBase = String(session.user.email || 'salo')
      .split('@')[0]
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'salo';
    const businessName = `${slugBase.replace(/-/g, ' ')} Salon`.replace(/\b\w/g, (letter) => letter.toUpperCase());

    let { data: createdBusiness, error: createError } = await supabase
      .from('businesses')
      .insert({
        owner_user_id: session.user.id,
        business_name: businessName,
        slug: slugBase,
        description: 'Luxury salon booking experience',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      })
      .select(BUSINESS_SELECT_COLUMNS)
      .single();

    if (createError && createError.code === '23505') {
      const fallbackSlug = `${slugBase}-${session.user.id.slice(0, 6)}`;
      const fallbackResult = await supabase
        .from('businesses')
        .insert({
          owner_user_id: session.user.id,
          business_name: businessName,
          slug: fallbackSlug,
          description: 'Luxury salon booking experience',
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        })
        .select(BUSINESS_SELECT_COLUMNS)
        .single();

      createdBusiness = fallbackResult.data;
      createError = fallbackResult.error;
    }

    if (createError) {
      setBusinessError(createError.message);
      setBusinessBootstrapError(`Could not create default business: ${createError.message}`);
      setIsBusinessLoading(false);
      return { error: createError };
    }

    if (!createdBusiness) {
      const fallbackError = { message: 'Business bootstrap returned no data.' };
      setBusinessError(fallbackError.message);
      setBusinessBootstrapError('Could not complete business setup. Please retry or logout.');
      setIsBusinessLoading(false);
      return { error: fallbackError };
    }

    const normalizedCreatedBusiness = normalizeOnboardingStatus(createdBusiness);
    console.log('[SALO] business created', {
      businessId: normalizedCreatedBusiness?.id,
      onboardingCompleted: normalizedCreatedBusiness?.onboarding_completed,
    });
    setBusiness(normalizedCreatedBusiness);
    setIsBusinessLoading(false);
    return { error: null };
  }, [session?.user?.email, session?.user?.id]);

  const retryBusinessBootstrap = useCallback(async () => {
    console.log('[SALO] business bootstrap retry triggered');
    setBusinessBootstrapError('');
    await fetchOrCreateBusiness();
  }, [fetchOrCreateBusiness]);

  useEffect(() => {
    if (!session?.user?.id || !isBusinessLoading) {
      return undefined;
    }

    const timeoutId = setTimeout(() => {
      console.log('[SALO] business fetch timeout fallback triggered', {
        userId: session.user.id,
      });
      setIsBusinessLoading(false);
      setBusinessBootstrapError('Session setup is taking too long. Please retry or logout.');
    }, BUSINESS_BOOTSTRAP_TIMEOUT_MS);

    return () => clearTimeout(timeoutId);
  }, [isBusinessLoading, session?.user?.id]);

  useEffect(() => {
    fetchOrCreateBusiness();
  }, [fetchOrCreateBusiness]);

  const fetchBusinessHours = useCallback(async () => {
    if (!business?.id) {
      setBusinessHours([]);
      return { error: null };
    }

    setIsBusinessHoursLoading(true);
    setBusinessHoursError('');

    const { data, error } = await supabase
      .from('business_hours')
      .select('id, business_id, weekday, is_closed, open_time, close_time, created_at, updated_at')
      .eq('business_id', business.id)
      .order('weekday', { ascending: true });

    if (error) {
      setBusinessHoursError(error.message);
      setIsBusinessHoursLoading(false);
      return { error };
    }

    const existingByWeekday = new Map((data || []).map((row) => [row.weekday, row]));
    const missingRows = DEFAULT_BUSINESS_HOURS
      .filter((defaultRow) => !existingByWeekday.has(defaultRow.weekday))
      .map((defaultRow) => ({
        business_id: business.id,
        weekday: defaultRow.weekday,
        is_closed: defaultRow.is_closed,
        open_time: defaultRow.open_time,
        close_time: defaultRow.close_time,
      }));

    if (missingRows.length) {
      const { error: upsertError } = await supabase
        .from('business_hours')
        .upsert(missingRows, { onConflict: 'business_id,weekday' });

      if (upsertError) {
        setBusinessHoursError(upsertError.message);
        setIsBusinessHoursLoading(false);
        return { error: upsertError };
      }

      const refetch = await supabase
        .from('business_hours')
        .select('id, business_id, weekday, is_closed, open_time, close_time, created_at, updated_at')
        .eq('business_id', business.id)
        .order('weekday', { ascending: true });

      if (refetch.error) {
        setBusinessHoursError(refetch.error.message);
        setIsBusinessHoursLoading(false);
        return { error: refetch.error };
      }

      setBusinessHours(normalizeBusinessHours(refetch.data));
      setIsBusinessHoursLoading(false);
      return { error: null };
    }

    setBusinessHours(normalizeBusinessHours(data));
    setIsBusinessHoursLoading(false);
    return { error: null };
  }, [business?.id]);

  useEffect(() => {
    fetchBusinessHours();
  }, [fetchBusinessHours]);

  const saveBusinessHours = async (hoursInput) => {
    if (!business?.id || !session?.user?.id) {
      return { error: { message: 'Business is not ready yet.' } };
    }

    setBusinessHoursError('');

    const payload = normalizeBusinessHours(hoursInput).map((row) => ({
      business_id: business.id,
      weekday: row.weekday,
      is_closed: Boolean(row.is_closed),
      open_time: row.open_time,
      close_time: row.close_time,
    }));

    const { error } = await supabase
      .from('business_hours')
      .upsert(payload, { onConflict: 'business_id,weekday' });

    if (error) {
      setBusinessHoursError(error.message);
      return { error };
    }

    await fetchBusinessHours();
    return { error: null };
  };

  const saveBusinessPaymentSettings = async (settingsInput) => {
    if (!business?.id || !session?.user?.id) {
      return { error: { message: 'Business is not ready yet.' } };
    }

    setBusinessError('');

    const payload = {
      deposits_enabled: Boolean(settingsInput?.deposits_enabled),
      deposit_percentage: Number(settingsInput?.deposit_percentage ?? 0),
      require_card_on_booking: Boolean(settingsInput?.require_card_on_booking),
    };

    const { data, error } = await supabase
      .from('businesses')
      .update(payload)
      .eq('id', business.id)
      .eq('owner_user_id', session.user.id)
      .select(BUSINESS_SELECT_COLUMNS)
      .single();

    if (error) {
      setBusinessError(error.message);
      return { error };
    }

    setBusiness(normalizeOnboardingStatus(data));
    return { error: null };
  };

  const saveBusinessProfile = async (profileInput) => {
    if (!business?.id || !session?.user?.id) {
      return { error: { message: 'Business is not ready yet.' } };
    }

    setBusinessError('');

    const payload = {
      business_name: String(profileInput?.business_name || '').trim(),
      description: String(profileInput?.description || '').trim(),
      timezone: String(profileInput?.timezone || 'UTC').trim() || 'UTC',
    };

    const { data, error } = await supabase
      .from('businesses')
      .update(payload)
      .eq('id', business.id)
      .eq('owner_user_id', session.user.id)
      .select(BUSINESS_SELECT_COLUMNS)
      .single();

    if (error) {
      setBusinessError(error.message);
      return { error };
    }

    setBusiness(normalizeOnboardingStatus(data));
    return { error: null };
  };

  const completeOnboarding = async () => {
    if (!business?.id || !session?.user?.id) {
      return { error: { message: 'Business is not ready yet.' } };
    }

    setBusinessError('');

    const { data, error } = await supabase
      .from('businesses')
      .update({ onboarding_completed: true })
      .eq('id', business.id)
      .eq('owner_user_id', session.user.id)
      .select(BUSINESS_SELECT_COLUMNS)
      .single();

    if (error) {
      setBusinessError(error.message);
      return { error };
    }

    setBusiness(normalizeOnboardingStatus(data));
    return { error: null };
  };

  useEffect(() => {
    if (!session?.user?.id) {
      return undefined;
    }

    const bookingsChannel = supabase
      .channel(`bookings-changes-${session.user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bookings',
          filter: `user_id=eq.${session.user.id}`,
        },
        () => {
          fetchBookings();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(bookingsChannel);
    };
  }, [fetchBookings, session?.user?.id]);

  useEffect(() => {
    if (!session?.user?.id) {
      return;
    }

    syncBookingReminders(bookings);
  }, [bookings, session?.user?.id]);

  const fetchClients = useCallback(async () => {
    if (!session?.user?.id) {
      setClients([]);
      return { error: null };
    }

    setIsClientsLoading(true);
    setClientsError('');

    const { data, error } = await supabase
      .from('clients')
      .select('id, client_name, phone, email, notes, user_id, created_at')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      setClientsError(error.message);
      setIsClientsLoading(false);
      return { error };
    }

    setClients(Array.isArray(data) ? data : []);
    setIsClientsLoading(false);
    return { error: null };
  }, [session?.user?.id]);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  const fetchServices = useCallback(async () => {
    if (!session?.user?.id || !business?.id) {
      setServices([]);
      return { error: null };
    }

    setIsServicesLoading(true);
    setServicesError('');

    const { data, error } = await supabase
      .from('services')
      .select('id, business_id, name, description, duration_minutes, price, category, color, is_active, sort_order, stripe_price_id, ai_metadata, created_at')
      .eq('business_id', business.id)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      setServicesError(error.message);
      setIsServicesLoading(false);
      return { error };
    }

    setServices(Array.isArray(data) ? data : []);
    setIsServicesLoading(false);
    return { error: null };
  }, [business?.id, session?.user?.id]);

  useEffect(() => {
    fetchServices();
  }, [fetchServices]);

  const fetchStaff = useCallback(async () => {
    if (!session?.user?.id || !business?.id) {
      setStaff([]);
      return { error: null };
    }

    setIsStaffLoading(true);
    setStaffError('');

    const { data, error } = await supabase
      .from('staff_members')
      .select('id, business_id, name, email, role, avatar_url, color, is_active, availability_settings, ai_metadata, created_at')
      .eq('business_id', business.id)
      .order('created_at', { ascending: true });

    if (error) {
      setStaffError(error.message);
      setIsStaffLoading(false);
      return { error };
    }

    setStaff(Array.isArray(data) ? data : []);
    setIsStaffLoading(false);
    return { error: null };
  }, [business?.id, session?.user?.id]);

  useEffect(() => {
    fetchStaff();
  }, [fetchStaff]);

  const fetchStaffAvailability = useCallback(async () => {
    if (!session?.user?.id || !business?.id) {
      setStaffAvailability([]);
      return { error: null };
    }

    setIsStaffAvailabilityLoading(true);
    setStaffAvailabilityError('');

    const { data, error } = await supabase
      .from('staff_availability')
      .select('id, staff_member_id, weekday, is_closed, open_time, close_time, created_at, updated_at')
      .order('staff_member_id', { ascending: true })
      .order('weekday', { ascending: true });

    if (error) {
      setStaffAvailabilityError(error.message);
      setIsStaffAvailabilityLoading(false);
      return { error };
    }

    const staffIds = new Set((staff || []).map((member) => member.id));
    const rows = Array.isArray(data) ? data : [];
    setStaffAvailability(rows.filter((row) => staffIds.has(row.staff_member_id)));
    setIsStaffAvailabilityLoading(false);
    return { error: null };
  }, [business?.id, session?.user?.id, staff]);

  useEffect(() => {
    fetchStaffAvailability();
  }, [fetchStaffAvailability]);

  useEffect(() => {
    if (!business?.id || !session?.user?.id) {
      return undefined;
    }

    const servicesChannel = supabase
      .channel(`services-changes-${business.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'services',
          filter: `business_id=eq.${business.id}`,
        },
        () => {
          fetchServices();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(servicesChannel);
    };
  }, [business?.id, fetchServices, session?.user?.id]);

  useEffect(() => {
    if (!business?.id || !session?.user?.id) {
      return undefined;
    }

    const staffChannel = supabase
      .channel(`staff-changes-${business.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'staff_members',
          filter: `business_id=eq.${business.id}`,
        },
        () => {
          fetchStaff();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(staffChannel);
    };
  }, [business?.id, fetchStaff, session?.user?.id]);

  useEffect(() => {
    if (!business?.id || !session?.user?.id) {
      return undefined;
    }

    const staffAvailabilityChannel = supabase
      .channel(`staff-availability-changes-${business.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'staff_availability',
        },
        () => {
          fetchStaffAvailability();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(staffAvailabilityChannel);
    };
  }, [business?.id, fetchStaffAvailability, session?.user?.id]);

  useEffect(() => {
    if (!session?.user?.id) {
      return undefined;
    }

    const clientsChannel = supabase
      .channel(`clients-changes-${session.user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'clients',
          filter: `user_id=eq.${session.user.id}`,
        },
        () => {
          fetchClients();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(clientsChannel);
    };
  }, [fetchClients, session?.user?.id]);

  const addBooking = async (bookingInput) => {
    if (!session?.user?.id) {
      return { error: { message: 'User is not authenticated.' } };
    }

    setBookingsError('');

    if (Object.prototype.hasOwnProperty.call(bookingInput, 'date') && !isValidBookingDateText(bookingInput.date)) {
      return { error: { message: 'Invalid booking date. Please choose a valid appointment date.' } };
    }

    if (Object.prototype.hasOwnProperty.call(bookingInput, 'time') && !isValidBookingTimeText(bookingInput.time)) {
      return { error: { message: 'Invalid booking time. Please choose a valid appointment time.' } };
    }

    const payload = {
      ...bookingInput,
      user_id: session.user.id,
    };

    const { data, error } = await supabase
      .from('bookings')
      .insert(payload)
      .select('id, client_name, service, date, time, status, price, notes, staff_member_id, booking_metadata, user_id, created_at')
      .single();

    if (error) {
      setBookingsError(error.message);
      return { error };
    }

    setBookings((previousBookings) => [data, ...previousBookings]);
    return { error: null, data };
  };

  const updateBooking = async (bookingId, bookingInput) => {
    if (!session?.user?.id) {
      return { error: { message: 'User is not authenticated.' } };
    }

    setBookingsError('');

    if (Object.prototype.hasOwnProperty.call(bookingInput, 'date') && !isValidBookingDateText(bookingInput.date)) {
      return { error: { message: 'Invalid booking date. Please choose a valid appointment date.' } };
    }

    if (Object.prototype.hasOwnProperty.call(bookingInput, 'time') && !isValidBookingTimeText(bookingInput.time)) {
      return { error: { message: 'Invalid booking time. Please choose a valid appointment time.' } };
    }

    const { data, error } = await supabase
      .from('bookings')
      .update(bookingInput)
      .eq('id', bookingId)
      .eq('user_id', session.user.id)
      .select('id, client_name, service, date, time, status, price, notes, staff_member_id, booking_metadata, user_id, created_at')
      .single();

    if (error) {
      setBookingsError(error.message);
      return { error };
    }

    setBookings((previousBookings) =>
      previousBookings.map((booking) =>
        booking.id === bookingId ? data : booking
      )
    );

    return { error: null, data };
  };

  const deleteBooking = async (bookingId) => {
    if (!session?.user?.id) {
      return { error: { message: 'User is not authenticated.' } };
    }

    setBookingsError('');

    const { error } = await supabase
      .from('bookings')
      .delete()
      .eq('id', bookingId)
      .eq('user_id', session.user.id);

    if (error) {
      setBookingsError(error.message);
      return { error };
    }

    setBookings((previousBookings) =>
      previousBookings.filter((booking) => booking.id !== bookingId)
    );

    return { error: null };
  };

  const logAiRecommendation = async ({
    recommendationType,
    accepted,
    reasoningMetadata,
    bookingId,
  }) => {
    if (!session?.user?.id || !business?.id || !recommendationType) {
      return { error: { message: 'Business or recommendation type is missing.' } };
    }

    const payload = {
      business_id: business.id,
      user_id: session.user.id,
      booking_id: bookingId || null,
      recommendation_type: recommendationType,
      accepted: Boolean(accepted),
      reasoning_metadata: reasoningMetadata || {},
    };

    const { error } = await supabase
      .from('ai_recommendations')
      .insert(payload);

    return { error };
  };

  const addClient = async (clientInput) => {
    if (!session?.user?.id) {
      return { error: { message: 'User is not authenticated.' } };
    }

    setClientsError('');

    const payload = {
      ...clientInput,
      user_id: session.user.id,
    };

    const { data, error } = await supabase
      .from('clients')
      .insert(payload)
      .select('id, client_name, phone, email, notes, user_id, created_at')
      .single();

    if (error) {
      setClientsError(error.message);
      return { error };
    }

    setClients((previousClients) => [data, ...previousClients]);
    return { error: null };
  };

  const updateClient = async (clientId, clientInput) => {
    if (!session?.user?.id) {
      return { error: { message: 'User is not authenticated.' } };
    }

    setClientsError('');

    const { data, error } = await supabase
      .from('clients')
      .update(clientInput)
      .eq('id', clientId)
      .eq('user_id', session.user.id)
      .select('id, client_name, phone, email, notes, user_id, created_at')
      .single();

    if (error) {
      setClientsError(error.message);
      return { error };
    }

    setClients((previousClients) =>
      previousClients.map((client) =>
        client.id === clientId ? data : client
      )
    );

    return { error: null };
  };

  const deleteClient = async (clientId) => {
    if (!session?.user?.id) {
      return { error: { message: 'User is not authenticated.' } };
    }

    setClientsError('');

    const { error } = await supabase
      .from('clients')
      .delete()
      .eq('id', clientId)
      .eq('user_id', session.user.id);

    if (error) {
      setClientsError(error.message);
      return { error };
    }

    setClients((previousClients) =>
      previousClients.filter((client) => client.id !== clientId)
    );

    return { error: null };
  };

  const addService = async (serviceInput) => {
    if (!session?.user?.id || !business?.id) {
      return { error: { message: 'Business is not ready yet.' } };
    }

    setServicesError('');

    const payload = {
      ...serviceInput,
      business_id: business.id,
    };

    const { data, error } = await supabase
      .from('services')
      .insert(payload)
      .select('id, business_id, name, description, duration_minutes, price, category, color, is_active, sort_order, stripe_price_id, ai_metadata, created_at')
      .single();

    if (error) {
      setServicesError(error.message);
      return { error };
    }

    setServices((previous) => [...previous, data]);
    return { error: null };
  };

  const updateService = async (serviceId, serviceInput) => {
    if (!session?.user?.id || !business?.id) {
      return { error: { message: 'Business is not ready yet.' } };
    }

    setServicesError('');

    const { data, error } = await supabase
      .from('services')
      .update(serviceInput)
      .eq('id', serviceId)
      .eq('business_id', business.id)
      .select('id, business_id, name, description, duration_minutes, price, category, color, is_active, sort_order, stripe_price_id, ai_metadata, created_at')
      .single();

    if (error) {
      setServicesError(error.message);
      return { error };
    }

    setServices((previous) =>
      previous.map((service) => (service.id === serviceId ? data : service))
    );
    return { error: null };
  };

  const deleteService = async (serviceId) => {
    if (!session?.user?.id || !business?.id) {
      return { error: { message: 'Business is not ready yet.' } };
    }

    setServicesError('');

    const { error } = await supabase
      .from('services')
      .delete()
      .eq('id', serviceId)
      .eq('business_id', business.id);

    if (error) {
      setServicesError(error.message);
      return { error };
    }

    setServices((previous) => previous.filter((service) => service.id !== serviceId));
    return { error: null };
  };

  const addStaffMember = async (staffInput) => {
    if (!session?.user?.id || !business?.id) {
      return { error: { message: 'Business is not ready yet.' } };
    }

    setStaffError('');

    const payload = {
      ...staffInput,
      business_id: business.id,
    };

    const { data, error } = await supabase
      .from('staff_members')
      .insert(payload)
      .select('id, business_id, name, email, role, avatar_url, color, is_active, availability_settings, ai_metadata, created_at')
      .single();

    if (error) {
      setStaffError(error.message);
      return { error };
    }

    setStaff((previous) => [...previous, data]);
    return { error: null };
  };

  const updateStaffMember = async (staffId, staffInput) => {
    if (!session?.user?.id || !business?.id) {
      return { error: { message: 'Business is not ready yet.' } };
    }

    setStaffError('');

    const { data, error } = await supabase
      .from('staff_members')
      .update(staffInput)
      .eq('id', staffId)
      .eq('business_id', business.id)
      .select('id, business_id, name, email, role, avatar_url, color, is_active, availability_settings, ai_metadata, created_at')
      .single();

    if (error) {
      setStaffError(error.message);
      return { error };
    }

    setStaff((previous) => previous.map((item) => (item.id === staffId ? data : item)));
    return { error: null };
  };

  const deleteStaffMember = async (staffId) => {
    if (!session?.user?.id || !business?.id) {
      return { error: { message: 'Business is not ready yet.' } };
    }

    setStaffError('');

    const { error } = await supabase
      .from('staff_members')
      .delete()
      .eq('id', staffId)
      .eq('business_id', business.id);

    if (error) {
      setStaffError(error.message);
      return { error };
    }

    setStaff((previous) => previous.filter((item) => item.id !== staffId));
    return { error: null };
  };

  const saveStaffAvailability = useCallback(async (staffId, availabilityRows) => {
    if (!session?.user?.id || !business?.id || !staffId) {
      return { error: { message: 'Business or staff member is not ready yet.' } };
    }

    setStaffAvailabilityError('');

    const payload = normalizeBusinessHours(availabilityRows).map((row) => ({
      staff_member_id: staffId,
      weekday: row.weekday,
      is_closed: Boolean(row.is_closed),
      open_time: row.open_time,
      close_time: row.close_time,
    }));

    const { error } = await supabase
      .from('staff_availability')
      .upsert(payload, { onConflict: 'staff_member_id,weekday' });

    if (error) {
      setStaffAvailabilityError(error.message);
      return { error };
    }

    await fetchStaffAvailability();
    return { error: null };
  }, [business?.id, fetchStaffAvailability, session?.user?.id]);

  const signIn = async ({ email, password }) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error };
  };

  const signUp = async ({ email, password }) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
    });
    return { error };
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (!error) {
      await cancelBookingReminders();
      setSession(null);
      setBusiness(null);
      setBusinessBootstrapError('');
      setBusinessHours([]);
      setBookings([]);
      setClients([]);
      setServices([]);
      setStaff([]);
      setStaffAvailability([]);
      setUnauthStartRoute(ROUTES.Login);
    }
    return { error };
  };

  const authValue = useMemo(
    () => ({
      session,
      isAuthenticated: Boolean(session),
      isAuthLoading,
      business,
      isBusinessLoading,
      businessError,
      businessHours,
      isBusinessHoursLoading,
      businessHoursError,
      fetchBusinessHours,
      saveBusinessHours,
      saveBusinessPaymentSettings,
      saveBusinessProfile,
      completeOnboarding,
      signIn,
      signUp,
      signOut,
    }),
    [
      session,
      isAuthLoading,
      business,
      isBusinessLoading,
      businessError,
      businessHours,
      isBusinessHoursLoading,
      businessHoursError,
      fetchBusinessHours,
      saveBusinessHours,
      saveBusinessPaymentSettings,
      saveBusinessProfile,
      completeOnboarding,
    ]
  );

  const contextValue = useMemo(
    () => ({
      bookings,
      isBookingsLoading,
      bookingsError,
      fetchBookings,
      addBooking,
      updateBooking,
      deleteBooking,
      logAiRecommendation,
    }),
    [bookings, isBookingsLoading, bookingsError, fetchBookings, logAiRecommendation]
  );

  const clientsValue = useMemo(
    () => ({
      clients,
      isClientsLoading,
      clientsError,
      fetchClients,
      addClient,
      updateClient,
      deleteClient,
    }),
    [clients, isClientsLoading, clientsError, fetchClients]
  );

  const servicesValue = useMemo(
    () => ({
      services,
      isServicesLoading,
      servicesError,
      fetchServices,
      addService,
      updateService,
      deleteService,
    }),
    [services, isServicesLoading, servicesError, fetchServices]
  );

  const staffValue = useMemo(
    () => ({
      staff,
      isStaffLoading,
      staffError,
      fetchStaff,
      addStaffMember,
      updateStaffMember,
      deleteStaffMember,
      staffAvailability,
      isStaffAvailabilityLoading,
      staffAvailabilityError,
      fetchStaffAvailability,
      saveStaffAvailability,
    }),
    [
      staff,
      isStaffLoading,
      staffError,
      fetchStaff,
      staffAvailability,
      isStaffAvailabilityLoading,
      staffAvailabilityError,
      fetchStaffAvailability,
      saveStaffAvailability,
    ]
  );

  return (
    <AuthProvider value={authValue}>
      <BookingsProvider value={contextValue}>
        <ClientsProvider value={clientsValue}>
          <ServicesProvider value={servicesValue}>
            <StaffProvider value={staffValue}>
              <NavigationContainer linking={linking}>
                <Stack.Navigator screenOptions={{ headerShown: false }}>
                {isAuthLoading ? (
                  <Stack.Screen
                    name={ROUTES.AuthLoading}
                    component={AuthLoadingScreen}
                  />
                ) : null}

                  {!isAuthLoading && !session ? (
                    <>
                      {unauthStartRoute === ROUTES.Login ? (
                        <>
                          <Stack.Screen name={ROUTES.Login} component={LoginScreen} />
                          <Stack.Screen name={ROUTES.Welcome} component={WelcomeScreen} />
                        </>
                      ) : (
                        <>
                          <Stack.Screen name={ROUTES.Welcome} component={WelcomeScreen} />
                          <Stack.Screen name={ROUTES.Login} component={LoginScreen} />
                        </>
                      )}
                    </>
                  ) : null}

                  {!isAuthLoading && session && (isBusinessLoading || !business) ? (
                    <Stack.Screen name={ROUTES.AuthLoading}>
                      {(props) => (
                        <AuthLoadingScreen
                          {...props}
                          errorMessage={businessBootstrapError || (businessError && !isBusinessLoading ? businessError : '')}
                          onRetry={retryBusinessBootstrap}
                          onLogout={signOut}
                        />
                      )}
                    </Stack.Screen>
                  ) : null}

                  {!isAuthLoading && session && !isBusinessLoading && business && !business.onboarding_completed ? (
                    <Stack.Screen
                      name={ROUTES.OnboardingWizard}
                      component={OnboardingWizardScreen}
                    />
                  ) : null}

                  {!isAuthLoading && session && !isBusinessLoading && business?.onboarding_completed ? (
                    <>
                      <Stack.Screen
                        name={ROUTES.MainTabs}
                        component={MainTabNavigator}
                      />
                      <Stack.Screen
                        name={ROUTES.AddBooking}
                        component={AddBookingScreen}
                      />
                      <Stack.Screen
                        name={ROUTES.AddClient}
                        component={AddClientScreen}
                      />
                      <Stack.Screen
                        name={ROUTES.Services}
                        component={ServicesScreen}
                      />
                      <Stack.Screen
                        name={ROUTES.AddService}
                        component={AddServiceScreen}
                      />
                      <Stack.Screen
                        name={ROUTES.Staff}
                        component={StaffScreen}
                      />
                      <Stack.Screen
                        name={ROUTES.AddStaff}
                        component={AddStaffScreen}
                      />
                      <Stack.Screen
                        name={ROUTES.StaffAvailability}
                        component={StaffAvailabilityScreen}
                      />
                      <Stack.Screen
                        name={ROUTES.BusinessHours}
                        component={BusinessHoursScreen}
                      />
                      <Stack.Screen
                        name={ROUTES.WeeklyCalendar}
                        component={WeeklyCalendarScreen}
                      />
                      <Stack.Screen
                        name={ROUTES.DailySchedule}
                        component={DailyScheduleScreen}
                      />
                      <Stack.Screen
                        name={ROUTES.PaymentSettings}
                        component={PaymentSettingsScreen}
                      />
                      <Stack.Screen
                        name={ROUTES.NotificationSettings}
                        component={NotificationSettingsScreen}
                      />
                    </>
                  ) : null}

                  <Stack.Screen
                    name={ROUTES.AppointmentPortal}
                    component={ClientAppointmentPortalScreen}
                  />

                  <Stack.Screen
                    name={ROUTES.PublicBooking}
                    component={PublicBookingScreen}
                  />
                </Stack.Navigator>
              </NavigationContainer>
            </StaffProvider>
          </ServicesProvider>
        </ClientsProvider>
      </BookingsProvider>
    </AuthProvider>
  );
}
