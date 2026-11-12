-- Автомонтаж: the customer uploads several clips, the server cuts the best moments into one 9:16 video.
create table if not exists public.montages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'queued', 'processing', 'completed', 'failed')),
  clips jsonb not null default '[]'::jsonb,       -- [{ path, size, durationSec }] in user-videos
  music_path text,                                -- optional customer track in user-videos
  options jsonb not null default '{}'::jsonb,     -- { style, length, sound, title }
  output_path text,                               -- generated-videos
  output_duration_sec numeric,
  error_code text,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz
);
create index if not exists montages_user_idx on public.montages (user_id, created_at desc);
create index if not exists montages_status_idx on public.montages (status) where status in ('queued', 'processing');
alter table public.montages enable row level security;
create policy "montages: owner reads" on public.montages for select using (auth.uid() = user_id);

-- The customer's own track for a montage goes into user-videos too.
update storage.buckets set allowed_mime_types = array['video/mp4','video/quicktime','audio/mpeg','audio/mp4','audio/x-m4a','audio/aac','audio/wav','audio/x-wav']
where id = 'user-videos';
