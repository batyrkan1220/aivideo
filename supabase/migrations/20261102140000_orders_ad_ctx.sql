-- Ad attribution captured when the order is placed (click ids, pixel cookies, IP, user agent),
-- used once to report the purchase server-side to TikTok / Meta / GA4.
alter table orders add column if not exists ad_ctx jsonb;
alter table orders add column if not exists pixels_sent_at timestamptz;
