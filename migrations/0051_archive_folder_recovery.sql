alter table archive_folders
  add column deleted_at timestamptz,
  add column deletion_batch_id uuid,
  add column deletion_root_folder_id uuid;
alter table documents add column folder_deletion_batch_id uuid;
create index archive_folders_deletion_batch_idx on archive_folders (deletion_batch_id) where deleted_at is not null;
create index documents_folder_deletion_batch_idx on documents (folder_deletion_batch_id) where folder_deletion_batch_id is not null;

drop index archive_folders_active_name_idx;
create unique index archive_folders_active_name_idx
  on archive_folders (coalesce(parent_folder_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name)))
  where deleted_at is null;

create function archive_lock_hierarchy() returns trigger language plpgsql as $$
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Archive structure writes require READ COMMITTED isolation';
  end if;
  perform pg_advisory_xact_lock(1885430627, 1885430631);
  return null;
end;
$$;
-- Statement triggers acquire the lock before row locks, avoiding reverse lock
-- order between a direct document UPDATE and a folder-wide transaction.
create trigger archive_folders_structure_lock before insert or update or delete on archive_folders
  for each statement execute function archive_lock_hierarchy();
create trigger documents_structure_lock before insert or update or delete on documents
  for each statement execute function archive_lock_hierarchy();

create function archive_guard_folder() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Archive folders must be moved to trash'; end if;
  if new.deleted_at is null and new.parent_folder_id is not null then
    if not exists (select 1 from archive_folders where folder_id = new.parent_folder_id and deleted_at is null) then
      raise exception 'Restore the parent folder first or choose another location';
    end if;
    if new.parent_folder_id = new.folder_id or exists (
      with recursive ancestors as (
        select folder_id, parent_folder_id from archive_folders where folder_id = new.parent_folder_id
        union
        select parent.folder_id, parent.parent_folder_id from archive_folders parent
          join ancestors child on parent.folder_id = child.parent_folder_id
      ) select 1 from ancestors where folder_id = new.folder_id
    ) then raise exception 'A folder cannot move inside one of its descendants'; end if;
  end if;
  return new;
end;
$$;
create trigger archive_folders_parent_guard before insert or update or delete on archive_folders
  for each row execute function archive_guard_folder();

create function archive_guard_document_folder() returns trigger language plpgsql as $$
begin
  if new.deleted_at is null and new.folder_id is not null and not exists (
    select 1 from archive_folders where folder_id = new.folder_id and deleted_at is null
  ) then raise exception 'Restore the containing folder before restoring or adding files'; end if;
  return new;
end;
$$;
create trigger documents_archive_folder_guard before insert or update on documents
  for each row execute function archive_guard_document_folder();

-- Check the final transaction state as well: a direct folder UPDATE must not
-- strand active children/files while the repository's batch update is allowed.
create function archive_guard_deleted_folder_contents() returns trigger language plpgsql as $$
begin
  if exists (select 1 from archive_folders where folder_id = new.folder_id and deleted_at is not null) and (
    exists (select 1 from archive_folders where parent_folder_id = new.folder_id and deleted_at is null)
    or exists (select 1 from documents where folder_id = new.folder_id and deleted_at is null)
  ) then raise exception 'Move the complete folder tree and its files to trash together'; end if;
  return null;
end;
$$;
create constraint trigger archive_deleted_folder_contents_guard after update on archive_folders
  deferrable initially deferred for each row when (new.deleted_at is not null)
  execute function archive_guard_deleted_folder_contents();
