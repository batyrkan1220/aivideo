-- Telegram profile photo shown on the account page.
alter table public.profiles add column if not exists avatar_path text;
alter table public.profiles add column if not exists avatar_checked_at timestamptz;

-- Public bucket, files under an unguessable name per user; only the server writes (service role).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/jpeg','image/webp','image/png'])
on conflict (id) do nothing;
