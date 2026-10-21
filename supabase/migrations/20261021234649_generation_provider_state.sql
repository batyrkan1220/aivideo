-- Opaque per-job state for providers that need multiple steps (e.g. one face per call, chained).
alter table generation_jobs add column provider_state jsonb;
