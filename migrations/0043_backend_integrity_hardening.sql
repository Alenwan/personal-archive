create table if not exists storage_cleanup_jobs (
  cleanup_job_id uuid primary key default gen_random_uuid(),
  object_key text not null unique,
  attempts integer not null default 0,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_storage_cleanup_jobs_pending
  on storage_cleanup_jobs (updated_at, created_at)
  where completed_at is null;

create index if not exists idx_auth_sessions_expires_at
  on auth_sessions (expires_at);

delete from auth_sessions
where expires_at < now() - interval '7 days'
   or (revoked_at is not null and revoked_at < now() - interval '7 days');

update asset_credentials credential
set party_organization_id = asset.party_organization_id,
    work_item_id = asset.work_item_id,
    updated_at = now()
from managed_assets asset
where credential.asset_id = asset.asset_id
  and credential.deleted_at is null
  and (
    credential.party_organization_id is distinct from asset.party_organization_id
    or credential.work_item_id is distinct from asset.work_item_id
  );
