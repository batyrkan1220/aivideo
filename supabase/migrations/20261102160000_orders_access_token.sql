-- Private link to an order (sent in the Kaspi invoice comment): guests without Telegram can reopen it.
alter table orders add column if not exists access_token text;
create unique index if not exists orders_access_token_key on orders(access_token) where access_token is not null;
