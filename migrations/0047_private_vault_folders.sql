create table if not exists private_vault_folders (
  folder_id uuid primary key,
  vault_id uuid not null references private_vaults(vault_id) on delete cascade,
  encryption_version integer not null default 1,
  encrypted_metadata text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint private_vault_folders_encryption_check check (encryption_version = 1)
);

create index if not exists private_vault_folders_active_idx
  on private_vault_folders (vault_id, updated_at desc)
  where deleted_at is null;

create index if not exists private_vault_folders_deleted_idx
  on private_vault_folders (vault_id, deleted_at desc)
  where deleted_at is not null;
