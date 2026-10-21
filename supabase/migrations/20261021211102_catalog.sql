-- Catalog curation fields
alter table templates add column is_trending boolean not null default false;
alter table templates add column sort_order int not null default 0;
alter table templates add column tags text[] not null default '{}';
alter table templates add column published_at timestamptz;
create index templates_published_idx on templates(status, published_at desc);
create index templates_trending_idx on templates(status, is_trending, sort_order);

-- Real popularity: count of successfully paid orders per published template.
-- Callable only by the server (service_role), returns aggregates only.
create function public.popular_template_ids(days int default 30, max_rows int default 12)
returns table (template_id uuid, paid_orders bigint)
language sql stable security definer set search_path = public as $$
  select o.template_id, count(*) as paid_orders
  from orders o join templates t on t.id = o.template_id
  where o.payment_status = 'succeeded'
    and o.created_at > now() - make_interval(days => days)
    and t.status = 'published'
  group by o.template_id
  order by paid_orders desc
  limit max_rows;
$$;
revoke execute on function public.popular_template_ids(int, int) from public, anon, authenticated;
grant execute on function public.popular_template_ids(int, int) to service_role;

-- Starter categories (admins can edit later)
insert into categories (title_kk, slug, sort_order) values
  ('Би', 'dance', 10),
  ('Мерекелік', 'holiday', 20),
  ('Әзіл', 'funny', 30),
  ('Кино', 'movie', 40),
  ('Отбасы', 'family', 50),
  ('Достар', 'friends', 60)
on conflict (slug) do nothing;
