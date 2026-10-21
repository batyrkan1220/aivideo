-- Payment state machine: amount checks, idempotency, no regressions, double-charge guard.
create function pg_temp.eq(got text, want text, what text) returns void language plpgsql as $$
begin if got is distinct from want then raise exception 'FAIL %: got %, want %', what, got, want; end if;
raise notice 'ok  %', what; end $$;

insert into auth.users(id, email) values ('aaaaaaaa-0000-0000-0000-000000000001', 'u@test.kz');
insert into templates(id, title_kk, required_face_count, status) values ('bbbbbbbb-0000-0000-0000-000000000001', 'T', 1, 'published');
insert into template_versions(id, template_id, version_number, configuration_snapshot)
  values ('cccccccc-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 1, '{}');
insert into orders(id, user_id, template_id, template_version_id, template_snapshot_json, quality, face_count, pricing_breakdown_json, amount_kzt, consent_accepted_at)
  values ('dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
          'cccccccc-0000-0000-0000-000000000001', '{"provider_key":"dev"}', 'standard', 1, '{}', 2990, now());
insert into payments(order_id, provider, provider_payment_id, amount_kzt, status, idempotency_key) values
  ('dddddddd-0000-0000-0000-000000000001', 'sandbox', 'p1', 2990, 'pending', 'k1'),
  ('dddddddd-0000-0000-0000-000000000001', 'sandbox', 'p2', 2990, 'pending', 'k2');

select pg_temp.eq(apply_payment_event('sandbox', 'p1', 'succeeded', 1, 'KZT'), 'amount_mismatch', 'wrong amount rejected');
select pg_temp.eq(apply_payment_event('sandbox', 'p1', 'succeeded', 2990, 'USD'), 'amount_mismatch', 'wrong currency rejected');
select pg_temp.eq(apply_payment_event('sandbox', 'nope', 'succeeded', 2990, 'KZT'), 'not_found', 'unknown payment');
select pg_temp.eq((select count(*)::text from generation_jobs), '0', 'no generation before payment');
select pg_temp.eq(apply_payment_event('sandbox', 'p1', 'succeeded', 2990, 'KZT'), 'applied', 'success applied');
select pg_temp.eq(apply_payment_event('sandbox', 'p1', 'succeeded', 2990, 'KZT'), 'noop', 'duplicate success is noop');
select pg_temp.eq(apply_payment_event('sandbox', 'p1', 'failed', 2990, 'KZT'), 'invalid_transition', 'late failure ignored');
select pg_temp.eq((select payment_status || '/' || generation_status from orders), 'succeeded/queued', 'order paid and queued');
select pg_temp.eq((select count(*)::text from generation_jobs), '1', 'exactly one job enqueued');
select pg_temp.eq(apply_payment_event('sandbox', 'p2', 'succeeded', 2990, 'KZT'), 'duplicate_charge', 'second charge flagged');
select pg_temp.eq((select failure_reason from payments where provider_payment_id = 'p2'), 'duplicate_charge_refund_required', 'flag stored');
select pg_temp.eq(apply_payment_event('sandbox', 'p1', 'refunded', 2990, 'KZT'), 'applied', 'refund applied');
select pg_temp.eq((select payment_status::text from orders), 'refunded', 'order refunded');

insert into webhook_events(provider, event_id, event_type) values ('sandbox', 'e1', 'x');
do $$ begin
  insert into webhook_events(provider, event_id, event_type) values ('sandbox', 'e1', 'x');
  raise exception 'FAIL webhook replay accepted';
exception when unique_violation then raise notice 'ok  webhook replay rejected';
end $$;
