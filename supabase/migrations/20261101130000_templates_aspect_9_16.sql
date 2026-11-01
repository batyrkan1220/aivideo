-- "Как у видео шаблона" was always sent to Kling as 9:16; show it as 9:16 in the editor.
update public.templates
set provider_config_json = jsonb_set(provider_config_json, '{aspectRatio}', '"9:16"')
where provider_key = 'seedance' and coalesce(provider_config_json->>'aspectRatio', 'adaptive') = 'adaptive';
