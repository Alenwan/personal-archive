alter table documents add column management_owner_user_id uuid references users(user_id) on delete restrict;
alter table archive_folders add column management_owner_user_id uuid references users(user_id) on delete restrict;
alter table auth_sessions add column archive_management_verified_until timestamptz;

-- Later uploaders do not contradict first-version evidence. Missing originals,
-- duplicate first versions and inconsistent case context remain unresolved.
with origins as (
  select coalesce(document_group_id, document_id) as group_id,
    (array_agg(uploaded_by) filter (where version_number = 1 and document_id = coalesce(document_group_id, document_id)))[1] as owner_id
  from documents
  group by coalesce(document_group_id, document_id)
  having count(*) filter (where version_number = 1) = 1
    and count(*) filter (where version_number = 1 and document_id = coalesce(document_group_id, document_id)) = 1
    and count(distinct coalesce(case_id, '00000000-0000-0000-0000-000000000000'::uuid)) = 1
)
update documents d set management_owner_user_id = o.owner_id
from origins o join users u on u.user_id = o.owner_id
where coalesce(d.document_group_id, d.document_id) = o.group_id;
update archive_folders f set management_owner_user_id = u.user_id from users u where u.user_id = f.created_by;

create function archive_guard_management_owner() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if new.management_owner_user_id is distinct from old.management_owner_user_id then
      raise exception 'Archive management ownership is immutable';
    end if;
    if tg_table_name = 'documents' then
      if new.document_group_id is distinct from old.document_group_id or new.document_id <> old.document_id then
        raise exception 'Archive version group identity is immutable';
      end if;
    end if;
  elsif tg_table_name = 'documents' then
    if exists (select 1 from documents where coalesce(document_group_id, document_id) = coalesce(new.document_group_id, new.document_id)) then
      select management_owner_user_id into new.management_owner_user_id from documents
        where coalesce(document_group_id, document_id) = coalesce(new.document_group_id, new.document_id)
        order by version_number, document_id limit 1;
    else
      new.management_owner_user_id := case when coalesce(new.version_number, 1) = 1
        and coalesce(new.document_group_id, new.document_id) = new.document_id then new.uploaded_by else null end;
    end if;
  else
    new.management_owner_user_id := new.created_by;
  end if;
  return new;
end;
$$;
create trigger documents_management_owner_guard before insert or update on documents
  for each row execute function archive_guard_management_owner();
create trigger archive_folders_management_owner_guard before insert or update on archive_folders
  for each row execute function archive_guard_management_owner();

create table archive_management_audit (
  audit_id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references users(user_id) on delete restrict,
  action text not null,
  resource_kind text not null,
  resource_id uuid not null,
  owner_user_id uuid,
  created_at timestamptz not null default now()
);
create function archive_protect_management_audit() returns trigger language plpgsql as $$
begin raise exception 'Archive management audit is immutable'; end;
$$;
create trigger archive_management_audit_immutable before update or delete on archive_management_audit
  for each row execute function archive_protect_management_audit();

-- Serialize attachment reference changes with file authorization and purge.
create trigger archive_discussion_attachment_lock before insert or update or delete on service_discussion_attachments
  for each statement execute function archive_lock_hierarchy();
create trigger archive_asset_document_lock before insert or update or delete on asset_document_links
  for each statement execute function archive_lock_hierarchy();
create trigger archive_discussion_owner_lock before insert or update or delete on service_discussion_messages
  for each statement execute function archive_lock_hierarchy();
create trigger archive_asset_owner_lock before insert or update or delete on managed_assets
  for each statement execute function archive_lock_hierarchy();

create function archive_guard_referenced_document() returns trigger language plpgsql as $$
begin
  if exists (select 1 from service_discussion_attachments where document_id = old.document_id)
    or exists (select 1 from asset_document_links where document_id = old.document_id)
    or exists (select 1 from knowledge_links where entity_type = 'document' and entity_id = old.document_id) then
    raise exception 'Referenced files cannot be permanently deleted';
  end if;
  return old;
end;
$$;
create trigger documents_reference_guard before delete on documents
  for each row execute function archive_guard_referenced_document();
create trigger archive_knowledge_link_lock before insert or update or delete on knowledge_links
  for each statement execute function archive_lock_hierarchy();
