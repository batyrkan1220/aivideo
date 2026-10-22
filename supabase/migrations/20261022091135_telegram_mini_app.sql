-- Telegram Mini App: link accounts to Telegram users, one-time browser hand-off links.
alter table profiles add column if not exists telegram_id bigint unique;
alter table profiles add column if not exists telegram_username text;

-- One-time, short-lived links that sign a Telegram user into the regular browser
-- (payment happens on the website, not inside Telegram). Service role only.
create table if not exists login_handoffs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  next_path text not null check (next_path ~ '^/[A-Za-z0-9/_-]*$'),
  expires_at timestamptz not null default now() + interval '10 minutes',
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists login_handoffs_user_idx on login_handoffs(user_id, created_at desc);
alter table login_handoffs enable row level security;
-- no policies: only the service role (server) can read or write.
