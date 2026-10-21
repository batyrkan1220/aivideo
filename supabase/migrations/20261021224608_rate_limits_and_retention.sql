-- Fixed-window rate limiter shared by all app instances.
create table private.rate_limits (
  key text primary key,
  window_start timestamptz not null,
  hits int not null
);

/* Returns true when the call is allowed (and counts it), false when over the limit. */
create function public.hit_rate_limit(p_key text, p_max int, p_window_seconds int)
returns boolean language plpgsql security definer set search_path = public, private as $$
declare v_hits int;
begin
  insert into private.rate_limits as r (key, window_start, hits)
  values (p_key, now(), 1)
  on conflict (key) do update set
    hits = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end,
    window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
  returning hits into v_hits;
  return v_hits <= p_max;
end $$;
revoke execute on function public.hit_rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.hit_rate_limit(text, int, int) to service_role;

/*
  File retention needs the Storage API (objects can't be removed with plain SQL),
  so a daily job calls the app's retention endpoint with the shared worker secret.
  The endpoint also prunes old limiter rows and processed webhook ids.
*/
create or replace function private.kick_retention() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_url text; v_secret text;
begin
  select replace(decrypted_secret, '/tick', '/retention') into v_url from vault.decrypted_secrets where name = 'worker_tick_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'worker_secret';
  if v_url is null or v_secret is null then return; end if;
  perform net.http_post(url := v_url,
    headers := jsonb_build_object('content-type', 'application/json', 'x-worker-secret', v_secret),
    body := '{}'::jsonb, timeout_milliseconds := 60000);
end $$;
revoke execute on function private.kick_retention() from public, anon, authenticated;
select cron.schedule('file-retention', '23 21 * * *', $$select private.kick_retention()$$); -- 02:23 Almaty
