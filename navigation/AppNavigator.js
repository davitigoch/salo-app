import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { ROUTES } from '../constants/routes';
import { supabase } from '../constants/supabase';
import { AuthProvider } from '../context/AuthContext';
import { BookingsProvider } from '../context/BookingsContext';
import { ClientsProvider } from '../context/ClientsContext';
import AuthLoadingScreen from '../screens/AuthLoadingScreen';
import WelcomeScreen from '../screens/WelcomeScreen';
import LoginScreen from '../screens/LoginScreen';
import AddBookingScreen from '../screens/AddBookingScreen';
import AddClientScreen from '../screens/AddClientScreen';
import MainTabNavigator from './MainTabNavigator';

const Stack = createNativeStackNavigator();

export default function AppNavigator() {
  const [session, setSession] = useState(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [bookings, setBookings] = useState([]);
  const [isBookingsLoading, setIsBookingsLoading] = useState(false);
  const [bookingsError, setBookingsError] = useState('');
  const [clients, setClients] = useState([]);
  const [isClientsLoading, setIsClientsLoading] = useState(false);
  const [clientsError, setClientsError] = useState('');

  useEffect(() => {
    let isMounted = true;

    async function loadSession() {
      const {
        data: { session: currentSession },
      } = await supabase.auth.getSession();

      if (isMounted) {
        setSession(currentSession);
        setIsAuthLoading(false);
      }
    }

    loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
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
      .select('id, client_name, service, date, time, notes, user_id, created_at')
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

  const addBooking = async (bookingInput) => {
    if (!session?.user?.id) {
      return { error: { message: 'User is not authenticated.' } };
    }

    setBookingsError('');

    const payload = {
      ...bookingInput,
      user_id: session.user.id,
    };

    const { data, error } = await supabase
      .from('bookings')
      .insert(payload)
      .select('id, client_name, service, date, time, notes, user_id, created_at')
      .single();

    if (error) {
      setBookingsError(error.message);
      return { error };
    }

    setBookings((previousBookings) => [data, ...previousBookings]);
    return { error: null };
  };

  const updateBooking = async (bookingId, bookingInput) => {
    if (!session?.user?.id) {
      return { error: { message: 'User is not authenticated.' } };
    }

    setBookingsError('');

    const { data, error } = await supabase
      .from('bookings')
      .update(bookingInput)
      .eq('id', bookingId)
      .eq('user_id', session.user.id)
      .select('id, client_name, service, date, time, notes, user_id, created_at')
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

    return { error: null };
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
    return { error };
  };

  const authValue = useMemo(
    () => ({
      session,
      isAuthenticated: Boolean(session),
      isAuthLoading,
      signIn,
      signUp,
      signOut,
    }),
    [session, isAuthLoading]
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
    }),
    [bookings, isBookingsLoading, bookingsError, fetchBookings]
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

  return (
    <AuthProvider value={authValue}>
      <BookingsProvider value={contextValue}>
        <ClientsProvider value={clientsValue}>
          <NavigationContainer>
            <Stack.Navigator screenOptions={{ headerShown: false }}>
              {isAuthLoading ? (
                <Stack.Screen
                  name={ROUTES.AuthLoading}
                  component={AuthLoadingScreen}
                />
              ) : null}

              {!isAuthLoading && !session ? (
                <>
                  <Stack.Screen name={ROUTES.Welcome} component={WelcomeScreen} />
                  <Stack.Screen name={ROUTES.Login} component={LoginScreen} />
                </>
              ) : null}

              {!isAuthLoading && session ? (
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
                </>
              ) : null}
            </Stack.Navigator>
          </NavigationContainer>
        </ClientsProvider>
      </BookingsProvider>
    </AuthProvider>
  );
}
