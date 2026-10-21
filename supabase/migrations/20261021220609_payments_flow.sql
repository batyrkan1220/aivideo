alter table payments add column redirect_url text;
alter table payments add column expires_at timestamptz;
alter table payments add column failure_reason text;
alter table payments add column updated_at timestamptz not null default now();
create trigger t_payments before update on payments for each row execute function touch_updated_at();
create index payments_order_idx on payments(order_id, created_at desc);

-- At most one active generation job per order
create unique index generation_jobs_one_active on generation_jobs(order_id)
  where status in ('queued', 'processing', 'postprocessing');

/*
  Applies a verified provider event to a payment in ONE transaction:
  - locks the payment row, validates amount + currency against what we charged,
  - enforces allowed transitions (no regressions, duplicates are no-ops),
  - mirrors status to the order and enqueues generation only on success.
  Returns: 'applied' | 'noop' | 'amount_mismatch' | 'invalid_transition' | 'not_found'
*/
create function public.apply_payment_event(
  p_provider text, p_provider_payment_id text, p_status payment_status,
  p_amount_kzt int, p_currency text, p_reason text default null
) returns text
language plpgsql security definer set search_path = public as $$
declare
  pay payments%rowtype;
  ord orders%rowtype;
begin
  select * into pay from payments
    where provider = p_provider and provider_payment_id = p_provider_payment_id
    for update;
  if not found then return 'not_found'; end if;

  if pay.status = p_status then return 'noop'; end if;

  if p_status in ('succeeded', 'refunded') and
     (p_amount_kzt is distinct from pay.amount_kzt or p_currency is distinct from pay.currency) then
    update payments set failure_reason = 'amount_mismatch' where id = pay.id;
    return 'amount_mismatch';
  end if;

  if not (
    (pay.status = 'pending'   and p_status in ('succeeded', 'failed', 'cancelled')) or
    (pay.status = 'failed'    and p_status = 'succeeded') or
    (pay.status = 'succeeded' and p_status = 'refunded')
  ) then
    return 'invalid_transition';
  end if;

  update payments set status = p_status,
    verified_at = case when p_status = 'succeeded' then now() else verified_at end,
    failure_reason = p_reason
  where id = pay.id;

  select * into ord from orders where id = pay.order_id for update;

  if p_status = 'succeeded' then
    update orders set payment_status = 'succeeded',
      generation_status = case when generation_status = 'awaiting_payment' then 'queued' else generation_status end
    where id = ord.id;
    insert into generation_jobs (order_id, provider, status)
    select ord.id, coalesce(ord.template_snapshot_json->>'provider_key', 'dev'), 'queued'
    where not exists (
      select 1 from generation_jobs j where j.order_id = ord.id
        and j.status in ('queued', 'processing', 'postprocessing', 'completed')
    );
  elsif p_status = 'refunded' then
    update orders set payment_status = 'refunded' where id = ord.id;
  elsif ord.payment_status <> 'succeeded' then
    update orders set payment_status = p_status where id = ord.id;
  end if;

  return 'applied';
end $$;
revoke execute on function public.apply_payment_event(text, text, payment_status, int, text, text) from public, anon, authenticated;
grant execute on function public.apply_payment_event(text, text, payment_status, int, text, text) to service_role;
