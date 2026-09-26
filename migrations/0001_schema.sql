create extension if not exists pgcrypto;

create table if not exists users (
  user_id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  role text not null check (role in ('Admin', 'Manager', 'Staff', 'ReadOnly')),
  created_at timestamptz not null default now()
);

create table if not exists cases (
  case_id uuid primary key default gen_random_uuid(),
  case_number text not null unique,
  property_address text not null,
  city text not null,
  state text not null,
  zip_code text not null,
  property_type text not null,
  sale_price_cents bigint not null default 0,
  status text not null check (status in ('New', 'Active', 'Pending', 'Closing Soon', 'Closed', 'Cancelled', 'On Hold')),
  closing_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  notes text not null default ''
);

create table if not exists contacts (
  contact_id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  company text not null default '',
  job_title text not null default '',
  email text not null,
  phone text not null default '',
  address text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists case_contacts (
  case_id uuid not null references cases(case_id) on delete cascade,
  contact_id uuid not null references contacts(contact_id) on delete cascade,
  role text not null check (role in (
    'Seller', 'Buyer', 'Seller Agent', 'Buyer Agent', 'Seller Attorney', 'Buyer Attorney',
    'Bank', 'Bank Attorney', 'Title Company', 'Inspector', 'Other'
  )),
  created_at timestamptz not null default now(),
  primary key (case_id, contact_id, role)
);

create table if not exists documents (
  document_id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases(case_id) on delete cascade,
  file_name text not null,
  original_file_name text not null,
  file_size bigint not null,
  mime_type text not null,
  category text not null check (category in (
    'Contract', 'Seller Documents', 'Buyer Documents', 'Bank Documents', 'Attorney Documents',
    'Title Documents', 'Inspection', 'Closing Documents', 'Other'
  )),
  r2_object_key text not null unique,
  uploaded_at timestamptz not null default now(),
  uploaded_by uuid not null references users(user_id),
  tags text[] not null default '{}',
  notes text not null default '',
  deleted_at timestamptz
);

create table if not exists tags (
  tag_id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color text not null default '#2c827f'
);

create table if not exists case_tags (
  case_id uuid not null references cases(case_id) on delete cascade,
  tag_id uuid not null references tags(tag_id) on delete cascade,
  primary key (case_id, tag_id)
);

create table if not exists document_tags (
  document_id uuid not null references documents(document_id) on delete cascade,
  tag_id uuid not null references tags(tag_id) on delete cascade,
  primary key (document_id, tag_id)
);

create table if not exists notes (
  note_id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases(case_id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references users(user_id)
);

create table if not exists tasks (
  task_id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases(case_id) on delete cascade,
  title text not null,
  description text not null default '',
  status text not null default 'Open' check (status in ('Open', 'In Progress', 'Blocked', 'Done')),
  due_date date not null,
  assigned_to uuid references users(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists audit_logs (
  audit_log_id uuid primary key default gen_random_uuid(),
  action text not null,
  entity_type text not null,
  entity_id uuid not null,
  user_id uuid not null references users(user_id),
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_cases_status on cases(status);
create index if not exists idx_cases_closing_date on cases(closing_date);
create index if not exists idx_contacts_name on contacts(last_name, first_name);
create index if not exists idx_documents_case_category on documents(case_id, category);
create index if not exists idx_audit_logs_created_at on audit_logs(created_at desc);
