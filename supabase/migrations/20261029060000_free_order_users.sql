-- Users who order without payment (owner/staff tests, gifts). Service role only.
create table if not exists free_order_users (
  user_id uuid primary key references profiles(id) on delete cascade,
  granted_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table free_order_users enable row level security;
revoke all on free_order_users from anon, authenticated;

-- Marks an unpaid order of a free-order user as paid (provider 'free', 0 ₸) and queues generation
-- through the same apply_payment_event path as a real payment.
create or replace function public.place_free_order(p_order_id uuid, p_user_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare ord orders%rowtype; pid text := 'free_' || p_order_id::text;
begin
  if not exists (select 1 from free_order_users where user_id = p_user_id) then return 'not_allowed'; end if;
  select * into ord from orders where id = p_order_id and user_id = p_user_id for update;
  if not found then return 'not_found'; end if;
  if ord.generation_status <> 'awaiting_payment' or ord.payment_status = 'succeeded' then return 'not_payable'; end if;
  insert into payments (order_id, provider, provider_payment_id, amount_kzt, currency, status, idempotency_key)
  values (ord.id, 'free', pid, 0, 'KZT', 'pending', 'free:' || ord.id::text)
  on conflict (idempotency_key) do nothing;
  return public.apply_payment_event('free', pid, 'succeeded', 0, 'KZT', null);
end $$;
revoke execute on function public.place_free_order(uuid, uuid) from public, anon, authenticated;
grant execute on function public.place_free_order(uuid, uuid) to service_role;

-- No partner commission on free orders.
create or replace function public.partner_commission_on_payment()
returns trigger language plpgsql security definer set search_path = public as $$
declare pid uuid; pct numeric; prov text;
begin
  if new.payment_status = 'succeeded' and old.payment_status is distinct from 'succeeded' then
    select p.provider into prov from payments p
      where p.order_id = new.id and p.status = 'succeeded' order by p.verified_at desc nulls last limit 1;
    if prov is null or prov in ('sandbox', 'tole_sandbox', 'free') then return new; end if;
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
