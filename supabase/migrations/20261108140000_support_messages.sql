-- Support chat through the Telegram bot: which admin-side message belongs to which customer chat,
-- so an admin's Telegram "Reply" reaches the right customer.
create table if not exists public.support_messages (
  id bigint generated always as identity primary key,
  user_chat_id bigint not null,
  admin_chat_id bigint not null,
  admin_message_id bigint not null,
  direction text not null check (direction in ('in','out')),
  created_at timestamptz not null default now()
);
create unique index if not exists support_messages_admin_msg on public.support_messages (admin_chat_id, admin_message_id);
create index if not exists support_messages_user on public.support_messages (user_chat_id, created_at desc);
alter table public.support_messages enable row level security;
-- No policies: only the server (service role) reads and writes.
