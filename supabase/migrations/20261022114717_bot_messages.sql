-- Editable Telegram bot texts (admin panel). Missing rows fall back to built-in defaults.
create table if not exists bot_messages (
  key text primary key check (key ~ '^[a-z_]{2,40}$'),
  text text not null check (char_length(text) between 1 and 4000),
  button text check (button is null or char_length(button) between 1 and 64),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table bot_messages enable row level security;
-- no policies: only the service role (server) can read or write.
