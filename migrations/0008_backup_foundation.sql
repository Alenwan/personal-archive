create table if not exists backup_jobs (
  backup_job_id uuid primary key,
  organization_id uuid not null default '90000000-0000-4000-8000-000000000001',
  name text not null default 'Primary backup plan',
  destination text not null check (destination in ('google-drive', 'r2-manifest', 'manual-export')),
  schedule text not null check (schedule in ('daily', 'weekly', 'monthly')),
  scope text not null check (scope in ('all-cases', 'closed-cases', 'updated-since-last-run')),
  include_metadata boolean not null default true,
  include_documents boolean not null default true,
  include_audit_logs boolean not null default true,
  include_relationship_map boolean not null default true,
  folder_by_case_and_category boolean not null default true,
  checksum_manifest boolean not null default true,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references users(user_id) on delete set null,
  updated_by uuid references users(user_id) on delete set null
);

create table if not exists backup_runs (
  backup_run_id uuid primary key,
  backup_job_id uuid not null references backup_jobs(backup_job_id) on delete cascade,
  status text not null check (status in ('completed', 'dry-run', 'attention', 'failed')),
  destination text not null check (destination in ('google-drive', 'r2-manifest', 'manual-export')),
  scope text not null check (scope in ('all-cases', 'closed-cases', 'updated-since-last-run')),
  started_at timestamptz not null,
  completed_at timestamptz,
  case_count integer not null default 0,
  document_count integer not null default 0,
  metadata_rows integer not null default 0,
  item_count integer not null default 0,
  failed_items integer not null default 0,
  manifest_object_key text,
  manifest_file_name text,
  mode text not null check (mode in ('r2-manifest', 'dry-run', 'planned-integration')),
  message text not null default '',
  created_by uuid references users(user_id) on delete set null
);

create table if not exists backup_items (
  backup_item_id uuid primary key,
  backup_run_id uuid not null references backup_runs(backup_run_id) on delete cascade,
  item_type text not null check (item_type in ('metadata', 'document', 'audit-log', 'relationship', 'manifest')),
  source_id text,
  source_path text not null,
  target_path text not null,
  status text not null check (status in ('included', 'skipped', 'failed')),
  size_bytes bigint not null default 0,
  checksum text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists backup_runs_job_started_idx on backup_runs (backup_job_id, started_at desc);
create index if not exists backup_items_run_idx on backup_items (backup_run_id, item_type);

insert into backup_jobs (
  backup_job_id,
  organization_id,
  name,
  destination,
  schedule,
  scope,
  include_metadata,
  include_documents,
  include_audit_logs,
  include_relationship_map,
  folder_by_case_and_category,
  checksum_manifest,
  is_enabled,
  created_by,
  updated_by
)
select
  '80000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000001',
  'Primary backup plan',
  'r2-manifest',
  'daily',
  'all-cases',
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  user_id,
  user_id
from users
where role = 'Admin'
order by created_at
limit 1
on conflict (backup_job_id) do nothing;
