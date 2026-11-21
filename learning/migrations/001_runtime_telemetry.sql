create table if not exists learning_runtime_cycles (
  id bigserial primary key,
  cycle_key text not null unique,
  started_at timestamptz not null,
  completed_at timestamptz not null,
  status text not null check (status in ('success','partial','error')),
  duration_ms bigint not null,
  steps jsonb not null,
  config_fingerprint text,
  execution_enabled boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists learning_runtime_cycles_started_at_idx
  on learning_runtime_cycles (started_at desc);
