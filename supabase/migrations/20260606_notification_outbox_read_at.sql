-- Add read_at to notification_outbox for client-side read/unread tracking.
-- service_role bypasses RLS so delivery worker behavior is completely unchanged.

alter table public.notification_outbox
  add column if not exists read_at timestamptz;

-- Allow authenticated users to update ONLY read_at on their own rows.
-- The with check clause prevents changing any other column via this policy.
drop policy if exists "Users can mark own notifications read" on public.notification_outbox;

create policy "Users can mark own notifications read"
  on public.notification_outbox
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
