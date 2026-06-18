-- Prevent authenticated clients from reading encrypted Google refresh tokens directly.

revoke all on table public.google_calendar_connections from authenticated;
revoke all on table public.google_calendar_connections from anon;

grant select (
  business_id,
  google_account_email,
  calendar_id,
  sync_enabled,
  connected_at,
  disconnected_at,
  last_synced_at,
  last_error,
  created_at,
  updated_at
) on table public.google_calendar_connections to authenticated;
