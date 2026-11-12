create table if not exists learning_shadow_v2_evaluations (
  id bigserial primary key,
  snapshot_id bigint not null references learning_snapshots(id),
  generated_at timestamptz not null,
  strategy_version text not null default 'shadow_v0.2',
  regime jsonb not null,
  consistency jsonb not null,
  asset_assessments jsonb not null,
  external_research_trigger jsonb not null,
  execution_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  unique (snapshot_id, strategy_version)
);

create index if not exists learning_shadow_v2_evaluations_time_idx
  on learning_shadow_v2_evaluations (generated_at desc);
