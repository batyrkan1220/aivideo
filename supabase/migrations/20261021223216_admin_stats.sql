/*
  Real operational metrics for [p_from, p_to). All numbers come from orders/payments/
  generation_jobs/analytics_events — nothing is estimated. Service role only.
*/
create function public.admin_stats(p_from timestamptz, p_to timestamptz)
returns jsonb language sql stable security definer set search_path = public as $$
  with o as (select * from orders where created_at >= p_from and created_at < p_to),
  pay as (
    select p.* from payments p join o on o.id = p.order_id
  ),
  jobs as (
    select j.* from generation_jobs j join o on o.id = j.order_id
  ),
  views as (
    select count(*) as n from analytics_events
    where event_name = 'template_viewed' and created_at >= p_from and created_at < p_to
  )
  select jsonb_build_object(
    'orders_total',        (select count(*) from o),
    'orders_paid',         (select count(*) from o where payment_status in ('succeeded', 'refunded')),
    'generations_completed', (select count(*) from o where generation_status = 'completed'),
    'generations_failed',  (select count(*) from o where generation_status = 'failed'),
    'revenue_kzt',         (select coalesce(sum(amount_kzt), 0) from pay where status = 'succeeded'),
    'refunds_kzt',         (select coalesce(sum(amount_kzt), 0) from pay where status = 'refunded'),
    'refunds_count',       (select count(*) from pay where status = 'refunded'),
    'avg_generation_sec',  (select round(avg(extract(epoch from (completed_at - started_at))))
                              from jobs where status = 'completed' and started_at is not null),
    'provider_cost',       (select sum(provider_cost) from jobs),
    'template_views',      (select n from views),
    'active_templates',    (select count(*) from templates where status = 'published'),
    'duplicate_charges',   (select count(*) from payments where failure_reason = 'duplicate_charge_refund_required'),
    'top_templates', coalesce((
      select jsonb_agg(t) from (
        select o.template_id as id, max(o.template_snapshot_json->>'title_kk') as title, count(*) as paid
        from o where payment_status in ('succeeded', 'refunded')
        group by o.template_id order by paid desc limit 5
      ) t), '[]'::jsonb),
    'by_quality', coalesce((
      select jsonb_agg(t) from (
        select quality, count(*) as orders,
               count(*) filter (where payment_status in ('succeeded','refunded')) as paid
        from o group by quality order by orders desc
      ) t), '[]'::jsonb)
  );
$$;
revoke execute on function public.admin_stats(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_stats(timestamptz, timestamptz) to service_role;
