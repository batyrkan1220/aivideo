-- Server-only table: RLS on with no policies → invisible to anon/authenticated,
-- reachable by the service role for pruning.
alter table private.rate_limits set schema public;
alter table public.rate_limits enable row level security;
create index rate_limits_window_idx on public.rate_limits(window_start);
