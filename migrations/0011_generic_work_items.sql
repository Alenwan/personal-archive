create table if not exists tenants (
  tenant_id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text not null default '',
  slug text not null unique,
  timezone text not null default 'America/New_York',
  default_locale text not null default 'en-US',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into tenants (tenant_id, name, legal_name, slug, timezone, default_locale, created_at, updated_at)
select organization_id, name, legal_name, slug, timezone, default_locale, created_at, updated_at
from organizations
on conflict (tenant_id) do update set
  name = excluded.name,
  legal_name = excluded.legal_name,
  slug = excluded.slug,
  timezone = excluded.timezone,
  default_locale = excluded.default_locale,
  updated_at = now();

insert into tenants (tenant_id, name, legal_name, slug, timezone, default_locale)
values (
  '90000000-0000-4000-8000-000000000001',
  'RealtyCase Demo Workspace',
  'MD3 RealtyCase Demo',
  'realtycase-demo',
  'America/New_York',
  'en-US'
)
on conflict (tenant_id) do nothing;

create table if not exists work_item_types (
  tenant_id uuid not null default '90000000-0000-4000-8000-000000000001' references tenants(tenant_id),
  type_code text not null,
  display_name text not null,
  object_label text not null default 'Case',
  description text not null default '',
  number_prefix text not null default 'RC',
  required_document_categories text[] not null default '{}',
  checklist_template jsonb not null default '[]'::jsonb,
  readiness_enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, type_code)
);

insert into work_item_types (
  tenant_id,
  type_code,
  display_name,
  object_label,
  description,
  number_prefix,
  required_document_categories,
  checklist_template,
  readiness_enabled,
  config,
  sort_order,
  is_active,
  created_at,
  updated_at
)
select
  t.tenant_id,
  ctt.case_type_code,
  ctt.display_name,
  'Case',
  ctt.description,
  'RC',
  ctt.required_document_categories,
  ctt.checklist_template,
  ctt.closing_readiness_enabled,
  jsonb_build_object(
    'templateFamily', 'realtycase',
    'primaryDateLabel', 'Closing date',
    'primaryValueLabel', 'Sale price',
    'primaryLocationLabel', 'Property'
  ),
  ctt.sort_order,
  ctt.is_active,
  ctt.created_at,
  ctt.updated_at
from tenants t
cross join case_type_templates ctt
on conflict (tenant_id, type_code) do update set
  display_name = excluded.display_name,
  object_label = excluded.object_label,
  description = excluded.description,
  number_prefix = excluded.number_prefix,
  required_document_categories = excluded.required_document_categories,
  checklist_template = excluded.checklist_template,
  readiness_enabled = excluded.readiness_enabled,
  config = excluded.config,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active,
  updated_at = now();

create table if not exists work_items (
  work_item_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default '90000000-0000-4000-8000-000000000001' references tenants(tenant_id),
  work_item_type_code text not null default 'residential_purchase',
  number text not null,
  title text not null,
  status text not null,
  priority text not null default 'normal',
  target_date date,
  value_cents bigint not null default 0,
  currency text not null default 'USD',
  primary_location_text text not null default '',
  summary text not null default '',
  custom_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  closed_at timestamptz,
  foreign key (tenant_id, work_item_type_code) references work_item_types(tenant_id, type_code),
  unique (tenant_id, number)
);

insert into work_items (
  work_item_id,
  tenant_id,
  work_item_type_code,
  number,
  title,
  status,
  target_date,
  value_cents,
  currency,
  primary_location_text,
  summary,
  custom_fields,
  created_at,
  updated_at,
  deleted_at,
  closed_at
)
select
  case_id,
  coalesce(organization_id, '90000000-0000-4000-8000-000000000001'::uuid),
  coalesce(case_type_code, 'residential_purchase'),
  case_number,
  property_address,
  status,
  closing_date,
  sale_price_cents,
  'USD',
  trim(concat_ws(', ', nullif(property_address, ''), nullif(city, ''), nullif(state || ' ' || zip_code, ' '))),
  notes,
  jsonb_build_object(
    'realtyCase', true,
    'propertyAddress', property_address,
    'city', city,
    'state', state,
    'zipCode', zip_code,
    'propertyType', property_type
  ),
  created_at,
  updated_at,
  deleted_at,
  case when status = 'Closed' then updated_at else null end
from cases
on conflict (work_item_id) do update set
  tenant_id = excluded.tenant_id,
  work_item_type_code = excluded.work_item_type_code,
  number = excluded.number,
  title = excluded.title,
  status = excluded.status,
  target_date = excluded.target_date,
  value_cents = excluded.value_cents,
  primary_location_text = excluded.primary_location_text,
  summary = excluded.summary,
  custom_fields = excluded.custom_fields,
  updated_at = excluded.updated_at,
  deleted_at = excluded.deleted_at,
  closed_at = excluded.closed_at;

create table if not exists work_item_participants (
  participant_id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null references work_items(work_item_id) on delete cascade,
  contact_id uuid references contacts(contact_id) on delete cascade,
  party_organization_id uuid references party_organizations(party_organization_id) on delete cascade,
  role text not null,
  is_primary boolean not null default false,
  notes text not null default '',
  created_at timestamptz not null default now(),
  check (contact_id is not null or party_organization_id is not null)
);

create unique index if not exists work_item_participants_contact_unique_idx
  on work_item_participants(work_item_id, contact_id, role)
  where contact_id is not null;

create unique index if not exists work_item_participants_party_unique_idx
  on work_item_participants(work_item_id, party_organization_id, role)
  where party_organization_id is not null;

insert into work_item_participants (work_item_id, contact_id, role, created_at)
select case_id, contact_id, role, created_at
from case_contacts
on conflict do nothing;

create table if not exists work_item_tags (
  work_item_id uuid not null references work_items(work_item_id) on delete cascade,
  tag_id uuid not null references tags(tag_id) on delete cascade,
  primary key (work_item_id, tag_id)
);

insert into work_item_tags (work_item_id, tag_id)
select case_id, tag_id
from case_tags
on conflict do nothing;

create table if not exists work_item_assignments (
  work_item_id uuid not null references work_items(work_item_id) on delete cascade,
  user_id uuid references users(user_id) on delete cascade,
  team_id uuid references teams(team_id) on delete cascade,
  assignment_role text not null default 'Owner',
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  check (user_id is not null or team_id is not null)
);

create unique index if not exists work_item_assignments_unique_user_idx
  on work_item_assignments(work_item_id, user_id, assignment_role)
  where user_id is not null;

create unique index if not exists work_item_assignments_unique_team_idx
  on work_item_assignments(work_item_id, team_id, assignment_role)
  where team_id is not null;

insert into work_item_assignments (work_item_id, user_id, team_id, assignment_role, is_primary, created_at)
select case_id, user_id, team_id, assignment_role, is_primary, created_at
from case_assignments
on conflict do nothing;

create table if not exists work_item_number_sequences (
  tenant_id uuid not null references tenants(tenant_id),
  year integer not null,
  prefix text not null default 'RC',
  next_sequence integer not null default 1001,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, year, prefix),
  check (year >= 2000),
  check (next_sequence > 0)
);

insert into work_item_number_sequences (tenant_id, year, prefix, next_sequence, updated_at)
select organization_id, year, prefix, next_sequence, updated_at
from case_number_sequences
on conflict (tenant_id, year, prefix) do update set
  next_sequence = greatest(work_item_number_sequences.next_sequence, excluded.next_sequence),
  updated_at = now();

alter table party_organizations add column if not exists tenant_id uuid;
update party_organizations
set tenant_id = coalesce(tenant_id, organization_id, '90000000-0000-4000-8000-000000000001'::uuid);
alter table party_organizations alter column tenant_id set default '90000000-0000-4000-8000-000000000001';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'party_organizations_tenant_id_fkey') then
    alter table party_organizations
      add constraint party_organizations_tenant_id_fkey
      foreign key (tenant_id) references tenants(tenant_id);
  end if;
end $$;

create unique index if not exists party_organizations_active_tenant_name_idx
  on party_organizations(tenant_id, lower(name))
  where deleted_at is null;

alter table documents add column if not exists work_item_id uuid;
update documents set work_item_id = case_id where work_item_id is null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'documents_work_item_id_fkey') then
    alter table documents
      add constraint documents_work_item_id_fkey
      foreign key (work_item_id) references work_items(work_item_id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'documents_work_item_group_version_key') then
    alter table documents
      add constraint documents_work_item_group_version_key
      unique (work_item_id, document_group_id, version_number);
  end if;
end $$;

alter table notes add column if not exists work_item_id uuid;
update notes set work_item_id = case_id where work_item_id is null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'notes_work_item_id_fkey') then
    alter table notes
      add constraint notes_work_item_id_fkey
      foreign key (work_item_id) references work_items(work_item_id);
  end if;
end $$;

alter table tasks add column if not exists work_item_id uuid;
update tasks set work_item_id = case_id where work_item_id is null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_work_item_id_fkey') then
    alter table tasks
      add constraint tasks_work_item_id_fkey
      foreign key (work_item_id) references work_items(work_item_id);
  end if;
end $$;

create index if not exists idx_work_items_tenant_updated on work_items(tenant_id, updated_at desc);
create index if not exists idx_work_items_tenant_status on work_items(tenant_id, status);
create index if not exists idx_work_items_type on work_items(tenant_id, work_item_type_code);
create index if not exists idx_work_items_target_date on work_items(target_date);
create index if not exists idx_documents_work_item_category on documents(work_item_id, category);
create index if not exists idx_documents_work_item_review on documents(work_item_id, review_status);
create index if not exists idx_notes_work_item on notes(work_item_id);
create index if not exists idx_tasks_work_item on tasks(work_item_id);

comment on table tenants is 'Internal customer workspace or tenant. Replaces the old internal organizations naming for active platform code.';
comment on table work_items is 'Generic operational record. RealtyCase displays these as cases; future templates may display them as service requests, orders, matters, or work orders.';
comment on table work_item_types is 'Template metadata for work item behavior, labels, numbering, required documents, and default checklist tasks.';
comment on table work_item_participants is 'Reusable relationship table linking work items to contacts and external party organizations.';
