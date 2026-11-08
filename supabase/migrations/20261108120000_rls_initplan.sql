-- RLS: evaluate auth.uid() once per query, not once per row (Supabase advisor "auth_rls_initplan").
-- Same rules as before; only (select auth.uid()) instead of auth.uid().
alter policy profiles_self_read on public.profiles using (id = (select auth.uid()));
alter policy profiles_self_update on public.profiles
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()) and role = (select p.role from public.profiles p where p.id = (select auth.uid())));
alter policy orders_owner_read on public.orders using (user_id = (select auth.uid()));
alter policy assets_owner_read on public.order_assets using (user_id = (select auth.uid()));
alter policy payments_owner_read on public.payments
  using (exists (select 1 from public.orders o where o.id = payments.order_id and o.user_id = (select auth.uid())));
alter policy jobs_owner_read on public.generation_jobs
  using (exists (select 1 from public.orders o where o.id = generation_jobs.order_id and o.user_id = (select auth.uid())));
alter policy videos_owner_read on public.generated_videos
  using (exists (select 1 from public.orders o where o.id = generated_videos.order_id and o.user_id = (select auth.uid())));
