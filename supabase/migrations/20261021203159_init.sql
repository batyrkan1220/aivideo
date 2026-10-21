-- 0001_init.sql — core schema for the AI trend video platform
-- Relationships:
--   profiles 1—1 auth.users
--   templates N—1 categories; template_versions N—1 templates
--   orders N—1 profiles, templates, template_versions
--   order_assets, payments, generation_jobs, generated_videos N—1 orders

create extension if not exists pgcrypto;

-- ---------- enums ----------
create type user_role as enum ('user', 'super_admin', 'template_manager', 'order_support');
create type template_status as enum ('draft', 'published', 'disabled', 'archived');
create type payment_status as enum ('pending', 'succeeded', 'failed', 'cancelled', 'refunded');
create type generation_status as enum (
  'awaiting_payment', 'queued', 'processing', 'postprocessing', 'completed', 'failed', 'cancelled'
);

-- ---------- profiles ----------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  phone text,
  email text,
  role user_role not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- auto-create a profile on signup (role is always 'user'; admins are promoted manually)
create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, phone, display_name)
  values (new.id, new.email, new.phone, nullif(new.raw_user_meta_data->>'display_name', ''));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

create function is_staff(roles user_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = any(roles));
$$;

-- ---------- categories ----------
create table categories (
  id uuid primary key default gen_random_uuid(),
  title_kk text not null,
  slug text not null unique,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- templates ----------
create table templates (
  id uuid primary key default gen_random_uuid(),
  title_kk text not null,
  description_kk text not null default '',
  category_id uuid references categories(id) on delete set null,
  cover_asset_path text,
  preview_video_path text,
  required_face_count int not null check (required_face_count between 1 and 10),
  face_slots_json jsonb not null default '[]',
  supported_qualities_json jsonb not null default '[]',
  provider_key text,
  provider_config_json jsonb not null default '{}',
  pricing_config_json jsonb not null default '{}',
  max_upload_bytes int not null default 10485760,
  status template_status not null default 'draft',
  current_version_id uuid,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index templates_status_idx on templates(status);
create index templates_category_idx on templates(category_id);

create table template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references templates(id) on delete cascade,
  version_number int not null,
  configuration_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique (template_id, version_number)
);
alter table templates add constraint templates_current_version_fk
  foreign key (current_version_id) references template_versions(id);

-- ---------- orders ----------
create sequence order_number_seq start 100001;

create table orders (
  id uuid primary key default gen_random_uuid(),
  public_order_number text not null unique
    default ('TV-' || nextval('order_number_seq')::text),
  user_id uuid not null references profiles(id) on delete cascade,
  template_id uuid not null references templates(id),
  template_version_id uuid not null references template_versions(id),
  template_snapshot_json jsonb not null,
  quality text not null,
  face_count int not null,
  pricing_breakdown_json jsonb not null,
  amount_kzt int not null check (amount_kzt >= 0),
  currency text not null default 'KZT' check (currency = 'KZT'),
  consent_accepted_at timestamptz not null,
  payment_status payment_status not null default 'pending',
  generation_status generation_status not null default 'awaiting_payment',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index orders_user_idx on orders(user_id, created_at desc);
create index orders_status_idx on orders(payment_status, generation_status);

-- uploads are created before the order exists (draft), then attached
create table order_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  order_id uuid references orders(id) on delete cascade,
  template_id uuid not null references templates(id),
  face_slot_key text not null,
  original_filename text,
  private_storage_path text not null unique,
  mime_type text not null,
  file_size int not null,
  width int,
  height int,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create unique index order_assets_slot_uniq on order_assets(order_id, face_slot_key)
  where order_id is not null;
create index order_assets_expiry_idx on order_assets(expires_at);

create table payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  provider text not null,
  provider_payment_id text,
  amount_kzt int not null,
  currency text not null default 'KZT',
  status payment_status not null default 'pending',
  idempotency_key text not null unique,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, provider_payment_id)
);
-- at most one succeeded payment per order
create unique index payments_one_success on payments(order_id) where status = 'succeeded';

create table generation_jobs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  provider text not null,
  provider_job_id text,
  status generation_status not null default 'queued',
  attempt_count int not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  progress int check (progress between 0 and 100),
  provider_cost numeric(12,4),
  error_code text,
  safe_error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_job_id)
);
create index generation_jobs_queue_idx on generation_jobs(status, next_attempt_at);

create table generated_videos (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references orders(id) on delete cascade,
  private_storage_path text not null,
  duration_seconds numeric(8,2),
  file_size bigint,
  resolution text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references profiles(id) on delete set null,
  action text not null,
  resource_type text not null,
  resource_id text,
  metadata_json jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_logs_resource_idx on audit_logs(resource_type, resource_id);

create table webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  event_type text not null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, event_id)
);

create table analytics_events (
  id bigint generated always as identity primary key,
  event_name text not null,
  user_id uuid references profiles(id) on delete set null,
  template_id uuid references templates(id) on delete set null,
  order_id uuid references orders(id) on delete set null,
  properties jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index analytics_events_name_time_idx on analytics_events(event_name, created_at);

-- ---------- updated_at ----------
create function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger t_profiles before update on profiles for each row execute function touch_updated_at();
create trigger t_templates before update on templates for each row execute function touch_updated_at();
create trigger t_orders before update on orders for each row execute function touch_updated_at();
create trigger t_jobs before update on generation_jobs for each row execute function touch_updated_at();

-- ---------- RLS ----------
-- Writes to orders/payments/jobs/videos happen only on the server with the service role.
alter table profiles enable row level security;
alter table categories enable row level security;
alter table templates enable row level security;
alter table template_versions enable row level security;
alter table orders enable row level security;
alter table order_assets enable row level security;
alter table payments enable row level security;
alter table generation_jobs enable row level security;
alter table generated_videos enable row level security;
alter table audit_logs enable row level security;
alter table webhook_events enable row level security;
alter table analytics_events enable row level security;

create policy profiles_self_read on profiles for select using (id = auth.uid());
create policy profiles_self_update on profiles for update using (id = auth.uid())
  with check (id = auth.uid() and role = (select role from profiles where id = auth.uid()));
create policy profiles_admin_read on profiles for select
  using (is_staff(array['super_admin','order_support']::user_role[]));

create policy categories_public_read on categories for select using (is_active);
create policy templates_public_read on templates for select using (status = 'published');
create policy templates_staff_read on templates for select
  using (is_staff(array['super_admin','template_manager']::user_role[]));

create policy orders_owner_read on orders for select using (user_id = auth.uid());
create policy orders_staff_read on orders for select
  using (is_staff(array['super_admin','order_support']::user_role[]));
create policy assets_owner_read on order_assets for select using (user_id = auth.uid());
create policy payments_owner_read on payments for select
  using (exists (select 1 from orders o where o.id = order_id and o.user_id = auth.uid()));
create policy jobs_owner_read on generation_jobs for select
  using (exists (select 1 from orders o where o.id = order_id and o.user_id = auth.uid()));
create policy videos_owner_read on generated_videos for select
  using (exists (select 1 from orders o where o.id = order_id and o.user_id = auth.uid()));
create policy audit_admin_read on audit_logs for select
  using (is_staff(array['super_admin']::user_role[]));

-- ---------- storage buckets (all private except public catalog media) ----------
insert into storage.buckets (id, name, public) values
  ('template-media', 'template-media', true),
  ('user-uploads', 'user-uploads', false),
  ('generated-videos', 'generated-videos', false)
on conflict (id) do nothing;
