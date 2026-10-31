-- Photo combos: one selfie → many photos. A combo is a template (kind 'combo', provider 'combo')
-- listing photo templates; after payment the worker opens one child order per photo template.
alter table templates drop constraint templates_kind_check;
alter table templates add constraint templates_kind_check check (kind = any (array['catalog','custom','custom_photo','combo']));

alter table orders add column if not exists parent_order_id uuid references orders(id) on delete cascade;
create index if not exists orders_parent_idx on orders(parent_order_id) where parent_order_id is not null;

-- Admin stats count the combo once (its child orders are free parts of the paid parent).
do $$
declare def text;
begin
  def := pg_get_functiondef('public.admin_stats(timestamptz,timestamptz)'::regprocedure);
  def := replace(def, 'with o as (select * from orders where created_at >= p_from and created_at < p_to)',
                      'with o as (select * from orders where created_at >= p_from and created_at < p_to and parent_order_id is null)');
  execute def;
end $$;
