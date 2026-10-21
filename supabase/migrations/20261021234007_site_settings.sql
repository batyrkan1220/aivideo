-- Admin-editable site settings (e.g. homepage showcase). Server-only: RLS on, no policies.
create table public.site_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.site_settings enable row level security;
