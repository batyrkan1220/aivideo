-- Deleting an account removes personal data (profile, photos, videos) but keeps
-- anonymised orders/payments for accounting and dispute handling.
alter table orders alter column user_id drop not null;
alter table orders drop constraint orders_user_id_fkey;
alter table orders add constraint orders_user_id_fkey
  foreign key (user_id) references profiles(id) on delete set null;

-- Photos deleted by the user (or by retention) — keep the fact, not the file.
alter table orders add column photos_deleted_at timestamptz;
