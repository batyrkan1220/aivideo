-- Tole: Kaspi invoice only. Keep just the last 4 phone digits for "invoice sent to ••1234".
alter table payments add column if not exists provider_phone_last4 text check (provider_phone_last4 ~ '^[0-9]{4}$');
comment on column payments.provider_payment_url is 'unused (QR flow removed)';
comment on column payments.provider_qr_token is 'unused (QR flow removed)';
