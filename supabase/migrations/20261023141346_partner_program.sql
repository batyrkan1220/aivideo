-- Partner (referral) program: partners share a Telegram/site link; referred customers' payments
-- earn the partner a percentage. Server-only tables (RLS on, no policies).
create table if not exists partners (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9]{4,24}$'),
  name text not null check (char_length(name) between 1 and 80),
  telegram_username text check (telegram_username is null or telegram_username ~ '^[A-Za-z0-9_]{3,32}$'),
  telegram_id bigint,
  contact text check (contact is null or char_length(contact) <= 200),
  percent numeric(5,2) not null check (percent >= 0 and percent <= 90),
  active boolean not null default true,
  notes text check (notes is null or char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id) on delete set null
);
alter table partners enable row level security;

alter table profiles add column if not exists referred_by uuid references partners(id) on delete set null;
alter table profiles add column if not exists referred_at timestamptz;
create index if not exists profiles_referred_by_idx on profiles(referred_by);

-- Telegram users who opened the bot via a partner link before they had an account.
create table if not exists partner_touches (
  telegram_id bigint primary key,
  partner_id uuid not null references partners(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table partner_touches enable row level security;

-- Link opens (bot /start, Mini App start, site ?ref=) for stats.
create table if not exists partner_visits (
  id bigint generated always as identity primary key,
  partner_id uuid not null references partners(id) on delete cascade,
  source text not null check (source in ('bot', 'app', 'site')),
  created_at timestamptz not null default now()
);
create index if not exists partner_visits_partner_idx on partner_visits(partner_id, created_at desc);
alter table partner_visits enable row level security;

create table if not exists partner_commissions (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partners(id) on delete cascade,
  order_id uuid not null unique references orders(id) on delete cascade,
  user_id uuid references profiles(id) on delete set null,
  order_amount_kzt int not null,
  percent numeric(5,2) not null,
  commission_kzt int not null,
  status text not null default 'earned' check (status in ('earned', 'reversed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists partner_commissions_partner_idx on partner_commissions(partner_id, created_at desc);
alter table partner_commissions enable row level security;

create table if not exists partner_payouts (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partners(id) on delete cascade,
  amount_kzt int not null check (amount_kzt > 0),
  note text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id) on delete set null
);
create index if not exists partner_payouts_partner_idx on partner_payouts(partner_id, created_at desc);
alter table partner_payouts enable row level security;

-- Commissions follow the order's payment status, whatever code path changed it:
-- paid (real provider) → earned; refunded → reversed.
create or replace function public.partner_commission_on_payment()
returns trigger language plpgsql security definer set search_path = public as $$
declare pid uuid; pct numeric; prov text;
begin
  if new.payment_status = 'succeeded' and old.payment_status is distinct from 'succeeded' then
    select p.provider into prov from payments p
      where p.order_id = new.id and p.status = 'succeeded' order by p.verified_at desc nulls last limit 1;
    if prov is null or prov in ('sandbox', 'tole_sandbox') then return new; end if;
    select pr.referred_by, pa.percent into pid, pct
      from profiles pr join partners pa on pa.id = pr.referred_by and pa.active
      where pr.id = new.user_id;
    if pid is null then return new; end if;
    insert into partner_commissions (partner_id, order_id, user_id, order_amount_kzt, percent, commission_kzt)
    values (pid, new.id, new.user_id, new.amount_kzt, pct, floor(new.amount_kzt * pct / 100))
    on conflict (order_id) do update set status = 'earned', updated_at = now();
  elsif new.payment_status = 'refunded' and old.payment_status is distinct from 'refunded' then
    update partner_commissions set status = 'reversed', updated_at = now() where order_id = new.id;
  end if;
  return new;
end $$;
revoke execute on function public.partner_commission_on_payment() from public, anon, authenticated;

create or replace trigger orders_partner_commission after update of payment_status on orders
  for each row execute function public.partner_commission_on_payment();

-- Per-partner totals for the admin page.
create or replace function public.partner_stats()
returns table (partner_id uuid, visits bigint, users bigint, paid_orders bigint, revenue_kzt bigint,
               earned_kzt bigint, reversed_kzt bigint, paid_out_kzt bigint)
language sql stable security definer set search_path = public as $$
  select p.id,
    (select count(*) from partner_visits v where v.partner_id = p.id),
    (select count(*) from profiles pr where pr.referred_by = p.id),
    (select count(*) from partner_commissions c where c.partner_id = p.id and c.status = 'earned'),
    (select coalesce(sum(c.order_amount_kzt), 0) from partner_commissions c where c.partner_id = p.id and c.status = 'earned'),
    (select coalesce(sum(c.commission_kzt), 0) from partner_commissions c where c.partner_id = p.id and c.status = 'earned'),
    (select coalesce(sum(c.commission_kzt), 0) from partner_commissions c where c.partner_id = p.id and c.status = 'reversed'),
    (select coalesce(sum(o.amount_kzt), 0) from partner_payouts o where o.partner_id = p.id)
  from partners p;
$$;
revoke execute on function public.partner_stats() from public, anon, authenticated;
grant execute on function public.partner_stats() to service_role;
