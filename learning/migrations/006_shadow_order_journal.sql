-- Shadow order journal: one row per origin_id, written BEFORE any order is sent.
-- The PRIMARY KEY is the real guarantee against double execution (atomic insert).
create table if not exists shadow_order_journal (
  origin_id text primary key check (origin_id ~ '^shadow-[a-f0-9]{24}$'),
  mode text not null check (mode in ('REHEARSAL','LIVE')),
  state text not null check (state in ('REHEARSED','PLANNED','SENT','UNKNOWN','FILLED','PARTIAL','REJECTED','RECONCILED')),
  book text not null check (book in ('btc_usd','ada_usd')),
  side text not null check (side in ('buy','sell')),
  major numeric not null check (major > 0),
  price numeric not null check (price > 0),
  notional_usd numeric not null check (notional_usd > 0),
  reason text,
  snapshot_id bigint,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shadow_order_journal_mode_state_idx on shadow_order_journal (mode, state);
create index if not exists shadow_order_journal_created_idx on shadow_order_journal (created_at desc);
