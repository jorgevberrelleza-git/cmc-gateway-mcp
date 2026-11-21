alter table learning_decision_queue
  add column if not exists attempt_count integer not null default 0;

alter table learning_decision_queue
  add column if not exists last_attempt_at timestamptz;
