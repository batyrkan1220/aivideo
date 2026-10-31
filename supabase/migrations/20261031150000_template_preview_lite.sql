-- Light card preview (480p, no sound, a few seconds): what catalog cards play. The full preview
-- stays for the template page. Filled by the server (ffmpeg) after the preview video changes.
alter table templates add column if not exists preview_lite_path text;
