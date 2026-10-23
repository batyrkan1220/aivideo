-- Orders of customers brought by partners (every payment status), for the Teliks conversions log.
create or replace function public.partner_orders(p_from timestamptz, p_to timestamptz)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(t order by t.time desc), '[]'::jsonb) from (
    select o.created_at as time, o.updated_at as updated, pa.code, o.public_order_number as "order", o.amount_kzt as "amountKzt",
           o.payment_status::text as "paymentStatus",
           (select p.provider from payments p where p.order_id = o.id order by p.created_at desc limit 1) as provider,
           c.status as "commissionStatus", c.commission_kzt as "commissionKzt", coalesce(c.percent, pa.percent) as percent
    from orders o
    join profiles pr on pr.id = o.user_id
    join partners pa on pa.id = pr.referred_by
    left join partner_commissions c on c.order_id = o.id
    where o.created_at >= p_from and o.created_at < p_to
    order by o.created_at desc
    limit 3000
  ) t;
$$;
revoke all on function public.partner_orders(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.partner_orders(timestamptz, timestamptz) to service_role;
