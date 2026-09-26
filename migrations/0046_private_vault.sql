create table if not exists private_vaults (
  vault_id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null unique references users(user_id) on delete cascade,
  encryption_version integer not null,
  encryption_kdf text not null,
  encryption_iterations integer not null,
  encryption_salt text not null,
  encrypted_vault_key text not null,
  recovery_encrypted_vault_key text not null,
  auto_lock_minutes integer not null default 10,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint private_vaults_encryption_check check (
    encryption_version = 1
    and encryption_kdf = 'PBKDF2-SHA-256'
    and encryption_iterations = 600000
  ),
  constraint private_vaults_auto_lock_check check (auto_lock_minutes in (5, 10, 30))
);

create table if not exists private_vault_items (
  item_id uuid primary key,
  vault_id uuid not null references private_vaults(vault_id) on delete cascade,
  encryption_version integer not null default 1,
  encrypted_metadata text not null,
  wrapped_file_key text not null,
  object_key text not null unique,
  ciphertext_size bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint private_vault_items_encryption_check check (encryption_version = 1),
  constraint private_vault_items_size_check check (ciphertext_size >= 0)
);

create index if not exists private_vault_items_active_idx
  on private_vault_items (vault_id, updated_at desc)
  where deleted_at is null;

create index if not exists private_vault_items_deleted_idx
  on private_vault_items (vault_id, deleted_at desc)
  where deleted_at is not null;

alter table backup_items
  drop constraint if exists backup_items_item_type_check;

alter table backup_items
  add constraint backup_items_item_type_check check (
    item_type in ('metadata', 'document', 'private-vault-item', 'audit-log', 'relationship', 'manifest')
  );
