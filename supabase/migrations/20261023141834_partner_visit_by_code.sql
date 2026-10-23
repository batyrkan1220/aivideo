-- Records a link open by partner code (used by the website proxy on first ?ref= visit).
create or replace function public.partner_visit(p_code text, p_source text)
returns void language sql security definer set search_path = public as $$
  insert into partner_visits (partner_id, source)
  select id, p_source from partners where code = lower(p_code) and active and p_source in ('bot', 'app', 'site');
$$;
revoke execute on function public.partner_visit(text, text) from public, anon, authenticated;
grant execute on function public.partner_visit(text, text) to service_role;
