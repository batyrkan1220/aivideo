-- Өз видеом: Akool person analysis of the customer's video (who can be replaced).
alter table order_videos add column if not exists analysis_status text
  check (analysis_status in ('processing', 'done', 'failed', 'unavailable'));
alter table order_videos add column if not exists akool_analysis_id text;
alter table order_videos add column if not exists akool_video_url text;   -- exact URL analysed (must be reused)
alter table order_videos add column if not exists akool_people jsonb;     -- [{objId, previewPath?}]
