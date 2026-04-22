create extension if not exists pgcrypto;

create table if not exists projects (
  id text primary key,
  owner_id text not null,
  title text,
  description text,
  problem_statement text,
  solution text,
  domain text,
  target_user text,
  workflow_status text default 'draft',
  premium_readiness_band text default 'core_ready',
  export_readiness_score integer default 0,
  selected_variant_id text,
  intelligence_route jsonb,
  intelligence_memory jsonb,
  latest_export_revision text,
  share_mode text default 'private',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists project_audit (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references projects(id) on delete cascade,
  actor_id text,
  action text,
  payload jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_projects_owner_id on projects(owner_id);
create index if not exists idx_project_audit_project_id on project_audit(project_id);


alter table projects add column if not exists latest_cad_execution_id text;

create table if not exists cad_executions (
  execution_id text primary key,
  actor_id text,
  project_id text,
  status text,
  engine text,
  deterministic boolean default true,
  manufacturable boolean default false,
  ready_for_execution boolean default false,
  plan_signature text,
  manifest_json jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_cad_executions_project_id on cad_executions(project_id);


create table if not exists learning_events (
  event_id text primary key,
  domain text not null,
  project_id text references projects(id) on delete set null,
  actor_id text,
  outcome_type text default 'observation',
  success_score numeric default 0,
  confidence_score numeric default 0,
  tags jsonb default '[]'::jsonb,
  signals_json jsonb default '{}'::jsonb,
  input_json jsonb default '{}'::jsonb,
  output_json jsonb default '{}'::jsonb,
  metadata_json jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_learning_events_domain_created_at on learning_events(domain, created_at desc);
create index if not exists idx_learning_events_project_id on learning_events(project_id);


create table if not exists event_replay (
  replay_id text primary key,
  topic text not null,
  payload_json jsonb default '{}'::jsonb,
  origin_id text,
  published_at timestamptz default now()
);
create index if not exists idx_event_replay_topic_published on event_replay(topic, published_at desc);
create index if not exists idx_event_replay_task_id on event_replay((coalesce(payload_json->'task'->>'task_id', payload_json->>'task_id')));


create table if not exists event_replay_archive (
  replay_id text primary key,
  topic text not null,
  payload_json jsonb not null default '{}'::jsonb,
  origin_id text,
  published_at timestamptz not null default now(),
  archived_at timestamptz not null default now()
);
create index if not exists idx_event_replay_archive_topic_published on event_replay_archive(topic, published_at desc);
create index if not exists idx_event_replay_archive_task_id on event_replay_archive((coalesce(payload_json->'task'->>'task_id', payload_json->>'task_id')));

create table if not exists worker_tasks (
  task_id text primary key,
  kind text not null,
  source_id text,
  execution_target text not null,
  status text not null,
  payload jsonb default '{}'::jsonb,
  worker_claim jsonb,
  result jsonb,
  submitted_at timestamptz default now(),
  started_at timestamptz,
  completed_at timestamptz,
  error text,
  metadata jsonb default '{}'::jsonb,
  dedupe_key text,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  timeout_recovered_at timestamptz,
  attempts integer default 0,
  max_attempts integer default 3,
  retry_count integer default 0,
  progress jsonb default '{}'::jsonb,
  logs jsonb default '[]'::jsonb
);

create index if not exists idx_worker_tasks_status_submitted_at on worker_tasks(status, submitted_at desc);
create index if not exists idx_worker_tasks_kind_status on worker_tasks(kind, status);
create index if not exists idx_worker_tasks_source_id on worker_tasks(source_id);
create unique index if not exists idx_worker_tasks_dedupe_active on worker_tasks(dedupe_key) where dedupe_key is not null and status in ('pending', 'running');


create table if not exists workflow_runs (
  run_id text primary key,
  workflow_type text not null,
  project_id text references projects(id) on delete set null,
  actor_id text,
  status text not null,
  current_step text,
  requested_steps jsonb default '[]'::jsonb,
  payload_json jsonb default '{}'::jsonb,
  state_json jsonb default '{}'::jsonb,
  result_json jsonb,
  metadata_json jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  completed_at timestamptz,
  revision integer not null default 0
);
create index if not exists idx_workflow_runs_project_updated on workflow_runs(project_id, updated_at desc);
create index if not exists idx_workflow_runs_status_updated on workflow_runs(status, updated_at desc);

create table if not exists solver_jobs (
  job_id text primary key,
  actor_id text,
  project_id text references projects(id) on delete set null,
  status text not null,
  execution_target text,
  task_id text,
  learning_event_id text references learning_events(event_id) on delete set null,
  payload_json jsonb default '{}'::jsonb,
  result_json jsonb,
  metadata_json jsonb default '{}'::jsonb,
  progress_json jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_solver_jobs_project_updated on solver_jobs(project_id, updated_at desc);
create index if not exists idx_solver_jobs_status_updated on solver_jobs(status, updated_at desc);

create table if not exists cad_jobs (
  execution_id text primary key,
  actor_id text,
  project_id text references projects(id) on delete set null,
  status text not null,
  execution_target text,
  task_id text,
  learning_event_id text references learning_events(event_id) on delete set null,
  payload_json jsonb default '{}'::jsonb,
  result_json jsonb,
  metadata_json jsonb default '{}'::jsonb,
  progress_json jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_cad_jobs_project_updated on cad_jobs(project_id, updated_at desc);

create table if not exists patent_jobs (
  search_id text primary key,
  actor_id text,
  project_id text references projects(id) on delete set null,
  status text not null,
  learning_event_id text references learning_events(event_id) on delete set null,
  request_json jsonb default '{}'::jsonb,
  response_json jsonb default '{}'::jsonb,
  provider_meta_json jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_patent_jobs_project_updated on patent_jobs(project_id, updated_at desc);


create table if not exists physics_jobs (
  job_id text primary key,
  actor_id text,
  project_id text references projects(id) on delete set null,
  status text not null,
  execution_target text,
  task_id text,
  learning_event_id text references learning_events(event_id) on delete set null,
  payload_json jsonb default '{}'::jsonb,
  result_json jsonb,
  metadata_json jsonb default '{}'::jsonb,
  progress_json jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_physics_jobs_project_updated on physics_jobs(project_id, updated_at desc);
create index if not exists idx_physics_jobs_status_updated on physics_jobs(status, updated_at desc);

create table if not exists fleet_metrics (
  metric_id text primary key,
  topic text not null,
  worker_id text,
  task_id text,
  job_kind text,
  project_id text references projects(id) on delete set null,
  execution_target text,
  duration_ms integer default 0,
  queue_ms integer default 0,
  retries integer default 0,
  success boolean default true,
  created_at timestamptz default now()
);
create index if not exists idx_fleet_metrics_created_at on fleet_metrics(created_at desc);
create index if not exists idx_fleet_metrics_kind_created_at on fleet_metrics(job_kind, created_at desc);

create table if not exists app_users (
  user_id text primary key,
  email text,
  full_name text,
  role text default 'owner',
  plan_id text default 'free',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_app_users_email on app_users(email);

create table if not exists subscriptions (
  subscription_id text primary key,
  user_id text not null references app_users(user_id) on delete cascade,
  plan_id text not null,
  status text default 'active',
  billing_provider text default 'mock',
  current_period_start timestamptz,
  current_period_end timestamptz,
  metadata_json jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_subscriptions_user_id on subscriptions(user_id, updated_at desc);

create table if not exists usage_ledger (
  usage_id text primary key,
  user_id text not null references app_users(user_id) on delete cascade,
  meter_key text not null,
  quantity numeric default 0,
  source text,
  metadata_json jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
create index if not exists idx_usage_ledger_user_id on usage_ledger(user_id, created_at desc);

create table if not exists checkout_sessions (
  checkout_session_id text primary key,
  user_id text not null references app_users(user_id) on delete cascade,
  plan_id text not null,
  status text default 'pending',
  provider text default 'mock',
  checkout_url text,
  metadata_json jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
create index if not exists idx_checkout_sessions_user_id on checkout_sessions(user_id, created_at desc);

alter table app_users add column if not exists password_digest text;
alter table checkout_sessions add column if not exists provider_session_id text;

create table if not exists auth_sessions (
  session_id text primary key,
  user_id text not null references app_users(user_id) on delete cascade,
  expires_at timestamptz not null,
  metadata_json jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_auth_sessions_user_id on auth_sessions(user_id, expires_at desc);

create table if not exists orgs (
  org_id text primary key,
  slug text unique,
  name text not null,
  owner_user_id text not null references app_users(user_id) on delete cascade,
  billing_email text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_orgs_owner_user_id on orgs(owner_user_id);

create table if not exists org_memberships (
  membership_id text primary key,
  org_id text not null references orgs(org_id) on delete cascade,
  user_id text not null references app_users(user_id) on delete cascade,
  role text not null default 'member',
  invited_by text references app_users(user_id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(org_id, user_id)
);
create index if not exists idx_org_memberships_user_id on org_memberships(user_id, updated_at desc);

alter table workflow_runs add column if not exists revision integer not null default 0;
create index if not exists idx_workflow_runs_revision on workflow_runs(run_id, revision);

create table if not exists missions (
  mission_id text primary key,
  project_id text references projects(id) on delete cascade,
  owner_id text not null references app_users(user_id) on delete cascade,
  title text not null,
  brief text,
  status text default 'draft',
  latest_run_id text,
  current_version_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_missions_owner_project on missions(owner_id, project_id, updated_at desc);

create table if not exists mission_versions (
  version_id text primary key,
  mission_id text not null references missions(mission_id) on delete cascade,
  owner_id text not null references app_users(user_id) on delete cascade,
  version_number integer not null,
  label text,
  snapshot_json jsonb default '{}'::jsonb,
  run_id text,
  created_at timestamptz default now()
);
create index if not exists idx_mission_versions_mission on mission_versions(mission_id, version_number desc);


create table if not exists webhook_events (
  event_id text primary key,
  provider text not null default 'stripe',
  event_type text,
  payload_json jsonb,
  processed_at timestamptz default now(),
  created_at timestamptz default now()
);

create index if not exists idx_webhook_events_provider_type on webhook_events(provider, event_type);

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
