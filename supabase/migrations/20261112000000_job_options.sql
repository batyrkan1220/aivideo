-- Admin options for one generation run, e.g. {"reuse":{"person":0,"task":"<kling task>"}}:
-- keep one person's finished Kling run and make only the other one again (two people, parallel mode).
alter table public.generation_jobs add column if not exists options_json jsonb;
