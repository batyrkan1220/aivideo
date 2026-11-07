-- AI calls besides Kling (Gemini analysis): tokens and estimated cost; server only (service role).
create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  service text not null,
  model text not null default '',
  purpose text not null default '',
  ok boolean not null default true,
  http_status int,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cost_usd numeric(12,6) not null default 0
);
create index if not exists ai_usage_service_time on public.ai_usage (service, created_at desc);
alter table public.ai_usage enable row level security;
