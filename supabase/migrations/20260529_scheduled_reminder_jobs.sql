-- Automatic reminder enqueue scheduling for SALO
-- This migration is intentionally defensive: it will not fail if pg_cron
-- is unavailable, and it keeps manual email processing flows unchanged.

create extension if not exists pg_cron;

create or replace function public.run_salo_reminder_enqueue_cycle(
  p_reminder24h_limit integer default 200,
  p_reminder2h_limit integer default 200
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_24h_count integer := 0;
  v_2h_count integer := 0;
begin
  v_24h_count := coalesce(
    public.enqueue_booking_reminder_24h(greatest(1, p_reminder24h_limit), 60),
    0
  );

  v_2h_count := coalesce(
    public.enqueue_booking_reminder_2h(greatest(1, p_reminder2h_limit), 30),
    0
  );

  return jsonb_build_object(
    'ok', true,
    'reminder24h_count', v_24h_count,
    'reminder2h_count', v_2h_count,
    'total_queued', v_24h_count + v_2h_count
  );
end;
$$;

-- Schedule every 15 minutes if pg_cron is available.
do $$
declare
  v_has_cron boolean := false;
  v_job_id bigint;
begin
  select exists (
    select 1
    from pg_extension
    where extname = 'pg_cron'
  ) into v_has_cron;

  if not v_has_cron then
    raise notice '[SALO reminders] pg_cron not available; skipping schedule creation.';
    return;
  end if;

  for v_job_id in
    select j.jobid
    from cron.job j
    where j.jobname = 'salo-reminder-enqueue-15m'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'salo-reminder-enqueue-15m',
    '*/15 * * * *',
    $job$select public.run_salo_reminder_enqueue_cycle();$job$
  );

  raise notice '[SALO reminders] scheduled job salo-reminder-enqueue-15m (every 15 minutes).';
exception
  when others then
    raise notice '[SALO reminders] schedule creation skipped: %', SQLERRM;
end;
$$;

revoke all on function public.run_salo_reminder_enqueue_cycle(integer, integer) from public;
