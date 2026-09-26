create table if not exists service_discussion_messages (
  message_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default '90000000-0000-4000-8000-000000000001' references tenants(tenant_id),
  work_item_id uuid not null references work_items(work_item_id) on delete cascade,
  parent_message_id uuid references service_discussion_messages(message_id) on delete set null,
  body_text text not null default '',
  message_type text not null default 'message',
  is_pinned boolean not null default false,
  created_by uuid not null references users(user_id),
  updated_by uuid references users(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  constraint service_discussion_message_type_check check (message_type in ('message', 'decision', 'system'))
);

create table if not exists service_discussion_attachments (
  attachment_id uuid primary key default gen_random_uuid(),
  message_id uuid not null references service_discussion_messages(message_id) on delete cascade,
  document_id uuid not null references documents(document_id) on delete cascade,
  inline_image boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (message_id, document_id)
);

create index if not exists service_discussion_messages_work_item_created_idx
  on service_discussion_messages (work_item_id, created_at)
  where deleted_at is null;

create index if not exists service_discussion_messages_parent_idx
  on service_discussion_messages (parent_message_id)
  where deleted_at is null and parent_message_id is not null;

create index if not exists service_discussion_messages_pinned_idx
  on service_discussion_messages (work_item_id, is_pinned, updated_at desc)
  where deleted_at is null and is_pinned = true;

create index if not exists service_discussion_attachments_message_idx
  on service_discussion_attachments (message_id, sort_order, created_at);

create index if not exists service_discussion_attachments_document_idx
  on service_discussion_attachments (document_id);

comment on table service_discussion_messages is 'Internal MD3 staff discussion messages attached to a service/work item. Not customer-facing.';
comment on table service_discussion_attachments is 'Discussion message attachments that reuse existing document metadata and object storage.';
