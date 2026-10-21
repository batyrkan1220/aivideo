-- Minimal stand-ins for Supabase-managed schemas so migrations run on plain Postgres.
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists vault;
create schema if not exists cron;
create schema if not exists extensions;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, phone text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create view vault.decrypted_secrets as select null::text as name, null::text as decrypted_secret where false;
create function cron.schedule(text, text, text) returns bigint language sql as $$ select 1::bigint $$;
