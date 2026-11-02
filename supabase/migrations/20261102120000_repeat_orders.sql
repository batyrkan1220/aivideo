-- Repeat orders: reuse a photo, a one-time discount after the first video, payment reminders.

-- Photos the customer chose to keep for 30 days (reused in 1 tap).
alter table order_assets add column if not exists saved_at timestamptz;

-- One message of each kind per order.
alter table orders add column if not exists reminder_sent_at timestamptz;
alter table orders add column if not exists followup_sent_at timestamptz;

-- Personal discounts (e.g. "second video −20% until tomorrow"). Service role only.
create table if not exists user_discounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  percent int not null check (percent between 1 and 90),
  reason text not null,
  expires_at timestamptz not null,
  used_order_id uuid references orders(id) on delete set null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists user_discounts_user_idx on user_discounts(user_id, expires_at desc);
alter table user_discounts enable row level security;

-- A discount is marked used by the app when its order is paid (payments/process + reconcile).

-- Every 10 minutes: payment reminders and next-day offers (the app decides what to send).
create or replace function private.kick_engage() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_url text; v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'worker_tick_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'worker_secret';
  if v_url is null or v_secret is null then return; end if;
  perform net.http_post(
    url := replace(v_url, '/api/worker/tick', '/api/worker/engage'),
    headers := jsonb_build_object('content-type', 'application/json', 'x-worker-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end $$;
select cron.unschedule('engage') where exists (select 1 from cron.job where jobname = 'engage');
select cron.schedule('engage', '*/10 * * * *', 'select private.kick_engage()');
