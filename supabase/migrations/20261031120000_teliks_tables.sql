-- Teliks (CPA network) tables in the shared TrendMe project, prefixed tk_.
-- Teliks Supabase (project "teliks"). Server-only tables: RLS on, no policies (service role).
create table if not exists public.tk_partners (
  user_id uuid primary key references auth.users(id) on delete cascade,
  trendme_code text not null unique check (trendme_code ~ '^[a-z0-9]{4,24}$'),
  name text not null check (char_length(name) between 1 and 80),
  email text,
  payout_method text check (payout_method in ('kaspi', 'card', 'usdt', 'bank')),
  payout_value text check (payout_value is null or char_length(payout_value) <= 64),
  payout_updated_at timestamptz,
  active boolean not null default true,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.tk_partners enable row level security;

create table if not exists public.tk_payout_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.tk_partners(user_id) on delete cascade,
  amount_kzt int not null check (amount_kzt > 0),
  method text not null,
  details text not null,
  status text not null default 'processing',
  note text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists tk_payout_requests_user_idx on public.tk_payout_requests(user_id, created_at desc);
create index if not exists tk_payout_requests_status_idx on public.tk_payout_requests(status, created_at);
alter table public.tk_payout_requests enable row level security;

-- Teliks as a self-hosted CPA network: advertisers, offers, partner access, clicks, conversions,
-- postback log. Server-only tables: RLS on, no policies (service role only).

create table if not exists public.tk_advertisers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  company text check (company is null or char_length(company) <= 120),
  email text check (email is null or char_length(email) <= 254),
  telegram text check (telegram is null or char_length(telegram) <= 64),
  website text check (website is null or char_length(website) <= 300),
  notes text check (notes is null or char_length(notes) <= 2000),
  api_key_hash text unique,          -- sha256 of the key; the key itself is shown once
  api_key_prefix text,               -- first characters, to recognise the key in the admin
  status text not null default 'active' check (status in ('active', 'paused')),
  created_at timestamptz not null default now()
);
alter table public.tk_advertisers enable row level security;

create table if not exists public.tk_offers (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9_-]{1,31}$'),
  advertiser_id uuid not null references public.tk_advertisers(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 120),
  description text check (description is null or char_length(description) <= 5000),
  kpi text check (kpi is null or char_length(kpi) <= 3000),
  logo_url text check (logo_url is null or logo_url ~ '^https://'),
  preview_url text check (preview_url is null or preview_url ~ '^https?://'),
  target_url text not null check (target_url ~ '^https?://' and position('{click_id}' in target_url) > 0),
  categories text[] not null default '{}',
  geo text[] not null default '{}',
  model text not null default 'CPA' check (model in ('CPA', 'CPL', 'CPS', 'CPI', 'RevShare')),
  -- [{code, name, payout_type: fixed|percent, payout, revenue_type: fixed|percent, revenue}]
  goals jsonb not null default '[]' check (jsonb_typeof(goals) = 'array'),
  hold_days int not null default 0 check (hold_days between 0 and 90),
  daily_cap int check (daily_cap is null or daily_cap > 0),
  access text not null default 'approval' check (access in ('open', 'approval', 'private')),
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tk_offers_advertiser_idx on public.tk_offers(advertiser_id);
alter table public.tk_offers enable row level security;

create table if not exists public.tk_offer_access (
  offer_id text not null references public.tk_offers(id) on delete cascade,
  user_id uuid not null references public.tk_partners(user_id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  primary key (offer_id, user_id)
);
create index if not exists tk_offer_access_status_idx on public.tk_offer_access(status, created_at);
alter table public.tk_offer_access enable row level security;

create table if not exists public.tk_clicks (
  id text primary key check (id ~ '^[A-Za-z0-9]{16,32}$'),
  offer_id text not null references public.tk_offers(id) on delete cascade,
  user_id uuid not null references public.tk_partners(user_id) on delete cascade,
  sub1 text, sub2 text, sub3 text, sub4 text, sub5 text,
  source text, sub_aff_id text, aff_click_id text,
  ip inet, country text, device text, os text, browser text,
  ua text check (ua is null or char_length(ua) <= 400),
  referer text check (referer is null or char_length(referer) <= 400),
  created_at timestamptz not null default now()
);
create index if not exists tk_clicks_user_time_idx on public.tk_clicks(user_id, created_at);
create index if not exists tk_clicks_offer_time_idx on public.tk_clicks(offer_id, created_at);
create index if not exists tk_clicks_time_idx on public.tk_clicks(created_at);
alter table public.tk_clicks enable row level security;

create table if not exists public.tk_conversions (
  id uuid primary key default gen_random_uuid(),
  click_id text references public.tk_clicks(id) on delete set null,
  offer_id text not null references public.tk_offers(id) on delete restrict,
  user_id uuid not null references public.tk_partners(user_id) on delete restrict,
  advertiser_id uuid not null references public.tk_advertisers(id) on delete restrict,
  goal text not null default 'default' check (char_length(goal) between 1 and 32),
  external_id text check (external_id is null or char_length(external_id) <= 100),
  status text not null check (status in ('pending', 'approved', 'rejected')),
  adv_status text check (adv_status in ('pending', 'approved', 'rejected')),
  payout_kzt numeric(14, 2) not null default 0 check (payout_kzt >= 0),
  revenue_kzt numeric(14, 2) not null default 0 check (revenue_kzt >= 0),
  sale_amount_kzt numeric(14, 2) check (sale_amount_kzt is null or sale_amount_kzt >= 0),
  sub1 text, sub2 text, sub3 text, sub4 text, sub5 text, source text, country text,
  note text check (note is null or char_length(note) <= 300),
  hold_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists tk_conversions_ext_uq on public.tk_conversions(offer_id, goal, external_id) where external_id is not null;
create unique index if not exists tk_conversions_click_goal_uq on public.tk_conversions(click_id, goal) where external_id is null and click_id is not null;
create index if not exists tk_conversions_user_time_idx on public.tk_conversions(user_id, created_at);
create index if not exists tk_conversions_time_idx on public.tk_conversions(created_at);
create index if not exists tk_conversions_hold_idx on public.tk_conversions(hold_until) where status = 'pending' and adv_status = 'approved';
alter table public.tk_conversions enable row level security;

create table if not exists public.tk_postback_log (
  id bigserial primary key,
  direction text not null check (direction in ('in', 'out')),
  advertiser_id uuid references public.tk_advertisers(id) on delete set null,
  user_id uuid references public.tk_partners(user_id) on delete set null,
  offer_id text,
  conversion_id uuid,
  summary text check (summary is null or char_length(summary) <= 600),
  http_status int,
  ok boolean not null default false,
  message text check (message is null or char_length(message) <= 300),
  created_at timestamptz not null default now()
);
create index if not exists tk_postback_log_time_idx on public.tk_postback_log(created_at desc);
alter table public.tk_postback_log enable row level security;

alter table public.tk_partners add column if not exists postback_url text check (postback_url is null or (postback_url ~ '^https://' and char_length(postback_url) <= 600));
-- Part of a paid request that was recorded in TrendMe (the rest pays Teliks-native earnings).
alter table public.tk_payout_requests add column if not exists trendme_kzt int check (trendme_kzt is null or trendme_kzt >= 0);

/* ───── aggregates (Almaty days) ───── */
-- Results come back as one jsonb value (PostgREST caps row sets at 1000 rows).
create or replace function public.tk_cpa_click_rows(p_user uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(t), '[]'::jsonb) from (
    select (c.created_at at time zone 'Asia/Almaty')::date as day, extract(hour from c.created_at at time zone 'Asia/Almaty')::int as hour,
           c.offer_id, coalesce(c.country, '') as country, coalesce(c.device, '') as device, coalesce(c.os, '') as os,
           coalesce(c.browser, '') as browser, coalesce(c.source, '') as source,
           coalesce(c.sub1, '') as sub1, coalesce(c.sub2, '') as sub2, coalesce(c.sub3, '') as sub3, coalesce(c.sub4, '') as sub4, coalesce(c.sub5, '') as sub5,
           count(*) as clicks, count(distinct c.ip) as uniq
    from public.tk_clicks c
    where (p_user is null or c.user_id = p_user) and c.created_at >= p_from and c.created_at < p_to
    group by 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13
    limit 20000
  ) t;
$$;

create or replace function public.tk_cpa_daily(p_from timestamptz, p_to timestamptz)
returns jsonb language sql stable security definer set search_path = public as $$
  with k as (
    select (created_at at time zone 'Asia/Almaty')::date d, offer_id, user_id, count(*) n, count(distinct ip) u
    from public.tk_clicks where created_at >= p_from and created_at < p_to group by 1, 2, 3
  ), v as (
    select (created_at at time zone 'Asia/Almaty')::date d, offer_id, user_id,
           count(*) filter (where status = 'approved') a, count(*) filter (where status = 'pending') p, count(*) filter (where status = 'rejected') r,
           coalesce(sum(payout_kzt) filter (where status = 'approved'), 0) pay,
           coalesce(sum(payout_kzt) filter (where status = 'pending'), 0) ppay,
           coalesce(sum(revenue_kzt) filter (where status = 'approved'), 0) rev,
           coalesce(sum(revenue_kzt) filter (where status = 'pending'), 0) prev,
           coalesce(sum(sale_amount_kzt) filter (where status <> 'rejected'), 0) sales
    from public.tk_conversions where created_at >= p_from and created_at < p_to group by 1, 2, 3
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'day', coalesce(k.d, v.d), 'offer_id', coalesce(k.offer_id, v.offer_id), 'user_id', coalesce(k.user_id, v.user_id),
    'clicks', coalesce(k.n, 0), 'uniq', coalesce(k.u, 0), 'approved', coalesce(v.a, 0), 'pending', coalesce(v.p, 0), 'rejected', coalesce(v.r, 0),
    'payout_kzt', coalesce(v.pay, 0), 'pending_payout_kzt', coalesce(v.ppay, 0), 'revenue_kzt', coalesce(v.rev, 0),
    'pending_revenue_kzt', coalesce(v.prev, 0), 'sales_kzt', coalesce(v.sales, 0))), '[]'::jsonb)
  from k full join v on k.d = v.d and k.offer_id = v.offer_id and k.user_id = v.user_id;
$$;

create or replace function public.tk_cpa_balances(p_user uuid)
returns table (user_id uuid, approved_kzt numeric, pending_kzt numeric)
language sql stable security definer set search_path = public as $$
  select c.user_id, coalesce(sum(c.payout_kzt) filter (where c.status = 'approved'), 0), coalesce(sum(c.payout_kzt) filter (where c.status = 'pending'), 0)
  from public.tk_conversions c where p_user is null or c.user_id = p_user group by c.user_id;
$$;

create or replace function public.tk_cpa_cap_used(p_offer text, p_since timestamptz)
returns bigint language sql stable security definer set search_path = public as $$
  select count(*) from public.tk_conversions where offer_id = p_offer and created_at >= p_since and status <> 'rejected';
$$;

-- Advertiser approved, hold is over → the partner gets the money.
create or replace function public.tk_cpa_release_holds()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.tk_conversions set status = 'approved', updated_at = now()
  where status = 'pending' and adv_status = 'approved' and hold_until is not null and hold_until <= now();
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.tk_cpa_click_rows(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.tk_cpa_daily(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.tk_cpa_balances(uuid) from public, anon, authenticated;
revoke all on function public.tk_cpa_cap_used(text, timestamptz) from public, anon, authenticated;
revoke all on function public.tk_cpa_release_holds() from public, anon, authenticated;
grant execute on function public.tk_cpa_click_rows(uuid, timestamptz, timestamptz) to service_role;
grant execute on function public.tk_cpa_daily(timestamptz, timestamptz) to service_role;
grant execute on function public.tk_cpa_balances(uuid) to service_role;
grant execute on function public.tk_cpa_cap_used(text, timestamptz) to service_role;
grant execute on function public.tk_cpa_release_holds() to service_role;

-- Built-in integrations: an advertiser whose offer is tracked by its own API, not by /c/ links + postbacks.
alter table public.tk_advertisers add column if not exists integration text check (integration is null or integration in ('trendme'));
create unique index if not exists tk_advertisers_integration_uq on public.tk_advertisers(integration) where integration is not null;

-- (advertiser rows are copied from the Teliks project)

-- Offer details for the admin editor: creatives, allowed/banned traffic, run dates, internal notes.
alter table public.tk_offers add column if not exists creatives jsonb not null default '[]' check (jsonb_typeof(creatives) = 'array');
alter table public.tk_offers add column if not exists traffic_allowed text[] not null default '{}';
alter table public.tk_offers add column if not exists traffic_banned text[] not null default '{}';
alter table public.tk_offers add column if not exists starts_on date;
alter table public.tk_offers add column if not exists ends_on date;
alter table public.tk_offers add column if not exists notes text check (notes is null or char_length(notes) <= 2000);

-- Payout flow: partner can cancel; admin writes a payment reference or a rejection reason;
-- one open request per partner (no double requests against the same balance).
alter table public.tk_payout_requests add constraint tk_payout_requests_status_check check (status in ('processing', 'paid', 'rejected', 'cancelled'));
alter table public.tk_payout_requests add column if not exists paid_ref text check (paid_ref is null or char_length(paid_ref) <= 200);
alter table public.tk_payout_requests add column if not exists processed_by text check (processed_by is null or char_length(processed_by) <= 254);
create unique index if not exists tk_payout_requests_one_open_uq on public.tk_payout_requests(user_id) where status = 'processing';

-- Built-in offers (TrendMe): their catalog card (name, photo, texts, creatives, visibility) is edited
-- in Teliks; tracking and money stay in TrendMe. Plus a public bucket for offer photos/creatives
-- (uploads go through the Teliks server with the service key; nobody else can write).
alter table public.tk_offers add column if not exists integration text check (integration is null or integration in ('trendme'));
create unique index if not exists tk_offers_integration_uq on public.tk_offers(integration) where integration is not null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('offer-media', 'offer-media', true, 3145728, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
