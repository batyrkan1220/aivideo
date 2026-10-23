-- Numbers for ONE partner (Teliks API): period totals + lifetime totals, without scanning all partners.
create or replace function public.partner_stats_one(p_partner uuid, p_from timestamptz, p_to timestamptz)
returns table (visits bigint, users bigint, buyers bigint, paid_orders bigint, revenue_kzt bigint,
               earned_kzt bigint, reversed_kzt bigint, paid_out_kzt bigint,
               life_earned_kzt bigint, life_reversed_kzt bigint, life_paid_out_kzt bigint)
language sql stable security definer set search_path = public as $$
  select
    (select count(*) from partner_visits v where v.partner_id = p_partner and v.created_at >= p_from and v.created_at < p_to),
    (select count(*) from profiles pr where pr.referred_by = p_partner and pr.referred_at >= p_from and pr.referred_at < p_to),
    (select count(distinct c.user_id) from partner_commissions c where c.partner_id = p_partner and c.status = 'earned' and c.created_at >= p_from and c.created_at < p_to),
    (select count(*) from partner_commissions c where c.partner_id = p_partner and c.status = 'earned' and c.created_at >= p_from and c.created_at < p_to),
    (select coalesce(sum(c.order_amount_kzt), 0) from partner_commissions c where c.partner_id = p_partner and c.status = 'earned' and c.created_at >= p_from and c.created_at < p_to),
    (select coalesce(sum(c.commission_kzt), 0) from partner_commissions c where c.partner_id = p_partner and c.status = 'earned' and c.created_at >= p_from and c.created_at < p_to),
    (select coalesce(sum(c.commission_kzt), 0) from partner_commissions c where c.partner_id = p_partner and c.status = 'reversed' and c.created_at >= p_from and c.created_at < p_to),
    (select coalesce(sum(o.amount_kzt), 0) from partner_payouts o where o.partner_id = p_partner and o.created_at >= p_from and o.created_at < p_to),
    (select coalesce(sum(c.commission_kzt), 0) from partner_commissions c where c.partner_id = p_partner and c.status = 'earned'),
    (select coalesce(sum(c.commission_kzt), 0) from partner_commissions c where c.partner_id = p_partner and c.status = 'reversed'),
    (select coalesce(sum(o.amount_kzt), 0) from partner_payouts o where o.partner_id = p_partner);
$$;
revoke execute on function public.partner_stats_one(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.partner_stats_one(uuid, timestamptz, timestamptz) to service_role;
