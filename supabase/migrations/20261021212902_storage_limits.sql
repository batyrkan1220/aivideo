-- Enforce type/size limits at the storage layer (also applies to signed uploads)
update storage.buckets set file_size_limit = 52428800,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','video/mp4','video/webm']
  where id = 'template-media';
update storage.buckets set file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg','image/png','image/webp']
  where id = 'user-uploads';
update storage.buckets set file_size_limit = 52428800,
  allowed_mime_types = array['video/mp4','video/webm']
  where id = 'generated-videos';
