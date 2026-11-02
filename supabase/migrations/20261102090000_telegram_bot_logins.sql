-- Website sign-in through the bot: the browser makes a request, the person taps Start in Telegram,
-- the bot confirms it, and the browser (or a one-time link from the bot) finishes the sign-in.
create table if not exists telegram_logins (
  id uuid primary key default gen_random_uuid(),
  guest_user_id uuid references auth.users(id) on delete set null,
  next_path text not null check (next_path ~ '^/[A-Za-z0-9/_?=&-]*$'),
  telegram_id bigint,
  tg_first_name text,
  tg_last_name text,
  tg_username text,
  confirmed_at timestamptz,
  used_at timestamptz,
  expires_at timestamptz not null default now() + interval '20 minutes',
  created_at timestamptz not null default now()
);
create index if not exists telegram_logins_created_idx on telegram_logins(created_at desc);
alter table telegram_logins enable row level security;
-- no policies: only the service role (server) can read or write.
alter table telegram_logins add column if not exists link_used_at timestamptz;
