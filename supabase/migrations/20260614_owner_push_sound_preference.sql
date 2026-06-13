-- Owner push notification sound preference
alter table public.notification_preferences
  add column if not exists owner_push_sound_enabled boolean not null default true;
