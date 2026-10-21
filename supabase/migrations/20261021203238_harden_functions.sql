-- Trigger-only function: nobody should call it via the REST API
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- RLS helper: move out of the API-exposed schema (policies follow the function by OID)
create schema if not exists private;
grant usage on schema private to anon, authenticated;
alter function public.is_staff(user_role[]) set schema private;
revoke execute on function private.is_staff(user_role[]) from public;
grant execute on function private.is_staff(user_role[]) to anon, authenticated;

-- Pin search_path
alter function public.touch_updated_at() set search_path = public;
