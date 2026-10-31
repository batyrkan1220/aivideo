-- Create → AI photo: the customer uploads an example (reference) photo + their own photo.
-- Slot "ref" (providerInput "example") is the example; "face_1" is the person. Prompt is optional.
do $$
declare t record; v_id uuid; last int;
  slots jsonb := '[{"key":"ref","labelKk":"Шаблон фото","position":{"x":0.3,"y":0.42},"providerInput":"example","order":0},{"key":"face_1","labelKk":"Сіздің фотоңыз","position":{"x":0.7,"y":0.42},"providerInput":"img_1","order":1}]';
begin
  for t in select * from templates where kind = 'custom_photo' loop
    update templates set face_slots_json = slots, required_face_count = 2,
      title_kk = 'Өз фотом', description_kk = 'Шаблон фото + сіздің фотоңыз',
      provider_config_json = provider_config_json || '{"useExample": false, "allowWish": true}'::jsonb
      where id = t.id;
    select coalesce(max(version_number), 0) into last from template_versions where template_id = t.id;
    insert into template_versions (template_id, version_number, configuration_snapshot)
    select id, last + 1, jsonb_build_object('title_kk', title_kk, 'required_face_count', required_face_count,
      'face_slots_json', face_slots_json, 'supported_qualities_json', supported_qualities_json,
      'pricing_config_json', pricing_config_json, 'provider_key', provider_key, 'provider_config_json', provider_config_json,
      'preview_video_path', null, 'cover_asset_path', null, 'max_upload_bytes', max_upload_bytes)
    from templates where id = t.id returning id into v_id;
    update templates set current_version_id = v_id where id = t.id;
  end loop;
end $$;
