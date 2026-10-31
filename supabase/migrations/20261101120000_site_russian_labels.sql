-- Customer side switched to Russian: stored slot/quality labels and the custom templates' titles.
create or replace function public.tmp_ru_labels(j jsonb) returns jsonb language sql immutable as $$
  select regexp_replace(
    replace(replace(replace(replace(replace(replace(j::text,
      'Шаблон фото + сіздің фотоңыз', 'Фото-шаблон + ваше фото'),
      'Сіздің фотоңыз', 'Ваше фото'),
      '"Шаблон фото"', '"Фото-шаблон"'),
      'Жоғары сапа · 720p', 'Высокое качество · 720p'),
      'Өз видеоңызды жүктеңіз', 'Загрузите своё видео'),
      'Бет фотосын жүктеңіз', 'Загрузите фото лица'),
    '(\d)-адам \(сол жақтан\)', '\1-й человек (слева)', 'g')::jsonb
$$;
update public.templates set face_slots_json = public.tmp_ru_labels(face_slots_json), supported_qualities_json = public.tmp_ru_labels(supported_qualities_json),
  title_kk = case title_kk when 'Өз видеом' then 'Своё видео' when 'Өз фотом' then 'Своё фото' else title_kk end,
  description_kk = case description_kk when 'Өз видеоңызды жүктеңіз' then 'Загрузите своё видео' when 'Шаблон фото + сіздің фотоңыз' then 'Фото-шаблон + ваше фото' else description_kk end;
update public.template_versions set configuration_snapshot = public.tmp_ru_labels(configuration_snapshot);
update public.orders set template_snapshot_json = public.tmp_ru_labels(template_snapshot_json);
drop function public.tmp_ru_labels(jsonb);
