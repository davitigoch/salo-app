import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';

import { supabase } from '../constants/supabase';
import { useAuth } from './AuthContext';
import {
  fetchNotificationList,
  fetchUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
} from '../utils/notificationCenter';

const NotificationsContext = createContext(null);

const UNREAD_REFRESH_DEBOUNCE_MS = 300;

export function NotificationsProvider({ children }) {
  const { business, session } = useAuth();
  const businessId = business?.id;
  const userId = session?.user?.id;

  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isNotificationsLoading, setIsNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState('');

  const unreadRefreshTimerRef = useRef(null);

  const refreshUnreadCount = useCallback(async () => {
    if (!businessId) {
      setUnreadCount(0);
      return { error: null };
    }

    const { count, error } = await fetchUnreadNotificationCount(supabase, businessId);

    if (error) {
      setNotificationsError(error.message || 'Unable to load unread notification count.');
      return { error };
    }

    setUnreadCount(count);
    setNotificationsError('');
    return { error: null };
  }, [businessId]);

  const scheduleUnreadCountRefresh = useCallback(() => {
    if (unreadRefreshTimerRef.current) {
      clearTimeout(unreadRefreshTimerRef.current);
    }

    unreadRefreshTimerRef.current = setTimeout(() => {
      refreshUnreadCount();
    }, UNREAD_REFRESH_DEBOUNCE_MS);
  }, [refreshUnreadCount]);

  const loadNotifications = useCallback(
    async ({ limit = 50, offset = 0, unreadOnly = false } = {}) => {
      if (!businessId) {
        setNotifications([]);
        return { data: [], error: null };
      }

      setIsNotificationsLoading(true);
      setNotificationsError('');

      const { data, error } = await fetchNotificationList(supabase, businessId, {
        limit,
        offset,
        unreadOnly,
      });

      setIsNotificationsLoading(false);

      if (error) {
        setNotificationsError(error.message || 'Unable to load notifications.');
        return { data: [], error };
      }

      setNotifications(data);
      return { data, error: null };
    },
    [businessId]
  );

  const markRead = useCallback(
    async (notificationEventId) => {
      const { error } = await markNotificationRead(supabase, notificationEventId);

      if (error) {
        setNotificationsError(error.message || 'Unable to mark notification as read.');
        return { error };
      }

      setNotifications((previous) =>
        previous.map((item) =>
          item.id === notificationEventId
            ? { ...item, isRead: true, readAt: new Date().toISOString() }
            : item
        )
      );
      setUnreadCount((previous) => Math.max(0, previous - 1));
      return { error: null };
    },
    []
  );

  const markAllRead = useCallback(async () => {
    const { markedCount, error } = await markAllNotificationsRead(supabase, businessId);

    if (error) {
      setNotificationsError(error.message || 'Unable to mark all notifications as read.');
      return { error, markedCount: 0 };
    }

    setNotifications((previous) =>
      previous.map((item) => ({
        ...item,
        isRead: true,
        readAt: item.readAt || new Date().toISOString(),
      }))
    );
    setUnreadCount(0);
    return { error: null, markedCount };
  }, [businessId]);

  useEffect(() => {
    if (!businessId || !userId) {
      setNotifications([]);
      setUnreadCount(0);
      return undefined;
    }

    refreshUnreadCount();

    return () => {
      if (unreadRefreshTimerRef.current) {
        clearTimeout(unreadRefreshTimerRef.current);
      }
    };
  }, [businessId, refreshUnreadCount, userId]);

  useEffect(() => {
    if (!businessId || !userId) {
      return undefined;
    }

    const eventsChannel = supabase
      .channel(`notification-events-${businessId}-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notification_events',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new;

          if (!row || row.business_id !== businessId) {
            return;
          }

          setUnreadCount((previous) => previous + 1);
        }
      )
      .subscribe();

    const readsChannel = supabase
      .channel(`notification-reads-${businessId}-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notification_reads',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          scheduleUnreadCountRefresh();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(eventsChannel);
      supabase.removeChannel(readsChannel);
    };
  }, [businessId, scheduleUnreadCountRefresh, userId]);

  useEffect(() => {
    if (!businessId || !userId) {
      return undefined;
    }

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        refreshUnreadCount();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [businessId, refreshUnreadCount, userId]);

  const value = useMemo(
    () => ({
      notifications,
      unreadCount,
      isNotificationsLoading,
      notificationsError,
      refreshUnreadCount,
      loadNotifications,
      markRead,
      markAllRead,
    }),
    [
      notifications,
      unreadCount,
      isNotificationsLoading,
      notificationsError,
      refreshUnreadCount,
      loadNotifications,
      markRead,
      markAllRead,
    ]
  );

  return (
    <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationsContext);

  if (!context) {
    throw new Error('useNotifications must be used within a NotificationsProvider');
  }

  return context;
}
