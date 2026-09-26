alter table service_discussion_messages add column management_owner_user_id uuid references users(user_id) on delete restrict;
alter table knowledge_items add column management_owner_user_id uuid references users(user_id) on delete restrict;
alter table manuscripts add column management_owner_user_id uuid references users(user_id) on delete restrict;
update service_discussion_messages m set management_owner_user_id = u.user_id from users u where u.user_id = m.created_by;
update knowledge_items m set management_owner_user_id = u.user_id from users u where u.user_id = m.created_by;
update manuscripts m set management_owner_user_id = u.user_id from users u where u.user_id = m.created_by;

create trigger discussion_management_owner_guard before insert or update on service_discussion_messages
  for each row execute function archive_guard_management_owner();
create trigger knowledge_management_owner_guard before insert or update on knowledge_items
  for each row execute function archive_guard_management_owner();
create trigger manuscript_management_owner_guard before insert or update on manuscripts
  for each row execute function archive_guard_management_owner();

-- Retain references even after edits, version pruning and content deletion.
-- Releasing a reference requires a future explicit review/retention workflow.
create table archive_content_document_references (
  content_kind text not null check (content_kind in ('discussion', 'knowledge', 'manuscript')),
  content_id uuid not null,
  document_id uuid not null references documents(document_id) on delete restrict,
  owner_user_id uuid references users(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (content_kind, content_id, document_id)
);
create index archive_content_reference_document_idx on archive_content_document_references(document_id);
create trigger archive_content_reference_immutable before update or delete on archive_content_document_references
  for each row execute function archive_protect_management_audit();
create trigger archive_content_reference_lock before insert on archive_content_document_references
  for each statement execute function archive_lock_hierarchy();

create function archive_retain_body_documents(kind text, id uuid, owner_id uuid, body_text text) returns void language sql as $$
  insert into archive_content_document_references (content_kind, content_id, document_id, owner_user_id)
  select kind, id, d.document_id, owner_id from documents d
  join (select distinct (regexp_matches(body_text, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', 'gi'))[1]::uuid as document_id) refs
    on refs.document_id = d.document_id
  where body_text !~ '^pae1[.][A-Za-z0-9_-]{16}[.][A-Za-z0-9_-]{22,}$'
  on conflict do nothing;
$$;
create function archive_capture_body_documents() returns trigger language plpgsql as $$
declare owner_id uuid;
begin
  if tg_table_name = 'service_discussion_messages' then
    perform archive_retain_body_documents('discussion', new.message_id, new.management_owner_user_id, new.body_text);
  elsif tg_table_name = 'knowledge_items' then
    perform archive_retain_body_documents('knowledge', new.knowledge_id, new.management_owner_user_id, new.body);
  else
    select management_owner_user_id into owner_id from manuscripts where manuscript_id = new.manuscript_id;
    perform archive_retain_body_documents('manuscript', new.manuscript_id, owner_id, new.body);
  end if;
  return new;
end;
$$;
create trigger archive_discussion_body_references after insert or update of body_text on service_discussion_messages
  for each row execute function archive_capture_body_documents();
create trigger archive_knowledge_body_references after insert or update of body on knowledge_items
  for each row execute function archive_capture_body_documents();
create trigger archive_chapter_body_references after insert or update of body on manuscript_chapters
  for each row execute function archive_capture_body_documents();
create trigger archive_version_body_references after insert or update of body on manuscript_chapter_versions
  for each row execute function archive_capture_body_documents();

-- Statement locks precede row locks, matching the scoped repository transaction.
create trigger archive_knowledge_owner_lock before insert or update or delete on knowledge_items
  for each statement execute function archive_lock_hierarchy();
create trigger archive_manuscript_owner_lock before insert or update or delete on manuscripts
  for each statement execute function archive_lock_hierarchy();
create trigger archive_chapter_owner_lock before insert or update or delete on manuscript_chapters
  for each statement execute function archive_lock_hierarchy();
create trigger archive_version_owner_lock before insert or update or delete on manuscript_chapter_versions
  for each statement execute function archive_lock_hierarchy();

select archive_retain_body_documents('discussion', message_id, management_owner_user_id, body_text) from service_discussion_messages;
select archive_retain_body_documents('knowledge', knowledge_id, management_owner_user_id, body) from knowledge_items;
select archive_retain_body_documents('manuscript', c.manuscript_id, m.management_owner_user_id, c.body)
  from manuscript_chapters c join manuscripts m on m.manuscript_id = c.manuscript_id;
select archive_retain_body_documents('manuscript', c.manuscript_id, m.management_owner_user_id, c.body)
  from manuscript_chapter_versions c join manuscripts m on m.manuscript_id = c.manuscript_id;

create function archive_capture_knowledge_link() returns trigger language plpgsql as $$
begin
  if new.entity_type = 'document' then
    insert into archive_content_document_references (content_kind, content_id, document_id, owner_user_id)
    select 'knowledge', k.knowledge_id, d.document_id, k.management_owner_user_id
      from knowledge_items k join documents d on d.document_id = new.entity_id where k.knowledge_id = new.knowledge_id
    on conflict do nothing;
  end if;
  return new;
end;
$$;
create trigger archive_knowledge_link_reference after insert or update on knowledge_links
  for each row execute function archive_capture_knowledge_link();
insert into archive_content_document_references (content_kind, content_id, document_id, owner_user_id)
  select 'knowledge', k.knowledge_id, d.document_id, k.management_owner_user_id
    from knowledge_links l join knowledge_items k on k.knowledge_id = l.knowledge_id
    join documents d on d.document_id = l.entity_id where l.entity_type = 'document'
  on conflict do nothing;
