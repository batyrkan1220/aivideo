-- Link a partner to their login in the Teliks cabinet (separate Supabase project).
alter table partners add column if not exists teliks_user_id uuid unique;
alter table partners add column if not exists teliks_email text;
