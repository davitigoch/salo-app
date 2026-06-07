-- Migration: Allow authenticated users to read their own notification_outbox rows.
-- This does NOT affect service_role (which bypasses RLS) so worker behavior is unchanged.

alter table public.notification_outbox enable row level security;

drop policy if exists "Users can read own notifications" on public.notification_outbox;

create policy "Users can read own notifications"
  on public.notification_outbox
  for select
  using (auth.uid() = user_id);
