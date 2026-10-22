-- Automatic Akool pricing: price = video seconds × credits/sec (by resolution) × tenge per credit × markup.
alter table templates add column if not exists video_duration_sec numeric(6,2);
alter table generation_jobs add column if not exists provider_credits int;

insert into site_settings (key, value)
values ('akool_pricing', jsonb_build_object(
  'tengePerCredit', 25, 'markupPercent', 100, 'minPriceKzt', 990, 'roundToKzt', 10,
  'creditsPerSec', jsonb_build_object('480p', 1, '720p', 2)))
on conflict (key) do nothing;
