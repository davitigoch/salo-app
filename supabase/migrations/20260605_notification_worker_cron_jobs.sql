-- Schedule notification delivery workers every minute.
--
-- This migration is idempotent and safe:
-- - It unschedules existing jobs with the same names before creating new ones.
-- - It does NOT touch the existing reminder enqueue cron job.
-- - It attempts to resolve project URL and service role key from DB settings and vault.
-- - If values are missing, it skips scheduling and prints a notice.
--
-- Expected function endpoints:
--   <project-url>/functions/v1/process-notification-outbox
--   <project-url>/functions/v1/send-push-notifications
--
-- If auto-resolution is unavailable in your environment, define one of:
-- - DB settings:
--     app.settings.supabase_url
--     app.settings.service_role_key
-- - Vault secret names (any one from each group):
--     URL: SUPABASE_URL, EXPO_PUBLIC_SUPABASE_URL, PROJECT_URL, project_url
--     KEY: SUPABASE_SERVICE_ROLE_KEY, SERVICE_ROLE_KEY, service_role_key

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Allow reading schedule metadata in SQL clients with restricted default search_path.
set search_path = public;

do $$
declare
  v_has_cron boolean := false;
  v_has_net boolean := false;
  v_has_vault boolean := false;
  v_project_url text;
  v_service_role_key text;
  v_process_command text;
  v_push_command text;
  v_job_id bigint;
begin
  select exists (
    select 1 from pg_extension where extname = 'pg_cron'
  ) into v_has_cron;

  if not v_has_cron then
    raise notice '[SALO notifications] pg_cron not available; skipping worker schedule creation.';
    return;
  end if;

  select exists (
    select 1 from pg_extension where extname = 'pg_net'
  ) into v_has_net;

  if not v_has_net then
    raise notice '[SALO notifications] pg_net not available; skipping worker schedule creation.';
    return;
  end if;

  -- 1) Try DB settings first.
  v_project_url := nullif(current_setting('app.settings.supabase_url', true), '');
  if v_project_url is null then
    v_project_url := nullif(current_setting('supabase_url', true), '');
  end if;

  v_service_role_key := nullif(current_setting('app.settings.service_role_key', true), '');
  if v_service_role_key is null then
    v_service_role_key := nullif(current_setting('service_role_key', true), '');
  end if;

  -- 2) Try Vault (if extension and view exist).
  select exists (
    select 1
    from pg_extension
    where extname = 'vault'
  ) into v_has_vault;

  if v_has_vault then
    if exists (
      select 1
      from pg_namespace n
      join pg_class c on c.relnamespace = n.oid
      where n.nspname = 'vault'
        and c.relname = 'decrypted_secrets'
    ) then
      if v_project_url is null then
        select ds.secret
        into v_project_url
        from vault.decrypted_secrets ds
        where ds.name in ('SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_URL', 'PROJECT_URL', 'project_url')
          and nullif(trim(ds.secret), '') is not null
        order by ds.updated_at desc nulls last
        limit 1;
      end if;

      if v_service_role_key is null then
        select ds.secret
        into v_service_role_key
        from vault.decrypted_secrets ds
        where ds.name in ('SUPABASE_SERVICE_ROLE_KEY', 'SERVICE_ROLE_KEY', 'service_role_key')
          and nullif(trim(ds.secret), '') is not null
        order by ds.updated_at desc nulls last
        limit 1;
      end if;
    end if;
  end if;

  -- 3) Validate and normalize URL.
  v_project_url := nullif(trim(coalesce(v_project_url, '')), '');
  if v_project_url is not null then
    v_project_url := regexp_replace(v_project_url, '/+$', '');
  end if;

  if v_project_url is null or v_service_role_key is null then
    raise notice '[SALO notifications] Missing project URL or service role key; skipping worker schedule creation. Configure app.settings.* or vault secrets.';
    return;
  end if;

  -- Remove old jobs (idempotent).
  for v_job_id in
    select j.jobid
    from cron.job j
    where j.jobname = 'salo_process_notification_outbox_every_minute'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  for v_job_id in
    select j.jobid
    from cron.job j
    where j.jobname = 'salo_send_push_notifications_every_minute'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  -- Build commands with explicit auth headers.
  v_process_command := format(
    $cmd$
select net.http_post(
  url := %L,
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', %L,
    'apikey', %L
  ),
  body := %L::jsonb
);
$cmd$,
    v_project_url || '/functions/v1/process-notification-outbox',
    'Bearer ' || v_service_role_key,
    v_service_role_key,
    '{"limit":25}'
  );

  v_push_command := format(
    $cmd$
select net.http_post(
  url := %L,
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', %L,
    'apikey', %L
  ),
  body := %L::jsonb
);
$cmd$,
    v_project_url || '/functions/v1/send-push-notifications',
    'Bearer ' || v_service_role_key,
    v_service_role_key,
    '{"limit":50}'
  );

  perform cron.schedule(
    'salo_process_notification_outbox_every_minute',
    '* * * * *',
    v_process_command
  );

  perform cron.schedule(
    'salo_send_push_notifications_every_minute',
    '* * * * *',
    v_push_command
  );

  raise notice '[SALO notifications] Scheduled salo_process_notification_outbox_every_minute and salo_send_push_notifications_every_minute.';
exception
  when others then
    raise notice '[SALO notifications] worker schedule creation skipped: %', SQLERRM;
end;
$$;
