-- GEO v0.2: scheduled releases, conservative document checks, observed-only return study.
alter table learning_geo_events
  add column if not exists document_status text not null default 'not_checked',
  add column if not exists document_checked_at timestamptz,
  add column if not exists document_evidence jsonb not null default '{}'::jsonb;

create table if not exists learning_geo_calendar (
  event_key text primary key,
  source_id text not null,
  title text not null,
  scheduled_at timestamptz not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  category text not null,
  event_url text,
  metadata jsonb not null default '{}'::jsonb,
  execution_enabled boolean not null default false check (execution_enabled=false)
);
create index if not exists learning_geo_calendar_scheduled_at_idx on learning_geo_calendar(scheduled_at);

create table if not exists learning_geo_market_outcomes (
  event_key text not null references learning_geo_events(event_key),
  asset text not null check (asset in ('BTC','ADA','AAVE')),
  horizon text not null check (horizon in ('1h','4h','12h','24h')),
  baseline_snapshot_id bigint not null references learning_snapshots(id),
  later_snapshot_id bigint not null references learning_snapshots(id),
  baseline_at timestamptz not null,
  later_at timestamptz not null,
  signed_return_pct double precision not null,
  abs_return_pct double precision not null,
  recorded_at timestamptz not null default now(),
  execution_enabled boolean not null default false check (execution_enabled=false),
  primary key(event_key,asset,horizon)
);
create index if not exists learning_geo_market_outcomes_asset_horizon_idx on learning_geo_market_outcomes(asset,horizon);
