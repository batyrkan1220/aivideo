-- Payouts recorded by the Teliks cabinet through the partner API (idempotent by its request id).
alter table partner_payouts add column if not exists external_ref text unique;
-- TrendMe no longer keeps Teliks account data; only an opaque external id for idempotent sign-up.
update partners set teliks_email = null where teliks_email is not null;
