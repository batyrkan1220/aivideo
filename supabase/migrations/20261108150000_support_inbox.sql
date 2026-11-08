-- Support inbox in the admin panel: one thread per customer Telegram chat, every message kept
-- (text / caption and the Telegram file id of a photo, video, file or voice; files stay on Telegram).
create table if not exists public.support_threads (
  id uuid primary key default gen_random_uuid(),
  chat_id bigint not null unique,
  telegram_user_id bigint,
  user_id uuid references public.profiles(id) on delete set null,
  name text,
  username text,
  status text not null default 'open' check (status in ('open', 'closed')),
  unread int not null default 0,
  last_message_at timestamptz not null default now(),
  last_preview text,
  created_at timestamptz not null default now()
);
create index if not exists support_threads_recent on public.support_threads (status, last_message_at desc);

create table if not exists public.support_entries (
  id bigint generated always as identity primary key,
  thread_id uuid not null references public.support_threads(id) on delete cascade,
  direction text not null check (direction in ('in', 'out')),
  text text,
  media_type text check (media_type in ('photo', 'video', 'document', 'voice', 'audio', 'animation', 'sticker', 'video_note')),
  file_id text,
  author text,
  created_at timestamptz not null default now()
);
create index if not exists support_entries_thread on public.support_entries (thread_id, created_at);

alter table public.support_threads enable row level security;
alter table public.support_entries enable row level security;
-- No policies: only the server (service role) reads and writes.
