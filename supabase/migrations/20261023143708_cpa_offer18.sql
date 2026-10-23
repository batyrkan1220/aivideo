-- CPA network (Offer18 / Teliks): click id from the tracking link, S2S postbacks on conversions.
alter table profiles add column if not exists cpa_network text;
alter table profiles add column if not exists cpa_click_id text check (cpa_click_id is null or cpa_click_id ~ '^[A-Za-z0-9_-]{4,64}$');
alter table profiles add column if not exists cpa_at timestamptz;

-- Telegram users who opened the bot from a tracking link before they had an account.
create table if not exists cpa_touches (
  telegram_id bigint primary key,
  network text not null,
  click_id text not null check (click_id ~ '^[A-Za-z0-9_-]{4,64}$'),
  created_at timestamptz not null default now()
);
alter table cpa_touches enable row level security;

-- Every postback sent (or tried), for the admin log and retries. URL stored without query secrets.
create table if not exists cpa_postbacks (
  id uuid primary key default gen_random_uuid(),
  network text not null,
  event text not null check (event in ('lead', 'sale')),
  click_id text not null,
  user_id uuid references profiles(id) on delete set null,
  order_id uuid references orders(id) on delete set null,
  amount_kzt int,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  http_status int,
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (event, order_id),
  unique (event, user_id, click_id)
);
create index if not exists cpa_postbacks_created_idx on cpa_postbacks(created_at desc);
alter table cpa_postbacks enable row level security;

insert into site_settings (key, value)
values ('cpa', jsonb_build_object('enabled', false, 'network', 'offer18', 'postbackUrl', '', 'sendLead', false, 'sendSale', true))
on conflict (key) do nothing;
