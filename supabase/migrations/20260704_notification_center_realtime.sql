-- PR4 Phase 4.3: Enable Supabase Realtime for Notification Center tables.

alter table public.notification_events replica identity full;
alter table public.notification_reads replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notification_events'
  ) then
    alter publication supabase_realtime add table public.notification_events;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notification_reads'
  ) then
    alter publication supabase_realtime add table public.notification_reads;
  end if;
end;
$$;
