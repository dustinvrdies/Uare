
create table if not exists audit_events (
  audit_id text primary key,
  actor_id text,
  actor_role text,
  action text not null,
  target_type text,
  target_id text,
  status text default 'success',
  request_id text,
  ip text,
  metadata_json jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
create index if not exists idx_audit_events_created_at on audit_events(created_at desc);
create index if not exists idx_audit_events_action_created_at on audit_events(action, created_at desc);

create table if not exists idempotency_keys (
  idempotency_key text not null,
  scope text not null,
  request_hash text not null,
  response_status integer,
  response_body_json jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  expires_at timestamptz not null,
  primary key (idempotency_key, scope)
);
create index if not exists idx_idempotency_keys_expires_at on idempotency_keys(expires_at);
