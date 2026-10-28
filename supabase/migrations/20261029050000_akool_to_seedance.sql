-- AI provider switch: Akool Character Swap → Seedance 2.5 Omni Reference (muapi, Intl, 720p).
-- Every template becomes a Seedance template (one 720p quality, one slot per person, left → right)
-- and gets a new published version, so new orders use Seedance. Pricing settings move to
-- site_settings.seedance_pricing (the Akool credit settings are removed).
do $$
declare t record; n int; slots jsonb; cfg jsonb; v_id uuid; last int;
begin
  for t in select * from templates where provider_key is distinct from 'seedance' loop
    n := greatest(1, least(5, coalesce(jsonb_array_length(case when jsonb_typeof(t.provider_config_json->'selected') = 'array' then t.provider_config_json->'selected' end), 0), t.required_face_count));
    select jsonb_agg(jsonb_build_object(
      'key', 'face_' || i,
      'labelKk', case when n = 1 then 'Сіздің фотоңыз' else i || '-адам (сол жақтан)' end,
      'position', jsonb_build_object('x', round(i::numeric / (n + 1), 4), 'y', 0.42),
      'providerInput', 'img_' || i,
      'order', i - 1) order by i)
      into slots from generate_series(1, n) i;
    cfg := jsonb_build_object('people', n, 'framing', coalesce(t.provider_config_json->>'framing', 'half'),
      'aspectRatio', 'adaptive', 'prompt', '', 'allowWish', true);
    update templates set provider_key = 'seedance', provider_config_json = cfg,
      supported_qualities_json = '[{"key":"720p","labelKk":"Жоғары сапа · 720p","resolution":"720p","providerQuality":"720p","surchargeKzt":0,"available":true}]'::jsonb,
      face_slots_json = slots, required_face_count = n,
      pricing_config_json = jsonb_set(coalesce(pricing_config_json, '{}'::jsonb), '{chargeExtraFaces}', 'false'::jsonb)
      where id = t.id;
    if t.status = 'published' then
      select coalesce(max(version_number), 0) into last from template_versions where template_id = t.id;
      insert into template_versions (template_id, version_number, configuration_snapshot)
      select id, last + 1, jsonb_build_object(
        'title_kk', title_kk, 'required_face_count', required_face_count, 'face_slots_json', face_slots_json,
        'supported_qualities_json', supported_qualities_json, 'pricing_config_json', pricing_config_json,
        'provider_key', provider_key, 'provider_config_json', provider_config_json,
        'preview_video_path', preview_video_path, 'max_upload_bytes', max_upload_bytes)
      from templates where id = t.id returning id into v_id;
      update templates set current_version_id = v_id where id = t.id;
    end if;
  end loop;
end $$;

insert into site_settings (key, value)
values ('seedance_pricing', '{"usdPerSec":0.374,"refFactor":0.65,"tengePerUsd":451,"markupPercent":150,"minPriceKzt":1990,"roundToKzt":10}'::jsonb)
on conflict (key) do nothing;
delete from site_settings where key = 'akool_pricing';
