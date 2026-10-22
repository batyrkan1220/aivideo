-- "Өз видеом": customers upload their own video + face photo (Akool auto mode, one person).

-- Hidden template that carries slot/pricing/provider config for custom orders.
alter table templates add column if not exists kind text not null default 'catalog'
  check (kind in ('catalog', 'custom'));
create index if not exists templates_kind_idx on templates(kind);

-- Customer videos (private). Verified server-side (container + duration) before use.
create table if not exists order_videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid references orders(id) on delete set null,
  storage_path text not null unique,
  mime_type text,
  file_size bigint,
  duration_sec numeric(6,2),
  verified_at timestamptz,
  expires_at timestamptz not null default now() + interval '30 days',
  created_at timestamptz not null default now()
);
create index if not exists order_videos_user_idx on order_videos(user_id, created_at desc);
create index if not exists order_videos_order_idx on order_videos(order_id);
alter table order_videos enable row level security;
-- no policies: only the service role (server) can read or write.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('user-videos', 'user-videos', false, 52428800, array['video/mp4', 'video/quicktime'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Seed the custom template (published but never listed in the catalog).
do $$
declare t_id uuid; v_id uuid; snap jsonb;
begin
  select id into t_id from templates where kind = 'custom' limit 1;
  if t_id is not null then return; end if;
  snap := jsonb_build_object(
    'title_kk', 'Өз видеом',
    'provider_key', 'akool',
    'required_face_count', 1,
    'face_slots_json', jsonb_build_array(jsonb_build_object(
      'key', 'face_1', 'order', 0, 'labelKk', 'Бет фотосы',
      'position', jsonb_build_object('x', 0.5, 'y', 0.42), 'providerInput', 'face_1')),
    'supported_qualities_json', jsonb_build_array(jsonb_build_object(
      'key', 'standard', 'labelKk', 'Стандарт', 'available', true, 'resolution', '720x1280',
      'fps', 30, 'surchargeKzt', 0, 'providerQuality', 'standard')),
    'pricing_config_json', jsonb_build_object('basePriceKzt', 2990, 'minPriceKzt', 0, 'includedFaces', 1,
      'platformFeeKzt', 0, 'chargeExtraFaces', false, 'extraFacePriceKzt', 0),
    'provider_config_json', jsonb_build_object('resolution', '720p', 'selected', jsonb_build_array()),
    'max_upload_bytes', 10485760,
    'preview_video_path', null
  );
  insert into templates (title_kk, description_kk, required_face_count, face_slots_json, supported_qualities_json,
    provider_key, provider_config_json, pricing_config_json, status, kind)
  values ('Өз видеом', 'Өз видеоңызды жүктеңіз', 1, snap->'face_slots_json', snap->'supported_qualities_json',
    'akool', snap->'provider_config_json', snap->'pricing_config_json', 'published', 'custom')
  returning id into t_id;
  insert into template_versions (template_id, version_number, configuration_snapshot)
  values (t_id, 1, snap) returning id into v_id;
  update templates set current_version_id = v_id where id = t_id;
end $$;

insert into site_settings (key, value)
values ('custom_video', jsonb_build_object('enabled', true, 'priceKzt', 2990, 'maxSeconds', 20, 'maxMb', 50))
on conflict (key) do nothing;
