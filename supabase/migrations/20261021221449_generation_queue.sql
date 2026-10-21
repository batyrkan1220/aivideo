alter table generation_jobs add column retryable boolean not null default true;
alter table generation_jobs add column last_polled_at timestamptz;

/*
  Durable queue claim: picks due jobs nobody is working on (or whose worker died:
  lock older than 5 minutes), locks them for this worker. SKIP LOCKED makes
  concurrent workers safe.
*/
create function public.claim_generation_jobs(p_worker text, p_limit int)
returns setof generation_jobs
language sql security definer set search_path = public as $$
  update generation_jobs j set locked_at = now(), locked_by = p_worker
  where j.id in (
    select id from generation_jobs
    where status in ('queued', 'processing', 'postprocessing')
      and next_attempt_at <= now()
      and (locked_at is null or locked_at < now() - interval '5 minutes')
    order by next_attempt_at
    for update skip locked
    limit p_limit
  )
  returning j.*;
$$;
revoke execute on function public.claim_generation_jobs(text, int) from public, anon, authenticated;
grant execute on function public.claim_generation_jobs(text, int) to service_role;

/* Today's provider spend (UTC day), for the configurable spending limit. */
create function public.provider_spend_today()
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(provider_cost), 0) from generation_jobs where created_at >= date_trunc('day', now());
$$;
revoke execute on function public.provider_spend_today() from public, anon, authenticated;
grant execute on function public.provider_spend_today() to service_role;
