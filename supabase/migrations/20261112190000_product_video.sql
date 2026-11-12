-- «Видео товара»: the customer uploads a product photo (and optionally a model photo), picks a scene,
-- length and format; Kling 4.0 Omni makes a new video from these reference images (no template video).
alter table templates drop constraint templates_kind_check;
alter table templates add constraint templates_kind_check
  check (kind = any (array['catalog','custom','custom_photo','combo','combo_item','product']));

do $$
declare t_id uuid; v_id uuid;
begin
  if exists (select 1 from templates where kind = 'product') then return; end if;
  insert into templates (kind, status, published_at, title_kk, description_kk, required_face_count, face_slots_json,
    supported_qualities_json, pricing_config_json, provider_key, provider_config_json, max_upload_bytes)
  values ('product', 'published', now(), 'Видео товара', 'Фото товара (+ фото модели) → рекламный ролик', 2,
    '[{"key":"product","labelKk":"Фото товара","position":{"x":0.3,"y":0.5},"providerInput":"product","order":0,"kind":"object"},{"key":"model","labelKk":"Фото модели","position":{"x":0.7,"y":0.42},"providerInput":"model","order":1,"kind":"person"}]'::jsonb,
    '[{"key":"720p","labelKk":"Высокое качество · 720p","resolution":"720p","providerQuality":"720p","surchargeKzt":0,"available":true}]'::jsonb,
    '{"basePriceKzt":1990,"chargeExtraFaces":false,"extraFacePriceKzt":0,"includedFaces":2,"platformFeeKzt":0,"minPriceKzt":0}'::jsonb,
    'kling_product', '{"aspectRatio":"9:16","withModel":true,"scene":"hands"}'::jsonb,
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

insert into site_settings (key, value)
values ('product_video', jsonb_build_object('enabled', true, 'price5Kzt', 1990, 'price10Kzt', 2990))
on conflict (key) do nothing;
