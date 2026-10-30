-- "Create → AI photo": a hidden published photo template (Kling image model) for photos made
-- from the customer's own description (no example photo). Price comes from site settings.
alter table templates drop constraint templates_kind_check;
alter table templates add constraint templates_kind_check check (kind = any (array['catalog','custom','custom_photo']));

do $$
declare t_id uuid; v_id uuid;
begin
  if exists (select 1 from templates where kind = 'custom_photo') then return; end if;
  insert into templates (kind, status, published_at, title_kk, description_kk, required_face_count, face_slots_json,
    supported_qualities_json, pricing_config_json, provider_key, provider_config_json, max_upload_bytes)
  values ('custom_photo', 'published', now(), 'Своё AI-фото', 'Фото по вашему описанию', 1,
    '[{"key":"face_1","labelKk":"Ваше фото","position":{"x":0.5,"y":0.42},"providerInput":"img_1","order":0}]'::jsonb,
    '[{"key":"2k","labelKk":"Фото · 2K","resolution":"2k","providerQuality":"2k","surchargeKzt":0,"available":true}]'::jsonb,
    '{"basePriceKzt":990,"chargeExtraFaces":false,"extraFacePriceKzt":0,"includedFaces":1,"platformFeeKzt":0,"minPriceKzt":0}'::jsonb,
    'kling_photo', '{"prompt":"","people":1,"aspectRatio":"3:4","useExample":false,"allowWish":true,"labels":[]}'::jsonb,
    10485760)
  returning id into t_id;
  insert into template_versions (template_id, version_number, configuration_snapshot)
  select id, 1, jsonb_build_object('title_kk', title_kk, 'required_face_count', required_face_count,
    'face_slots_json', face_slots_json, 'supported_qualities_json', supported_qualities_json,
    'pricing_config_json', pricing_config_json, 'provider_key', provider_key, 'provider_config_json', provider_config_json,
    'preview_video_path', null, 'cover_asset_path', null, 'max_upload_bytes', max_upload_bytes)
  from templates where id = t_id returning id into v_id;
  update templates set current_version_id = v_id where id = t_id;
end $$;
