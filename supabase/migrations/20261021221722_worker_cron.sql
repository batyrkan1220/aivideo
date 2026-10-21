create extension if not exists pg_cron;
create extension if not exists pg_net;

/*
  Wakes the app's worker once a minute, but ONLY while generation jobs are due
  (so an idle site is not kept awake). The shared secret lives in Supabase Vault
  under the name 'worker_secret'; the app URL under 'worker_tick_url'.
  One-time setup (NOT in git — run manually in the SQL editor):
    select vault.create_secret('<WORKER_SECRET>', 'worker_secret');
    select vault.create_secret('https://<app>/api/worker/tick', 'worker_tick_url');
*/
create or replace function private.kick_worker() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_url text;
  v_secret text;
begin
  if not exists (
    select 1 from public.generation_jobs
    where status in ('queued', 'processing', 'postprocessing') and next_attempt_at <= now()
  ) then
    return;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'worker_tick_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'worker_secret';
  if v_url is null or v_secret is null then return; end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('content-type', 'application/json', 'x-worker-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end $$;
revoke execute on function private.kick_worker() from public, anon, authenticated;

select cron.schedule('kick-generation-worker', '* * * * *', $$select private.kick_worker()$$);
