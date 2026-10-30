-- Photo templates (Kling image model): generated photos are stored next to generated videos.
update storage.buckets
  set allowed_mime_types = array['video/mp4','video/webm','image/jpeg','image/png','image/webp']
  where id = 'generated-videos';
