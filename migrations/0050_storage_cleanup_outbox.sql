alter table storage_cleanup_jobs
  add column started_at timestamptz,
  add column lease_token uuid,
  add column lease_expires_at timestamptz,
  add column next_attempt_at timestamptz not null default now();

-- Do not retain provider errors which may contain object names or credentials.
update storage_cleanup_jobs set last_error = 'object_delete_failed' where last_error is not null;
-- Already completed keys must not become usable again after an upgrade.
update storage_cleanup_jobs set started_at = completed_at where completed_at is not null;
create index storage_cleanup_due_idx on storage_cleanup_jobs (next_attempt_at)
  where completed_at is null;

-- Shared with the worker. After intent is committed a key is never reused,
-- even if DELETE/acknowledgement fails or a lease expires during a slow DELETE.
create function archive_guard_object_reference() returns trigger language plpgsql as $$
declare object_key_value text;
begin
  object_key_value := to_jsonb(new) ->> tg_argv[0];
  if tg_op = 'UPDATE' then
    if object_key_value is distinct from (to_jsonb(old) ->> tg_argv[0]) then
      raise exception 'Stored object keys are immutable';
    end if;
    return new;
  end if;
  -- A fresh snapshot after waiting on the key lock is required. Application
  -- writes use READ COMMITTED; reject stale-snapshot administrative writes.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Object references require READ COMMITTED isolation';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(object_key_value, 1885430630));
  if exists (select 1 from storage_cleanup_jobs where object_key = object_key_value and started_at is not null) then
    raise exception 'Stored object key has been retired';
  end if;
  return new;
end;
$$;

create trigger documents_object_reference_guard before insert or update of r2_object_key on documents
  for each row execute function archive_guard_object_reference('r2_object_key');
create trigger vault_object_reference_guard before insert or update of object_key on private_vault_items
  for each row execute function archive_guard_object_reference('object_key');

create function archive_enqueue_deleted_object() returns trigger language plpgsql as $$
begin
  insert into storage_cleanup_jobs (object_key) values (to_jsonb(old) ->> tg_argv[0])
  on conflict (object_key) do update
    set next_attempt_at = least(storage_cleanup_jobs.next_attempt_at, now()), updated_at = now()
    where storage_cleanup_jobs.completed_at is null and storage_cleanup_jobs.lease_token is null;
  return old;
end;
$$;

-- Covers every deletion path, including a parent deletion's foreign-key cascade.
create trigger documents_cleanup_outbox after delete on documents
  for each row execute function archive_enqueue_deleted_object('r2_object_key');
create trigger vault_cleanup_outbox after delete on private_vault_items
  for each row execute function archive_enqueue_deleted_object('object_key');
