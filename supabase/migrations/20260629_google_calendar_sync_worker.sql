-- Google Calendar sync worker helpers: atomic job claiming for process-calendar-sync-jobs.

create or replace function public.claim_calendar_sync_jobs(
  p_limit integer default 20,
  p_stale_processing_interval interval default interval '15 minutes'
)
returns setof public.calendar_sync_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.calendar_sync_jobs
  set
    status = 'pending',
    updated_at = timezone('utc', now())
  where status = 'processing'
    and updated_at < timezone('utc', now()) - p_stale_processing_interval;

  return query
  with picked as (
    select csj.id
    from public.calendar_sync_jobs csj
    where csj.status = 'pending'
      and csj.next_attempt_at <= timezone('utc', now())
    order by csj.next_attempt_at asc, csj.queued_at asc
    limit greatest(1, least(coalesce(p_limit, 20), 100))
    for update skip locked
  )
  update public.calendar_sync_jobs csj
  set
    status = 'processing',
    updated_at = timezone('utc', now())
  from picked
  where csj.id = picked.id
  returning csj.*;
end;
$$;

revoke all on function public.claim_calendar_sync_jobs(integer, interval) from public;
grant execute on function public.claim_calendar_sync_jobs(integer, interval) to service_role;
