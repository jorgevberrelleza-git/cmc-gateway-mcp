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
  asset text,
  action text,
  decision_type text not null,
  status text not null default 'shadow',
  thesis jsonb not null,
  risk_context jsonb not null,
  portfolio_context jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists learning_decisions_created_at_idx
  on learning_decisions (created_at desc);

create index if not exists learning_decisions_asset_idx
  on learning_decisions (asset, created_at desc);

create table if not exists learning_decision_queue (
  id bigserial primary key,
  snapshot_id bigint not null references learning_snapshots(id),
  queue_key text not null unique,
  priority integer not null default 50 check (priority between 0 and 100),
  status text not null default 'pending' check (status in ('pending','processing','processed','skipped','error')),
  material_event jsonb not null,
  claimed_at timestamptz,
  processed_at timestamptz,
  decision_id bigint references learning_decisions(id),
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists learning_decision_queue_status_idx
  on learning_decision_queue (status, priority desc, created_at asc);

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

create index if not exists learning_paper_orders_decision_idx
  on learning_paper_orders (decision_id);

create unique index if not exists learning_paper_orders_decision_symbol_unique
  on learning_paper_orders (decision_id, symbol);

create table if not exists learning_outcomes (
  id bigserial primary key,
  decision_id bigint not null references learning_decisions(id),
  paper_order_id bigint references learning_paper_orders(id),
  mark_snapshot_id bigint references learning_snapshots(id),
  horizon text not null check (horizon in ('4h','24h','7d','30d')),
  target_time timestamptz,
  evaluated_at timestamptz not null,
  asset_return_pct numeric,
  strategy_return_pct numeric,
  hold_return_pct numeric,
  usd_return_pct numeric,
  alpha_vs_hold_pct numeric,
  portfolio_return_pct numeric,
  max_adverse_excursion_pct numeric,
  max_favorable_excursion_pct numeric,
  notes jsonb,
  unique (decision_id, horizon)
);

create table if not exists learning_portfolio_ledger (
  id bigserial primary key,
  event_key text not null unique,
  occurred_at timestamptz not null,
  event_type text not null check (event_type in ('seed','paper_buy','paper_sell','fee','adjustment')),
  decision_id bigint references learning_decisions(id),
  paper_order_id bigint references learning_paper_orders(id),
  symbol text,
  quantity_delta numeric not null default 0,
  cash_delta_usd numeric not null default 0,
  reference_price_usd numeric,
  fee_usd numeric not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists learning_portfolio_ledger_time_idx
  on learning_portfolio_ledger (occurred_at asc, id asc);

create table if not exists learning_portfolio_marks (
  id bigserial primary key,
  marked_at timestamptz not null,
  snapshot_id bigint references learning_snapshots(id),
  total_value_usd numeric not null,
  cash_usd numeric not null,
  positions jsonb not null,
  prices jsonb not null,
  shadow_return_pct numeric,
  hodl_value_usd numeric,
  hodl_return_pct numeric,
  usd_value_usd numeric,
  alpha_vs_hodl_pct numeric,
  drawdown_pct numeric,
  metadata jsonb not null default '{}'::jsonb,
  unique (marked_at, snapshot_id)
);

create index if not exists learning_portfolio_marks_time_idx
  on learning_portfolio_marks (marked_at desc);

create table if not exists learning_watchdog_events (
  id bigserial primary key,
  detected_at timestamptz not null,
  asset text,
  event_type text not null,
  severity text not null check (severity in ('info','warning','critical')),
  details jsonb not null,
  fingerprint text not null unique,
  created_at timestamptz not null default now()
);


create table if not exists learning_reasoning_runs (
  id bigserial primary key,
  queue_id bigint not null references learning_decision_queue(id),
  provider text not null,
  model text,
  status text not null check (status in ('started','completed','rejected','error','skipped')),
  request_packet jsonb not null,
  response_payload jsonb,
  validation_summary jsonb,
  accepted_decision_ids jsonb not null default '[]'::jsonb,
  rejected_proposals jsonb not null default '[]'::jsonb,
  usage jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists learning_reasoning_runs_queue_idx
  on learning_reasoning_runs (queue_id, started_at desc);

create index if not exists learning_reasoning_runs_status_idx
  on learning_reasoning_runs (status, started_at desc);
