alter table manuscripts
  add column if not exists encryption_enabled boolean not null default false,
  add column if not exists encryption_version integer,
  add column if not exists encryption_kdf text,
  add column if not exists encryption_iterations integer,
  add column if not exists encryption_salt text,
  add column if not exists encrypted_work_key text,
  add column if not exists recovery_encrypted_work_key text,
  add column if not exists encryption_updated_at timestamptz;

alter table manuscripts
  drop constraint if exists manuscripts_encryption_metadata_check;

alter table manuscripts
  add constraint manuscripts_encryption_metadata_check check (
    (not encryption_enabled
      and encryption_version is null
      and encryption_kdf is null
      and encryption_iterations is null
      and encryption_salt is null
      and encrypted_work_key is null
      and recovery_encrypted_work_key is null)
    or
    (encryption_enabled
      and encryption_version = 1
      and encryption_kdf = 'PBKDF2-SHA-256'
      and encryption_iterations = 600000
      and encryption_salt is not null
      and encrypted_work_key is not null
      and recovery_encrypted_work_key is not null)
  );
