-- Teliks moved to its own Supabase project ("Affiliate"). TrendMe keeps only its own data;
-- the partner program (partners, partner_* and the partner API) stays here.
drop function if exists public.tk_cpa_click_rows(uuid, timestamptz, timestamptz);
drop function if exists public.tk_cpa_daily(timestamptz, timestamptz);
drop function if exists public.tk_cpa_balances(uuid);
drop function if exists public.tk_cpa_cap_used(text, timestamptz);
drop function if exists public.tk_cpa_release_holds();
drop table if exists public.tk_postback_log, public.tk_conversions, public.tk_clicks, public.tk_offer_access,
  public.tk_offers, public.tk_advertisers, public.tk_payout_requests, public.tk_partners;
-- The empty "offer-media" bucket is removed in the dashboard (Storage tables can't be edited with SQL).
