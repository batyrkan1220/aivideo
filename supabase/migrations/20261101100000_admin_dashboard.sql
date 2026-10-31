-- Admin dashboard: money (real vs test vs free), AI spend, daily series, payments funnel,
-- things that need attention, and per-template stats. Read-only, service role only.

create or replace function public.admin_dashboard(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with
  o as (select * from orders where created_at >= p_from and created_at < p_to and parent_order_id is null),
  pay as (select p.* from payments p where p.created_at >= p_from and p.created_at < p_to),
  real_pay as (select * from pay where provider not in ('free', 'sandbox', 'tole_sandbox')),
  jobs as (select * from generation_jobs where created_at >= p_from and created_at < p_to and provider <> 'combo'),
  days as (
    select generate_series(date_trunc('day', p_from at time zone 'Asia/Almaty'),
                           date_trunc('day', (p_to - interval '1 second') at time zone 'Asia/Almaty'),
                           interval '1 day')::date as d
  )
  select jsonb_build_object(
    'orders_total',     (select count(*) from o),
    'orders_paid',      (select count(distinct order_id) from real_pay where status in ('succeeded', 'refunded')),
    'orders_free',      (select count(distinct order_id) from pay where provider = 'free' and status = 'succeeded'),
    'orders_test',      (select count(distinct order_id) from pay where provider in ('sandbox', 'tole_sandbox') and status = 'succeeded'),
    'revenue_kzt',      (select coalesce(sum(amount_kzt), 0) from real_pay where status = 'succeeded'),
    'refunds_kzt',      (select coalesce(sum(amount_kzt), 0) from real_pay where status = 'refunded'),
    'refunds_count',    (select count(*) from real_pay where status = 'refunded'),
    'buyers',           (select count(distinct o2.user_id) from real_pay rp join orders o2 on o2.id = rp.order_id where rp.status = 'succeeded'),
    'new_users',        (select count(*) from profiles where created_at >= p_from and created_at < p_to),
    'template_views',   (select count(*) from analytics_events where event_name = 'template_viewed' and created_at >= p_from and created_at < p_to),
    'gen_completed',    (select count(*) from jobs where status = 'completed'),
    'gen_failed',       (select count(*) from jobs where status = 'failed'),
    'avg_gen_sec',      (select round(avg(extract(epoch from (completed_at - started_at)))) from jobs where status = 'completed' and started_at is not null),
    'cost_usd',         (select coalesce(sum(provider_cost), 0) from jobs),
    'cost_video_usd',   (select coalesce(sum(provider_cost), 0) from jobs where provider <> 'kling_photo'),
    'cost_photo_usd',   (select coalesce(sum(provider_cost), 0) from jobs where provider = 'kling_photo'),
    'cost_free_usd',    (select coalesce(sum(j.provider_cost), 0) from jobs j join orders o3 on o3.id = j.order_id
                           where exists (select 1 from payments fp where fp.order_id = coalesce(o3.parent_order_id, o3.id)
                                         and fp.provider in ('free', 'sandbox', 'tole_sandbox') and fp.status = 'succeeded')),
    'pay_invoices',     (select count(*) from real_pay),
    'pay_succeeded',    (select count(*) from real_pay where status = 'succeeded'),
    'pay_pending',      (select count(*) from real_pay where status = 'pending'),
    'pay_failed',       (select count(*) from real_pay where status in ('failed', 'cancelled')),
    'pay_reasons', coalesce((
      select jsonb_agg(t) from (
        select coalesce(nullif(failure_reason, ''), provider_outcome, status::text) as reason, count(*) as n
        from real_pay where status in ('failed', 'cancelled')
        group by 1 order by n desc limit 6) t), '[]'::jsonb),
    'daily', coalesce((
      select jsonb_agg(t order by t.day) from (
        select days.d as day,
          (select count(*) from o where (o.created_at at time zone 'Asia/Almaty')::date = days.d) as orders,
          (select count(*) from real_pay rp where rp.status = 'succeeded' and (rp.created_at at time zone 'Asia/Almaty')::date = days.d) as paid,
          (select coalesce(sum(amount_kzt), 0) from real_pay rp where rp.status = 'succeeded' and (rp.created_at at time zone 'Asia/Almaty')::date = days.d) as revenue,
          (select coalesce(sum(provider_cost), 0) from jobs j where (j.created_at at time zone 'Asia/Almaty')::date = days.d) as cost_usd
        from days) t), '[]'::jsonb),
    'top_templates', coalesce((
      select jsonb_agg(t) from (
        select o.template_id as id, max(o.template_snapshot_json->>'title_kk') as title,
          count(*) as orders,
          count(*) filter (where exists (select 1 from real_pay rp where rp.order_id = o.id and rp.status = 'succeeded')) as paid,
          coalesce(sum(o.amount_kzt) filter (where exists (select 1 from real_pay rp where rp.order_id = o.id and rp.status = 'succeeded')), 0) as revenue,
          coalesce((select sum(j.provider_cost) from generation_jobs j join orders c on c.id = j.order_id
                     where c.id = any(array_agg(o.id)) or c.parent_order_id = any(array_agg(o.id))), 0) as cost_usd
        from o group by o.template_id order by paid desc, orders desc limit 8) t), '[]'::jsonb),
    -- Needs attention (not limited to the period)
    'attn_paid_failed', coalesce((
      select jsonb_agg(t) from (
        select id, public_order_number as number, amount_kzt, created_at from orders
        where parent_order_id is null and payment_status = 'succeeded' and generation_status = 'failed'
          and exists (select 1 from payments rp where rp.order_id = orders.id and rp.status = 'succeeded'
                      and rp.provider not in ('free', 'sandbox', 'tole_sandbox'))
        order by created_at desc limit 10) t), '[]'::jsonb),
    'attn_stuck', coalesce((
      select jsonb_agg(t) from (
        select o.id, o.public_order_number as number, j.status, j.created_at from generation_jobs j join orders o on o.id = j.order_id
        where j.status in ('queued', 'processing', 'postprocessing') and j.created_at < now() - interval '30 minutes'
        order by j.created_at limit 10) t), '[]'::jsonb),
    'attn_pending_old', (select count(*) from payments where status = 'pending' and provider not in ('free', 'sandbox', 'tole_sandbox')
                           and created_at < now() - interval '2 hours' and created_at > now() - interval '3 days'),
    'attn_duplicates',  (select count(*) from payments where failure_reason = 'duplicate_charge_refund_required')
  );
$$;

revoke all on function public.admin_dashboard(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_dashboard(timestamptz, timestamptz) to service_role;

-- Per-template performance for the templates list (views, orders, paid, revenue in the period).
create or replace function public.admin_template_stats(p_from timestamptz)
returns table (template_id uuid, views bigint, orders bigint, paid bigint, revenue bigint)
language sql
stable
security definer
set search_path to 'public'
as $$
  select t.id,
    (select count(*) from analytics_events e where e.template_id = t.id and e.event_name = 'template_viewed' and e.created_at >= p_from),
    (select count(*) from orders o where o.template_id = t.id and o.parent_order_id is null and o.created_at >= p_from),
    (select count(distinct o.id) from orders o join payments p on p.order_id = o.id
       where o.template_id = t.id and o.created_at >= p_from and p.status = 'succeeded' and p.provider not in ('free', 'sandbox', 'tole_sandbox')),
    (select coalesce(sum(p.amount_kzt), 0)::bigint from orders o join payments p on p.order_id = o.id
       where o.template_id = t.id and o.created_at >= p_from and p.status = 'succeeded' and p.provider not in ('free', 'sandbox', 'tole_sandbox'))
  from templates t where t.deleted_at is null;
$$;

revoke all on function public.admin_template_stats(timestamptz) from public, anon, authenticated;
grant execute on function public.admin_template_stats(timestamptz) to service_role;
