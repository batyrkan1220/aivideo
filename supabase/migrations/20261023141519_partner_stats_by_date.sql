-- Partner numbers for a date range (Almaty days) and a per-day breakdown.
create or replace function public.partner_stats_period(p_from timestamptz, p_to timestamptz)
returns table (partner_id uuid, visits bigint, users bigint, buyers bigint, paid_orders bigint, revenue_kzt bigint,
               earned_kzt bigint, reversed_kzt bigint, paid_out_kzt bigint)
language sql stable security definer set search_path = public as $$
  select p.id,
    (select count(*) from partner_visits v where v.partner_id = p.id and v.created_at >= p_from and v.created_at < p_to),
    (select count(*) from profiles pr where pr.referred_by = p.id and pr.referred_at >= p_from and pr.referred_at < p_to),
    (select count(distinct c.user_id) from partner_commissions c where c.partner_id = p.id and c.status = 'earned' and c.created_at >= p_from and c.created_at < p_to),
    (select count(*) from partner_commissions c where c.partner_id = p.id and c.status = 'earned' and c.created_at >= p_from and c.created_at < p_to),
    (select coalesce(sum(c.order_amount_kzt), 0) from partner_commissions c where c.partner_id = p.id and c.status = 'earned' and c.created_at >= p_from and c.created_at < p_to),
    (select coalesce(sum(c.commission_kzt), 0) from partner_commissions c where c.partner_id = p.id and c.status = 'earned' and c.created_at >= p_from and c.created_at < p_to),
    (select coalesce(sum(c.commission_kzt), 0) from partner_commissions c where c.partner_id = p.id and c.status = 'reversed' and c.created_at >= p_from and c.created_at < p_to),
    (select coalesce(sum(o.amount_kzt), 0) from partner_payouts o where o.partner_id = p.id and o.created_at >= p_from and o.created_at < p_to)
  from partners p;
$$;
revoke execute on function public.partner_stats_period(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.partner_stats_period(timestamptz, timestamptz) to service_role;

create or replace function public.partner_daily(p_partner uuid, p_from timestamptz, p_to timestamptz)
returns table (day date, visits bigint, users bigint, paid_orders bigint, revenue_kzt bigint, earned_kzt bigint)
language sql stable security definer set search_path = public as $$
  with days as (
    select generate_series((p_from at time zone 'Asia/Almaty')::date, ((p_to - interval '1 second') at time zone 'Asia/Almaty')::date, interval '1 day')::date as day
  )
  select d.day,
    (select count(*) from partner_visits v where (p_partner is null or v.partner_id = p_partner) and (v.created_at at time zone 'Asia/Almaty')::date = d.day),
    (select count(*) from profiles pr where pr.referred_by is not null and (p_partner is null or pr.referred_by = p_partner) and (pr.referred_at at time zone 'Asia/Almaty')::date = d.day),
    (select count(*) from partner_commissions c where (p_partner is null or c.partner_id = p_partner) and c.status = 'earned' and (c.created_at at time zone 'Asia/Almaty')::date = d.day),
    (select coalesce(sum(c.order_amount_kzt), 0) from partner_commissions c where (p_partner is null or c.partner_id = p_partner) and c.status = 'earned' and (c.created_at at time zone 'Asia/Almaty')::date = d.day),
    (select coalesce(sum(c.commission_kzt), 0) from partner_commissions c where (p_partner is null or c.partner_id = p_partner) and c.status = 'earned' and (c.created_at at time zone 'Asia/Almaty')::date = d.day)
  from days d order by d.day desc;
$$;
revoke execute on function public.partner_daily(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.partner_daily(uuid, timestamptz, timestamptz) to service_role;
