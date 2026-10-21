create function pg_temp.eq(got text, want text, what text) returns void language plpgsql as $$
begin if got is distinct from want then raise exception 'FAIL %: got %, want %', what, got, want; end if;
raise notice 'ok  %', what; end $$;

-- Queue: lock contention and dead-worker recovery
delete from generation_jobs;
insert into generation_jobs(order_id, provider, status) values ('dddddddd-0000-0000-0000-000000000001', 'dev', 'queued');
select pg_temp.eq((select count(*)::text from claim_generation_jobs('A', 5)), '1', 'worker A claims');
select pg_temp.eq((select count(*)::text from claim_generation_jobs('B', 5)), '0', 'worker B blocked by lock');
update generation_jobs set locked_at = now() - interval '6 minutes';
select pg_temp.eq((select count(*)::text from claim_generation_jobs('C', 5)), '1', 'dead lock reclaimed');

-- Rate limiter
select pg_temp.eq((select string_agg(hit_rate_limit('t:1', 2, 60)::text, ',') from generate_series(1, 3)), 'true,true,false', 'limiter blocks 3rd hit');

-- RLS: users see only their own orders and cannot escalate their role
insert into auth.users(id, email) values ('aaaaaaaa-0000-0000-0000-000000000002', 'other@test.kz');
grant usage on schema public, private to authenticated;
grant select, update on all tables in schema public to authenticated;
grant execute on all functions in schema private to authenticated;
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000002';
select pg_temp.eq((select count(*)::text from orders), '0', 'other user sees no foreign orders');
select pg_temp.eq((select count(*)::text from payments), '0', 'other user sees no foreign payments');
do $$ begin
  update profiles set role = 'super_admin' where id = 'aaaaaaaa-0000-0000-0000-000000000002';
  raise exception 'FAIL role escalation allowed';
exception when insufficient_privilege or check_violation then raise notice 'ok  role escalation blocked';
end $$;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select pg_temp.eq((select count(*)::text from orders), '1', 'owner sees own order');
reset role;

-- Account deletion keeps anonymised financial records
delete from auth.users where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select pg_temp.eq((select count(*)::text from orders where user_id is null), '1', 'order kept, anonymised');
select pg_temp.eq((select count(*)::text from payments), '2', 'payments kept');
