import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import * as Notifications from 'expo-notifications';
import * as Linking from 'expo-linking';
import { NavigationContainer, getStateFromPath as getDefaultStateFromPath } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { DEFAULT_BUSINESS_HOURS, normalizeBusinessHours } from '../constants/availability';
import {
  createSessionFromResetLink,
  getPasswordResetRedirectUrl,
  isPasswordResetUrl,
  isPasswordResetPath,
} from '../constants/authLinking';
import { ROUTES } from '../constants/routes';
import { supabase } from '../constants/supabase';
import {
  cancelBookingReminders,
  syncBookingReminders,
} from '../notifications/bookingReminders';
import {
  flushOwnerPushQueue,
  registerOwnerPushToken,
  unregisterOwnerPushToken,
} from '../notifications/ownerPush';
import {
  fetchNotificationPreferences,
} from '../utils/notificationPreferences';
import {
  navigateFromNotificationData,
  navigationRef,
} from './navigationRef';
import {
  findClientForBooking,
  getUnlinkedBookings,
  syncClientFromConfirmedPublicBooking,
  syncClientFromOwnerBooking,
} from '../utils/clients';
import {
  buildClientInsertPayload,
  buildClientUpdatePayload,
  CLIENT_TABLE_SELECT,
  fetchClientProfile,
  fetchClientProfilesList,
  normalizeClientTableRow,
} from '../utils/clientProfiles';
import { AuthProvider } from '../context/AuthContext';
import { BookingsProvider } from '../context/BookingsContext';
import { ClientsProvider } from '../context/ClientsContext';
import { NotificationsProvider } from '../context/NotificationsContext';
import { ServicesProvider } from '../context/ServicesContext';
import { StaffProvider } from '../context/StaffContext';
import AuthLoadingScreen from '../screens/AuthLoadingScreen';
import WelcomeScreen from '../screens/WelcomeScreen';
import LoginScreen from '../screens/LoginScreen';
import ForgotPasswordScreen from '../screens/ForgotPasswordScreen';
import ResetPasswordScreen from '../screens/ResetPasswordScreen';
import AddBookingScreen from '../screens/AddBookingScreen';
import BookingDetailScreen from '../screens/BookingDetailScreen';
import AddClientScreen from '../screens/AddClientScreen';
import ClientDetailScreen from '../screens/ClientDetailScreen';
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
import NotificationsScreen from '../screens/NotificationsScreen';
import NotificationDetailScreen from '../screens/NotificationDetailScreen';
import CalendarSettingsScreen from '../screens/CalendarSettingsScreen';
import AnalyticsScreen from '../screens/AnalyticsScreen';
import PublicBookingScreen from '../screens/PublicBookingScreen';
import ClientAppointmentPortalScreen from '../screens/ClientAppointmentPortalScreen';
import MainTabNavigator from './MainTabNavigator';

const LINKING_SCREEN_CONFIG = {
  AuthLoading: 'loading',
  Welcome: '',
  Login: 'login',
  ForgotPassword: 'forgot-password',
  ResetPassword: 'reset-password',
  OnboardingWizard: 'onboarding',
  AppointmentPortal: 'appointment/:booking_token',
  PublicBooking: 'book/:slug',
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
  CalendarSettings: 'settings/calendar',
  Analytics: 'analytics',
};

function normalizeLinkingPath(path) {
  if (path == null || path === '') {
    return '';
  }

  return String(path).replace(/^\/+/, '').replace(/\/+$/, '');
}

function isIgnorableRootLinkingPath(path) {
  const normalized = normalizeLinkingPath(path);

  return normalized === '' || normalized === '--';
}

function isIgnorableRootLinkingUrl(url) {
  if (!url) {
    return true;
  }

  if (isPasswordResetUrl(url)) {
    return false;
  }

  const withoutHash = url.split('#')[0].split('?')[0];

  if (/^(exp|salo):\/\/[^/?#]*\/?(--\/?)?$/i.test(withoutHash)) {
    return true;
  }

  const parsed = Linking.parse(url);

  return isIgnorableRootLinkingPath(parsed?.path ?? '');
}

const Stack = createNativeStackNavigator();
const BOOKING_SELECT_COLUMNS =
  'id, client_id, client_name, service, date, time, status, price, notes, staff_member_id, booking_metadata, user_id, business_id, business_slug, created_at, customer_email, customer_phone, booking_source, booking_token';
const BUSINESS_SELECT_COLUMNS = 'id, owner_user_id, business_name, slug, description, timezone, services, public_booking_enabled, onboarding_completed, deposits_enabled, deposit_percentage, require_card_on_booking, stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled, stripe_card_payments_enabled, stripe_transfers_enabled, created_at';
const BUSINESS_BOOTSTRAP_TIMEOUT_MS = 15000;

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
  const [isPasswordRecoveryPending, setIsPasswordRecoveryPending] = useState(false);
  const [passwordRecoveryLinkError, setPasswordRecoveryLinkError] = useState('');
  const bookingLinkBackfillRef = useRef(new Set());
  const pendingNotificationDataRef = useRef(null);

  const handlePasswordResetUrl = useCallback(async (url) => {
    if (!isPasswordResetUrl(url)) {
      return false;
    }

    console.log('[SALO] reset deep link detected', url);
    console.log('[SALO] navigating to ResetPassword');
    setIsPasswordRecoveryPending(true);

    const { session: recoverySession, error } = await createSessionFromResetLink(url);

    if (error) {
      setPasswordRecoveryLinkError(error.message);
      setSession(null);
      return true;
    }

    setPasswordRecoveryLinkError('');

    if (recoverySession) {
      setSession(recoverySession);
    }

    return true;
  }, []);

  const handlePasswordResetUrlRef = useRef(handlePasswordResetUrl);
  handlePasswordResetUrlRef.current = handlePasswordResetUrl;

  const linking = useMemo(
    () => ({
      prefixes: [Linking.createURL('/'), 'salo://', 'exp://'],
      config: {
        screens: LINKING_SCREEN_CONFIG,
      },
      getStateFromPath(path, options) {
        console.log('[SALO] resolved linking path:', path);

        if (isPasswordResetPath(path)) {
          return {
            routes: [{ name: ROUTES.ResetPassword }],
          };
        }

        if (isIgnorableRootLinkingPath(path)) {
          console.log('[SALO] ignoring root Expo URL');
          return undefined;
        }

        return getDefaultStateFromPath(path, {
          ...options,
          screens: LINKING_SCREEN_CONFIG,
        });
      },
      async getInitialURL() {
        const url = await Linking.getInitialURL();
        console.log('[SALO] initial URL:', url);

        if (url && isPasswordResetUrl(url)) {
          await handlePasswordResetUrlRef.current(url);
          return url;
        }

        if (isIgnorableRootLinkingUrl(url)) {
          console.log('[SALO] ignoring root Expo URL');
          return null;
        }

        return url;
      },
      subscribe(listener) {
        const subscription = Linking.addEventListener('url', ({ url }) => {
          if (isPasswordResetUrl(url)) {
            handlePasswordResetUrlRef.current(url);
            listener(url);
            return;
          }

          if (isIgnorableRootLinkingUrl(url)) {
            console.log('[SALO] ignoring root Expo URL');
            return;
          }

          listener(url);
        });

        return () => {
          subscription.remove();
        };
      },
    }),
    []
  );

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

      if (event === 'PASSWORD_RECOVERY') {
        setIsPasswordRecoveryPending(true);
        setPasswordRecoveryLinkError('');
      }

      setSession(nextSession);

      if (event === 'SIGNED_OUT') {
        setUnauthStartRoute(ROUTES.Login);
        setIsPasswordRecoveryPending(false);
        setPasswordRecoveryLinkError('');
      }

      setIsAuthLoading(false);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const fetchBookings = useCallback(async () => {
    if (!session?.user?.id) {
      setBookings([]);
      return { error: null };
    }

    setIsBookingsLoading(true);
    setBookingsError('');

    const { data, error } = await supabase
      .from('bookings')
      .select(BOOKING_SELECT_COLUMNS)
      .eq('user_id', session.user.id)
      .order('date', { ascending: true })
      .order('time', { ascending: true });

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

  const updatePublicBookingEnabled = async (enabled) => {
    if (!business?.id || !session?.user?.id) {
      return { error: { message: 'Business is not ready yet.' } };
    }

    setBusinessError('');

    const { data, error } = await supabase
      .from('businesses')
      .update({ public_booking_enabled: Boolean(enabled) })
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

    (async () => {
      const { data: preferences } = await fetchNotificationPreferences(business?.id);

      await syncBookingReminders(bookings, {
        soundEnabled: preferences?.owner_push_sound_enabled !== false,
      });
    })();
  }, [bookings, business?.id, session?.user?.id]);

  const tryNavigateFromPendingNotification = useCallback(async () => {
    if (
      !pendingNotificationDataRef.current
      || !navigationRef.isReady()
      || !session?.user?.id
    ) {
      return;
    }

    const notificationData = pendingNotificationDataRef.current;
    pendingNotificationDataRef.current = null;

    if (notificationData?.bookingId) {
      await fetchBookings();
    }

    navigateFromNotificationData(notificationData);
  }, [fetchBookings, session?.user?.id]);

  useEffect(() => {
    const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      pendingNotificationDataRef.current = response.notification.request.content.data;
      tryNavigateFromPendingNotification();
    });

    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) {
        return;
      }

      pendingNotificationDataRef.current = response.notification.request.content.data;
      tryNavigateFromPendingNotification();
    });

    return () => {
      responseSubscription.remove();
    };
  }, [tryNavigateFromPendingNotification]);

  useEffect(() => {
    tryNavigateFromPendingNotification();
  }, [tryNavigateFromPendingNotification]);

  useEffect(() => {
    if (!session?.user?.id) {
      return undefined;
    }

    let cancelled = false;

    (async () => {
      const { error, skipped } = await registerOwnerPushToken(session.user.id);

      if (cancelled) {
        return;
      }

      if (!skipped && !error) {
        await flushOwnerPushQueue();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  useEffect(() => {
    if (!session?.user?.id || !bookings.length) {
      return;
    }

    flushOwnerPushQueue();
  }, [bookings.length, session?.user?.id]);

  const fetchClients = useCallback(async () => {
    if (!session?.user?.id || !business?.id) {
      setClients([]);
      setIsClientsLoading(false);
      return { error: null };
    }

    setIsClientsLoading(true);
    setClientsError('');

    const { data, error } = await fetchClientProfilesList(supabase, business.id, {
      limit: 100,
      offset: 0,
    });

    if (error) {
      setClientsError(error.message);
      setIsClientsLoading(false);
      return { error };
    }

    setClients(Array.isArray(data) ? data : []);
    setIsClientsLoading(false);
    return { error: null };
  }, [business?.id, session?.user?.id]);

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
    if (!session?.user?.id || !business?.id) {
      return undefined;
    }

    const clientsChannel = supabase
      .channel(`clients-changes-${business.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'clients',
          filter: `business_id=eq.${business.id}`,
        },
        () => {
          fetchClients();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(clientsChannel);
    };
  }, [business?.id, fetchClients, session?.user?.id]);

  useEffect(() => {
    if (!session?.user?.id || isBookingsLoading || isClientsLoading) {
      return undefined;
    }

    const unlinkedBookings = getUnlinkedBookings(bookings);
    if (!unlinkedBookings.length || !clients.length) {
      return undefined;
    }

    let cancelled = false;

    (async () => {
      for (const booking of unlinkedBookings) {
        if (cancelled) {
          return;
        }

        if (bookingLinkBackfillRef.current.has(booking.id)) {
          continue;
        }

        const matchedClient = findClientForBooking(booking, clients);
        if (!matchedClient) {
          bookingLinkBackfillRef.current.add(booking.id);
          continue;
        }

        bookingLinkBackfillRef.current.add(booking.id);

        const { data: linkedBooking, error } = await supabase
          .from('bookings')
          .update({ client_id: matchedClient.id })
          .eq('id', booking.id)
          .eq('user_id', session.user.id)
          .select(BOOKING_SELECT_COLUMNS)
          .single();

        if (cancelled || error || !linkedBooking) {
          continue;
        }

        setBookings((previousBookings) =>
          previousBookings.map((item) =>
            item.id === booking.id ? linkedBooking : item
          )
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    bookings,
    clients,
    isBookingsLoading,
    isClientsLoading,
    session?.user?.id,
  ]);

  const linkBookingToClient = async (bookingId, clientId, currentBooking) => {
    if (!clientId || currentBooking?.client_id === clientId) {
      return { error: null, data: currentBooking };
    }

    const { data: linkedBooking, error: linkError } = await supabase
      .from('bookings')
      .update({ client_id: clientId })
      .eq('id', bookingId)
      .eq('user_id', session.user.id)
      .select(BOOKING_SELECT_COLUMNS)
      .single();

    if (linkError || !linkedBooking) {
      return { error: linkError, data: currentBooking };
    }

    setBookings((previousBookings) =>
      previousBookings.map((booking) =>
        booking.id === bookingId ? linkedBooking : booking
      )
    );

    return { error: null, data: linkedBooking };
  };

  const syncOwnerBookingClient = async (booking) => {
    if (!booking || (booking.booking_source || 'owner') !== 'owner') {
      return { error: null, data: booking };
    }

    const syncResult = await syncClientFromOwnerBooking({
      booking,
      clients,
      addClient,
      updateClient,
    });

    if (syncResult.error || !syncResult.clientId) {
      return { error: syncResult.error, data: booking };
    }

    return linkBookingToClient(booking.id, syncResult.clientId, booking);
  };

  const addBooking = useCallback(async (bookingInput) => {
    if (!session?.user?.id) {
      return { error: { message: 'User is not authenticated.' } };
    }

    if (!business?.id) {
      return { error: { message: 'Business profile is not ready. Please try again.' } };
    }

    setBookingsError('');

    const payload = {
      ...bookingInput,
      user_id: session.user.id,
      business_id: bookingInput.business_id || business.id,
      business_slug: bookingInput.business_slug || business.slug || null,
      booking_source: bookingInput.booking_source || 'owner',
      staff_member_id: bookingInput.staff_member_id ?? null,
    };

    const { data, error } = await supabase
      .from('bookings')
      .insert(payload)
      .select(BOOKING_SELECT_COLUMNS)
      .single();

    if (error) {
      setBookingsError(error.message);
      return { error };
    }

    const linkResult = await syncOwnerBookingClient(data);
    const savedBooking = linkResult.data || data;

    if (!linkResult.error) {
      setBookings((previousBookings) => {
        const withoutSaved = previousBookings.filter((booking) => booking.id !== savedBooking.id);
        return [savedBooking, ...withoutSaved];
      });
    } else {
      setBookings((previousBookings) => [data, ...previousBookings]);
    }

    return { error: null, data: savedBooking };
  }, [addClient, business?.id, business?.slug, clients, session?.user?.id, updateClient]);

  const updateBooking = async (bookingId, bookingInput) => {
    if (!session?.user?.id) {
      return { error: { message: 'User is not authenticated.' } };
    }

    setBookingsError('');

    const previousBooking = bookings.find((booking) => booking.id === bookingId);

    const { data, error } = await supabase
      .from('bookings')
      .update(bookingInput)
      .eq('id', bookingId)
      .eq('user_id', session.user.id)
      .select(BOOKING_SELECT_COLUMNS)
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

    if (
      bookingInput.status === 'confirmed'
      && previousBooking?.status === 'pending'
      && data?.booking_source === 'public'
    ) {
      const syncResult = await syncClientFromConfirmedPublicBooking({
        booking: data,
        clients,
        addClient,
        updateClient,
      });

      if (!syncResult.error && syncResult.clientId) {
        const linkResult = await linkBookingToClient(
          bookingId,
          syncResult.clientId,
          data
        );

        if (!linkResult.error && linkResult.data) {
          return { error: null, data: linkResult.data };
        }
      }
    } else if ((data?.booking_source || 'owner') === 'owner') {
      const linkResult = await syncOwnerBookingClient(data);

      if (!linkResult.error && linkResult.data) {
        return { error: null, data: linkResult.data };
      }
    }

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

    if (!business?.id) {
      return { error: { message: 'Business profile is not ready. Please try again.' } };
    }

    setClientsError('');

    const payload = buildClientInsertPayload(clientInput, {
      businessId: clientInput?.business_id || business.id,
      userId: session.user.id,
    });

    const { data, error } = await supabase
      .from('clients')
      .insert(payload)
      .select(CLIENT_TABLE_SELECT)
      .single();

    if (error) {
      setClientsError(error.message);
      return { error };
    }

    const normalizedClient = normalizeClientTableRow(data);
    await fetchClients();
    return { error: null, data: normalizedClient };
  };

  const updateClient = async (clientId, clientInput) => {
    if (!session?.user?.id) {
      return { error: { message: 'User is not authenticated.' } };
    }

    if (!business?.id) {
      return { error: { message: 'Business profile is not ready. Please try again.' } };
    }

    setClientsError('');

    const payload = buildClientUpdatePayload(clientInput);

    const { data, error } = await supabase
      .from('clients')
      .update(payload)
      .eq('id', clientId)
      .eq('business_id', business.id)
      .select(CLIENT_TABLE_SELECT)
      .single();

    if (error) {
      setClientsError(error.message);
      return { error };
    }

    const normalizedClient = normalizeClientTableRow(data);

    setClients((previousClients) =>
      previousClients.map((client) =>
        client.id === clientId ? { ...client, ...normalizedClient } : client
      )
    );

    await fetchClients();

    return { error: null, data: normalizedClient };
  };

  const deleteClient = async (clientId) => {
    if (!session?.user?.id) {
      return { error: { message: 'User is not authenticated.' } };
    }

    if (!business?.id) {
      return { error: { message: 'Business profile is not ready. Please try again.' } };
    }

    setClientsError('');

    const { error } = await supabase
      .from('clients')
      .delete()
      .eq('id', clientId)
      .eq('business_id', business.id);

    if (error) {
      setClientsError(error.message);
      return { error };
    }

    setClients((previousClients) =>
      previousClients.filter((client) => client.id !== clientId)
    );

    return { error: null };
  };

  const getClientProfile = async (clientId) => {
    if (!session?.user?.id) {
      return { error: { message: 'User is not authenticated.' }, data: null };
    }

    const { data, error } = await fetchClientProfile(supabase, clientId);

    if (error) {
      return { error, data: null };
    }

    if (data?.client) {
      setClients((previousClients) =>
        previousClients.map((client) =>
          client.id === data.client.id ? { ...client, ...data.client } : client
        )
      );
    }

    return { error: null, data };
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

  const requestPasswordReset = async (email) => {
    const redirectTo = getPasswordResetRedirectUrl();

    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.log('[SALO] resetPasswordForEmail redirectTo:', redirectTo);
    }

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });
    return { error };
  };

  const updatePassword = async (password) => {
    const { error } = await supabase.auth.updateUser({ password });

    if (!error) {
      setIsPasswordRecoveryPending(false);
      setPasswordRecoveryLinkError('');
    }

    return { error };
  };

  const clearPasswordRecovery = () => {
    setIsPasswordRecoveryPending(false);
    setPasswordRecoveryLinkError('');
  };

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
    const userId = session?.user?.id;
    const { error } = await supabase.auth.signOut();
    if (!error) {
      if (userId) {
        await unregisterOwnerPushToken(userId);
      }
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
      setIsPasswordRecoveryPending(false);
      setPasswordRecoveryLinkError('');
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
      refreshBusiness: fetchOrCreateBusiness,
      saveBusinessProfile,
      updatePublicBookingEnabled,
      completeOnboarding,
      requestPasswordReset,
      updatePassword,
      clearPasswordRecovery,
      passwordRecoveryLinkError,
      isPasswordRecoveryPending,
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
      fetchOrCreateBusiness,
      saveBusinessProfile,
      updatePublicBookingEnabled,
      completeOnboarding,
      requestPasswordReset,
      updatePassword,
      clearPasswordRecovery,
      passwordRecoveryLinkError,
      isPasswordRecoveryPending,
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
    [bookings, isBookingsLoading, bookingsError, fetchBookings, addBooking, logAiRecommendation]
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
      getClientProfile,
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
      <NotificationsProvider>
      <BookingsProvider value={contextValue}>
        <ClientsProvider value={clientsValue}>
          <ServicesProvider value={servicesValue}>
            <StaffProvider value={staffValue}>
              <NavigationContainer ref={navigationRef} linking={linking}>
                <Stack.Navigator screenOptions={{ headerShown: false }}>
                {isAuthLoading ? (
                  <Stack.Screen
                    name={ROUTES.AuthLoading}
                    component={AuthLoadingScreen}
                  />
                ) : null}

                  {!isAuthLoading && !session && !isPasswordRecoveryPending ? (
                    <>
                      {unauthStartRoute === ROUTES.Login ? (
                        <>
                          <Stack.Screen name={ROUTES.Login} component={LoginScreen} />
                          <Stack.Screen name={ROUTES.Welcome} component={WelcomeScreen} />
                          <Stack.Screen
                            name={ROUTES.ForgotPassword}
                            component={ForgotPasswordScreen}
                          />
                        </>
                      ) : (
                        <>
                          <Stack.Screen name={ROUTES.Welcome} component={WelcomeScreen} />
                          <Stack.Screen name={ROUTES.Login} component={LoginScreen} />
                          <Stack.Screen
                            name={ROUTES.ForgotPassword}
                            component={ForgotPasswordScreen}
                          />
                        </>
                      )}
                    </>
                  ) : null}

                  {!isAuthLoading && session && !isPasswordRecoveryPending && (isBusinessLoading || !business) ? (
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

                  {!isAuthLoading && session && !isPasswordRecoveryPending && !isBusinessLoading && business && !business.onboarding_completed ? (
                    <Stack.Screen
                      name={ROUTES.OnboardingWizard}
                      component={OnboardingWizardScreen}
                    />
                  ) : null}

                  {!isAuthLoading && session && !isPasswordRecoveryPending && !isBusinessLoading && business?.onboarding_completed ? (
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
                        name={ROUTES.BookingDetail}
                        component={BookingDetailScreen}
                      />
                      <Stack.Screen
                        name={ROUTES.AddClient}
                        component={AddClientScreen}
                      />
                      <Stack.Screen
                        name={ROUTES.ClientDetail}
                        component={ClientDetailScreen}
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
                      <Stack.Screen
                        name={ROUTES.Notifications}
                        component={NotificationsScreen}
                      />
                      <Stack.Screen
                        name={ROUTES.NotificationDetail}
                        component={NotificationDetailScreen}
                      />
                      <Stack.Screen
                        name={ROUTES.CalendarSettings}
                        component={CalendarSettingsScreen}
                      />
                      <Stack.Screen
                        name={ROUTES.Analytics}
                        component={AnalyticsScreen}
                      />
                    </>
                  ) : null}

                  <Stack.Screen
                    name={ROUTES.AppointmentPortal}
                    component={ClientAppointmentPortalScreen}
                  />

                  <Stack.Screen
                    name={ROUTES.ResetPassword}
                    component={ResetPasswordScreen}
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
      </NotificationsProvider>
    </AuthProvider>
  );
}
