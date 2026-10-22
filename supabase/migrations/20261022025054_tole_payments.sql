-- Tole Payments (Kaspi QR): persist Tole's identifiers and pending-command state.
alter table payments add column if not exists provider_command_id text;
alter table payments add column if not exists provider_operation_id text;
alter table payments add column if not exists provider_outcome text
  check (provider_outcome in ('in_progress', 'outcome_unknown', 'timeout'));
-- Shown only to the payment's owner on the checkout page; never logged.
alter table payments add column if not exists provider_payment_url text;
alter table payments add column if not exists provider_qr_token text;
create index if not exists payments_provider_command_idx on payments(provider, provider_command_id)
  where provider_command_id is not null;
comment on column payments.provider_outcome is 'Non-final create outcome: reconciled via GET /commands, never re-created';
