create table if not exists learning_snapshots (
  id bigserial primary key,
  generated_at timestamptz not null,
  snapshot_version text,
  source text not null default 'scheduler',
  sha256 text not null unique,
  payload jsonb not null,
  material_event jsonb,
  created_at timestamptz not null default now()
);

create index if not exists learning_snapshots_generated_at_idx
  on learning_snapshots (generated_at desc);

create table if not exists learning_decisions (
  id bigserial primary key,
  decision_key text not null unique,
  snapshot_id bigint not null references learning_snapshots(id),
  decision_type text not null,
  status text not null default 'shadow',
  thesis jsonb not null,
  risk_context jsonb not null,
  portfolio_context jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists learning_paper_orders (
  id bigserial primary key,
  decision_id bigint not null references learning_decisions(id),
  symbol text not null,
  side text not null,
  quantity numeric,
  notional_usd numeric,
  reference_price_usd numeric,
  invalidation_price_usd numeric,
  target_price_usd numeric,
  estimated_fee_usd numeric,
  estimated_slippage_bps numeric,
  state text not null default 'proposed',
  created_at timestamptz not null default now()
);

create table if not exists learning_outcomes (
  id bigserial primary key,
  decision_id bigint not null references learning_decisions(id),
  horizon text not null check (horizon in ('4h','24h','7d','30d')),
  evaluated_at timestamptz not null,
  portfolio_return_pct numeric,
  hold_return_pct numeric,
  usd_return_pct numeric,
  max_adverse_excursion_pct numeric,
  max_favorable_excursion_pct numeric,
  notes jsonb,
  unique (decision_id, horizon)
);
