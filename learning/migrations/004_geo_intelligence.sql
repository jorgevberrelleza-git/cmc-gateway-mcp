-- GEO v0.1 primary-source watch. Research-only; immutable event fingerprint deduplication.
create table if not exists learning_geo_events (
  id bigserial primary key,
  event_key text not null unique,
  source_id text not null,
  article_url text not null,
  title text not null,
  published_at timestamptz not null,
  first_seen_at timestamptz not null default now(),
  topic text not null,
  severity text not null check (severity in ('low','medium','high')),
  publisher_validated boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  execution_enabled boolean not null default false check (execution_enabled = false)
);
create index if not exists learning_geo_events_published_at_idx on learning_geo_events (published_at desc);
