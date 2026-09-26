create table if not exists knowledge_items (
  knowledge_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default '90000000-0000-4000-8000-000000000001' references tenants(tenant_id),
  title text not null,
  knowledge_type text not null default 'Reference',
  status text not null default 'Draft',
  component text not null default '',
  summary text not null default '',
  body text not null default '',
  keywords text[] not null default '{}',
  credential_reference text not null default '',
  source_work_item_id uuid references work_items(work_item_id),
  last_verified_at date,
  created_by uuid references users(user_id),
  updated_by uuid references users(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint knowledge_items_type_check check (
    knowledge_type in ('Runbook', 'Troubleshooting', 'Install guide', 'Configuration note', 'Service lesson', 'Reference')
  ),
  constraint knowledge_items_status_check check (
    status in ('Draft', 'Verified', 'Needs review', 'Outdated', 'Archived')
  )
);

create table if not exists knowledge_links (
  knowledge_link_id uuid primary key default gen_random_uuid(),
  knowledge_id uuid not null references knowledge_items(knowledge_id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  relationship text not null default 'related',
  created_at timestamptz not null default now(),
  constraint knowledge_links_entity_type_check check (entity_type in ('service', 'asset', 'document', 'credential'))
);

create index if not exists knowledge_items_active_updated_idx
  on knowledge_items (tenant_id, updated_at desc)
  where deleted_at is null;

create index if not exists knowledge_items_type_status_idx
  on knowledge_items (knowledge_type, status)
  where deleted_at is null;

create index if not exists knowledge_items_component_idx
  on knowledge_items (lower(component))
  where deleted_at is null and component <> '';

create index if not exists knowledge_items_source_work_item_idx
  on knowledge_items (source_work_item_id)
  where deleted_at is null and source_work_item_id is not null;

create index if not exists knowledge_items_title_idx
  on knowledge_items (lower(title))
  where deleted_at is null;

create index if not exists knowledge_links_knowledge_idx
  on knowledge_links (knowledge_id);

create index if not exists knowledge_links_entity_idx
  on knowledge_links (entity_type, entity_id);
