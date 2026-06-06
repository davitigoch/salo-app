-- Schedule push notification worker every 5 minutes.
--
-- Idempotent behavior:
-- - Unschedules any existing salo-send-push-notifications-5m jobs first.
-- - Skips safely when pg_cron/pg_net or service role key are unavailable.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare
  v_has_cron boolean := false;
  v_has_net boolean := false;
  v_has_vault boolean := false;
  v_service_role_key text;
  v_job_id bigint;
  v_command text;
begin
  select exists (
    select 1
    from pg_extension
    where extname = 'pg_cron'
  ) into v_has_cron;

  if not v_has_cron then
    raise notice '[SALO push worker] pg_cron not available; skipping schedule creation.';
    return;
  end if;

  select exists (
    select 1
    from pg_extension
    where extname = 'pg_net'
  ) into v_has_net;

  if not v_has_net then
    raise notice '[SALO push worker] pg_net not available; skipping schedule creation.';
    return;
  end if;

  -- Resolve service role key from DB settings first.
  v_service_role_key := nullif(current_setting('app.settings.service_role_key', true), '');
  if v_service_role_key is null then
    v_service_role_key := nullif(current_setting('service_role_key', true), '');
  end if;

  -- Fallback: resolve from vault if available.
  select exists (
    select 1
    from pg_extension
    where extname = 'vault'
  ) into v_has_vault;

  if v_service_role_key is null and v_has_vault then
    if exists (
      select 1
      from pg_namespace n
      join pg_class c on c.relnamespace = n.oid
      where n.nspname = 'vault'
        and c.relname = 'decrypted_secrets'
    ) then
      select ds.secret
      into v_service_role_key
      from vault.decrypted_secrets ds
      where ds.name in ('SUPABASE_SERVICE_ROLE_KEY', 'SERVICE_ROLE_KEY', 'service_role_key')
        and nullif(trim(ds.secret), '') is not null
      order by ds.updated_at desc nulls last
      limit 1;
    end if;
  end if;

  if v_service_role_key is null then
    raise notice '[SALO push worker] Missing service role key; skipping schedule creation. Configure app.settings.service_role_key or Vault secret SUPABASE_SERVICE_ROLE_KEY.';
    return;
  end if;

  -- Idempotent unschedule of existing jobs with the same name.
  for v_job_id in
    select j.jobid
    from cron.job j
    where j.jobname = 'salo-send-push-notifications-5m'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  v_command := format(
    $job$
select net.http_post(
  url := %L,
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', %L,
    'apikey', %L
  ),
  body := %L::jsonb
);
$job$,
    'https://odjmbvdxbffxjjhgpbkw.supabase.co/functions/v1/send-push-notifications',
    'Bearer ' || v_service_role_key,
    v_service_role_key,
    '{"limit":50}'
  );

  perform cron.schedule(
    'salo-send-push-notifications-5m',
    '*/5 * * * *',
    v_command
  );

  raise notice '[SALO push worker] Scheduled salo-send-push-notifications-5m (every 5 minutes).';
exception
  when others then
    raise notice '[SALO push worker] schedule creation skipped: %', SQLERRM;
end;
$$;
