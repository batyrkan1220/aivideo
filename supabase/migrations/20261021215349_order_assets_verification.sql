-- A draft upload becomes usable only after the server re-checks the stored file.
alter table order_assets add column verified_at timestamptz;
create index order_assets_user_draft_idx on order_assets(user_id, created_at) where order_id is null;

-- Orders: cheap lookups for the owner's history and admin search
create index if not exists orders_template_idx on orders(template_id, created_at desc);
