create extension if not exists pgcrypto;

create table if not exists organizations (
  organization_id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text not null default '',
  slug text not null unique,
  timezone text not null default 'America/New_York',
  default_locale text not null default 'en-US',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into organizations (organization_id, name, legal_name, slug, timezone, default_locale, created_at, updated_at)
values (
  '90000000-0000-4000-8000-000000000001',
  'RealtyCase Demo Organization',
  'MD3 RealtyCase Demo',
  'realtycase-demo',
  'America/New_York',
  'en-US',
  '2026-04-29T12:00:00Z',
  '2026-04-29T12:00:00Z'
)
on conflict (slug) do update set
  name = excluded.name,
  legal_name = excluded.legal_name,
  timezone = excluded.timezone,
  default_locale = excluded.default_locale,
  updated_at = now();

create table if not exists offices (
  office_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(organization_id),
  name text not null,
  address text not null default '',
  phone text not null default '',
  timezone text not null default 'America/New_York',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

insert into offices (office_id, organization_id, name, address, phone, timezone, created_at, updated_at)
values (
  '90000000-0000-4000-8000-000000000101',
  '90000000-0000-4000-8000-000000000001',
  'New York Demo Office',
  'New York, NY',
  '',
  'America/New_York',
  '2026-04-29T12:00:00Z',
  '2026-04-29T12:00:00Z'
)
on conflict (organization_id, name) do update set
  address = excluded.address,
  timezone = excluded.timezone,
  is_active = true,
  updated_at = now();

create table if not exists teams (
  team_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(organization_id),
  name text not null,
  description text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

insert into teams (team_id, organization_id, name, description, created_at, updated_at)
values
  (
    '90000000-0000-4000-8000-000000000201',
    '90000000-0000-4000-8000-000000000001',
    'Closing Team',
    'Demo team responsible for closing coordination, checklist progress, and transaction readiness.',
    '2026-04-29T12:00:00Z',
    '2026-04-29T12:00:00Z'
  ),
  (
    '90000000-0000-4000-8000-000000000202',
    '90000000-0000-4000-8000-000000000001',
    'Document Review Team',
    'Demo team responsible for uploaded file review, categorization, and future digitization workflows.',
    '2026-04-29T12:00:00Z',
    '2026-04-29T12:00:00Z'
  )
on conflict (organization_id, name) do update set
  description = excluded.description,
  is_active = true,
  updated_at = now();

create table if not exists team_memberships (
  team_id uuid not null references teams(team_id) on delete cascade,
  user_id uuid not null references users(user_id) on delete cascade,
  membership_role text not null default 'Member',
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

alter table users add column if not exists organization_id uuid;
alter table cases add column if not exists organization_id uuid;
alter table cases add column if not exists office_id uuid;
alter table cases add column if not exists primary_owner_user_id uuid;
alter table cases add column if not exists assigned_team_id uuid;
alter table contacts add column if not exists organization_id uuid;
alter table documents add column if not exists organization_id uuid;
alter table tags add column if not exists organization_id uuid;
alter table notes add column if not exists organization_id uuid;
alter table tasks add column if not exists organization_id uuid;
alter table audit_logs add column if not exists organization_id uuid;

update users set organization_id = '90000000-0000-4000-8000-000000000001' where organization_id is null;
update cases
set
  organization_id = '90000000-0000-4000-8000-000000000001',
  office_id = '90000000-0000-4000-8000-000000000101'
where organization_id is null or office_id is null;
update contacts set organization_id = '90000000-0000-4000-8000-000000000001' where organization_id is null;
update documents set organization_id = '90000000-0000-4000-8000-000000000001' where organization_id is null;
update tags set organization_id = '90000000-0000-4000-8000-000000000001' where organization_id is null;
update notes set organization_id = '90000000-0000-4000-8000-000000000001' where organization_id is null;
update tasks set organization_id = '90000000-0000-4000-8000-000000000001' where organization_id is null;
update audit_logs set organization_id = '90000000-0000-4000-8000-000000000001' where organization_id is null;

alter table users alter column organization_id set default '90000000-0000-4000-8000-000000000001';
alter table cases alter column organization_id set default '90000000-0000-4000-8000-000000000001';
alter table cases alter column office_id set default '90000000-0000-4000-8000-000000000101';
alter table contacts alter column organization_id set default '90000000-0000-4000-8000-000000000001';
alter table documents alter column organization_id set default '90000000-0000-4000-8000-000000000001';
alter table tags alter column organization_id set default '90000000-0000-4000-8000-000000000001';
alter table notes alter column organization_id set default '90000000-0000-4000-8000-000000000001';
alter table tasks alter column organization_id set default '90000000-0000-4000-8000-000000000001';
alter table audit_logs alter column organization_id set default '90000000-0000-4000-8000-000000000001';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'users_organization_id_fkey') then
    alter table users add constraint users_organization_id_fkey foreign key (organization_id) references organizations(organization_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cases_organization_id_fkey') then
    alter table cases add constraint cases_organization_id_fkey foreign key (organization_id) references organizations(organization_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cases_office_id_fkey') then
    alter table cases add constraint cases_office_id_fkey foreign key (office_id) references offices(office_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cases_primary_owner_user_id_fkey') then
    alter table cases add constraint cases_primary_owner_user_id_fkey foreign key (primary_owner_user_id) references users(user_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cases_assigned_team_id_fkey') then
    alter table cases add constraint cases_assigned_team_id_fkey foreign key (assigned_team_id) references teams(team_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contacts_organization_id_fkey') then
    alter table contacts add constraint contacts_organization_id_fkey foreign key (organization_id) references organizations(organization_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'documents_organization_id_fkey') then
    alter table documents add constraint documents_organization_id_fkey foreign key (organization_id) references organizations(organization_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tags_organization_id_fkey') then
    alter table tags add constraint tags_organization_id_fkey foreign key (organization_id) references organizations(organization_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'notes_organization_id_fkey') then
    alter table notes add constraint notes_organization_id_fkey foreign key (organization_id) references organizations(organization_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tasks_organization_id_fkey') then
    alter table tasks add constraint tasks_organization_id_fkey foreign key (organization_id) references organizations(organization_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'audit_logs_organization_id_fkey') then
    alter table audit_logs add constraint audit_logs_organization_id_fkey foreign key (organization_id) references organizations(organization_id);
  end if;
end $$;

create table if not exists roles (
  role_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(organization_id),
  code text not null,
  name text not null,
  description text not null default '',
  is_system boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);

create table if not exists permissions (
  permission_id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists role_permissions (
  role_id uuid not null references roles(role_id) on delete cascade,
  permission_id uuid not null references permissions(permission_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_id)
);

create table if not exists user_roles (
  user_id uuid not null references users(user_id) on delete cascade,
  role_id uuid not null references roles(role_id) on delete cascade,
  organization_id uuid not null references organizations(organization_id),
  created_at timestamptz not null default now(),
  primary key (user_id, role_id, organization_id)
);

create table if not exists case_assignments (
  case_id uuid not null references cases(case_id) on delete cascade,
  user_id uuid references users(user_id) on delete cascade,
  team_id uuid references teams(team_id) on delete cascade,
  assignment_role text not null default 'Owner',
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  check (user_id is not null or team_id is not null)
);

create unique index if not exists idx_case_assignments_unique_user
  on case_assignments(case_id, user_id, assignment_role)
  where user_id is not null;

create unique index if not exists idx_case_assignments_unique_team
  on case_assignments(case_id, team_id, assignment_role)
  where team_id is not null;

insert into roles (role_id, organization_id, code, name, description, is_system, created_at, updated_at)
values
  ('90000000-0000-4000-8000-000000000301', '90000000-0000-4000-8000-000000000001', 'admin', 'Admin', 'Full system access for organization administrators.', true, '2026-04-29T12:00:00Z', '2026-04-29T12:00:00Z'),
  ('90000000-0000-4000-8000-000000000302', '90000000-0000-4000-8000-000000000001', 'manager', 'Manager', 'Case, contact, document, tag, note, and task management.', true, '2026-04-29T12:00:00Z', '2026-04-29T12:00:00Z'),
  ('90000000-0000-4000-8000-000000000303', '90000000-0000-4000-8000-000000000001', 'staff', 'Staff', 'Operational access for viewing, uploading documents, adding notes, and updating tasks.', true, '2026-04-29T12:00:00Z', '2026-04-29T12:00:00Z'),
  ('90000000-0000-4000-8000-000000000304', '90000000-0000-4000-8000-000000000001', 'readonly', 'ReadOnly', 'View-only access with document download permission.', true, '2026-04-29T12:00:00Z', '2026-04-29T12:00:00Z')
on conflict (organization_id, code) do update set
  name = excluded.name,
  description = excluded.description,
  is_system = excluded.is_system,
  is_active = true,
  updated_at = now();

insert into permissions (code, description)
values
  ('dashboard.view', 'View operational dashboard.'),
  ('search.view', 'Use global search.'),
  ('case.view', 'View cases.'),
  ('case.create', 'Create cases.'),
  ('case.update', 'Update case details.'),
  ('case.close', 'Close cases.'),
  ('contact.view', 'View contacts.'),
  ('contact.create', 'Create contacts.'),
  ('contact.update', 'Update contacts.'),
  ('document.view', 'View document metadata.'),
  ('document.upload', 'Upload documents.'),
  ('document.download', 'Download documents.'),
  ('document.delete', 'Delete documents.'),
  ('tag.view', 'View tags.'),
  ('tag.create', 'Create tags.'),
  ('note.view', 'View notes.'),
  ('note.create', 'Create notes.'),
  ('task.view', 'View tasks.'),
  ('task.create', 'Create tasks.'),
  ('task.update', 'Update tasks.'),
  ('audit.view', 'View audit logs.'),
  ('user.view', 'View users.'),
  ('user.manage', 'Manage users and permissions.'),
  ('report.export', 'Export reports.')
on conflict (code) do update set description = excluded.description;

insert into role_permissions (role_id, permission_id)
select r.role_id, p.permission_id
from roles r
cross join permissions p
where r.organization_id = '90000000-0000-4000-8000-000000000001'
  and r.code = 'admin'
on conflict do nothing;

insert into role_permissions (role_id, permission_id)
select r.role_id, p.permission_id
from roles r
join permissions p on p.code in (
  'dashboard.view', 'search.view',
  'case.view', 'case.create', 'case.update', 'case.close',
  'contact.view', 'contact.create', 'contact.update',
  'document.view', 'document.upload', 'document.download', 'document.delete',
  'tag.view', 'tag.create',
  'note.view', 'note.create',
  'task.view', 'task.create', 'task.update',
  'user.view',
  'report.export'
)
where r.organization_id = '90000000-0000-4000-8000-000000000001'
  and r.code = 'manager'
on conflict do nothing;

insert into role_permissions (role_id, permission_id)
select r.role_id, p.permission_id
from roles r
join permissions p on p.code in (
  'dashboard.view', 'search.view',
  'case.view',
  'contact.view',
  'document.view', 'document.upload', 'document.download',
  'tag.view',
  'note.view', 'note.create',
  'task.view', 'task.update'
)
where r.organization_id = '90000000-0000-4000-8000-000000000001'
  and r.code = 'staff'
on conflict do nothing;

insert into role_permissions (role_id, permission_id)
select r.role_id, p.permission_id
from roles r
join permissions p on p.code in (
  'dashboard.view', 'search.view',
  'case.view',
  'contact.view',
  'document.view', 'document.download',
  'tag.view',
  'note.view',
  'task.view'
)
where r.organization_id = '90000000-0000-4000-8000-000000000001'
  and r.code = 'readonly'
on conflict do nothing;

insert into user_roles (user_id, role_id, organization_id)
select u.user_id, r.role_id, u.organization_id
from users u
join roles r on r.organization_id = u.organization_id and r.code = lower(u.role)
on conflict do nothing;

insert into team_memberships (team_id, user_id, membership_role)
select t.team_id, u.user_id, case when u.role in ('Admin', 'Manager') then 'Lead' else 'Member' end
from teams t
cross join users u
where t.organization_id = '90000000-0000-4000-8000-000000000001'
  and t.name in ('Closing Team', 'Document Review Team')
  and u.organization_id = '90000000-0000-4000-8000-000000000001'
  and u.role in ('Admin', 'Manager', 'Staff')
on conflict do nothing;

create table if not exists case_number_sequences (
  organization_id uuid not null references organizations(organization_id),
  year integer not null,
  prefix text not null default 'RC',
  next_sequence integer not null default 1001,
  updated_at timestamptz not null default now(),
  primary key (organization_id, year, prefix),
  check (year >= 2000),
  check (next_sequence > 0)
);

insert into case_number_sequences (organization_id, year, prefix, next_sequence)
select
  '90000000-0000-4000-8000-000000000001'::uuid as organization_id,
  parsed.year_value,
  'RC' as prefix,
  max(parsed.sequence_value) + 1 as next_sequence
from (
  select
    substring(case_number from '^RC-([0-9]{4})-[0-9]+$')::integer as year_value,
    substring(case_number from '^RC-[0-9]{4}-([0-9]+)$')::integer as sequence_value
  from cases
  where case_number ~ '^RC-[0-9]{4}-[0-9]+$'
) parsed
where parsed.year_value is not null and parsed.sequence_value is not null
group by parsed.year_value
on conflict (organization_id, year, prefix) do update set
  next_sequence = greatest(case_number_sequences.next_sequence, excluded.next_sequence),
  updated_at = now();

insert into case_number_sequences (organization_id, year, prefix, next_sequence)
values (
  '90000000-0000-4000-8000-000000000001',
  extract(year from now())::integer,
  'RC',
  1001
)
on conflict (organization_id, year, prefix) do nothing;

create index if not exists idx_users_organization on users(organization_id);
create index if not exists idx_cases_organization_updated on cases(organization_id, updated_at desc);
create index if not exists idx_cases_organization_status on cases(organization_id, status);
create index if not exists idx_cases_office on cases(office_id);
create index if not exists idx_cases_owner on cases(primary_owner_user_id);
create index if not exists idx_cases_assigned_team on cases(assigned_team_id);
create index if not exists idx_contacts_organization on contacts(organization_id);
create index if not exists idx_documents_organization on documents(organization_id);
create index if not exists idx_tags_organization on tags(organization_id);
create index if not exists idx_notes_organization on notes(organization_id);
create index if not exists idx_tasks_organization on tasks(organization_id);
create index if not exists idx_audit_logs_organization_created on audit_logs(organization_id, created_at desc);

comment on table organizations is 'Tenant or client organization. Demo currently uses one default organization.';
comment on table offices is 'Organization locations or branches for future office-level reporting and permissions.';
comment on table teams is 'Operational teams such as closing coordination and document review.';
comment on table roles is 'Configurable role definitions for future production RBAC.';
comment on table permissions is 'Atomic permission codes used by role_permissions.';
comment on table case_number_sequences is 'Server-side human-readable case number generation by organization, year, and prefix.';
