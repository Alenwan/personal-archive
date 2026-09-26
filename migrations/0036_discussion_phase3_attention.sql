alter table service_discussion_messages
  add column if not exists thread_owner_user_id uuid references users(user_id) on delete set null;

create index if not exists service_discussion_messages_thread_owner_idx
  on service_discussion_messages (thread_owner_user_id, updated_at desc)
  where deleted_at is null and thread_owner_user_id is not null;

alter table knowledge_links
  drop constraint if exists knowledge_links_entity_type_check;

alter table knowledge_links
  add constraint knowledge_links_entity_type_check
  check (entity_type in ('service', 'asset', 'document', 'credential', 'discussion'));

comment on column service_discussion_messages.thread_owner_user_id is
  'Optional user responsible for following up on the discussion thread. Stored on root and replies for simple filtering.';

comment on constraint knowledge_links_entity_type_check on knowledge_links is
  'Knowledge links can point to operational entities, including discussion messages that were promoted into reusable knowledge.';
