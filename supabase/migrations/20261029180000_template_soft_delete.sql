-- Admin "delete template": templates with order history are hidden (deleted_at) instead of removed,
-- so customers' orders keep their template reference; unused templates are deleted for real.
alter table templates add column if not exists deleted_at timestamptz;
