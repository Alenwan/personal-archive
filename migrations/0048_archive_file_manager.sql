create table if not exists archive_folders (
  folder_id uuid primary key,
  name text not null,
  parent_folder_id uuid references archive_folders(folder_id) on delete restrict,
  sort_order integer not null default 0,
  created_by uuid references users(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint archive_folders_name_check check (char_length(btrim(name)) between 1 and 120),
  constraint archive_folders_parent_check check (parent_folder_id is null or parent_folder_id <> folder_id)
);

create unique index if not exists archive_folders_active_name_idx
  on archive_folders (coalesce(parent_folder_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name)));

create index if not exists archive_folders_parent_idx
  on archive_folders (parent_folder_id, sort_order, lower(name));

create table if not exists archive_categories (
  category_id uuid primary key,
  name text not null,
  sort_order integer not null default 0,
  is_system boolean not null default false,
  created_by uuid references users(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint archive_categories_name_check check (char_length(btrim(name)) between 1 and 80)
);

create unique index if not exists archive_categories_name_idx
  on archive_categories (lower(btrim(name)));

create index if not exists archive_categories_sort_idx
  on archive_categories (sort_order, lower(name));

with defaults(name, sort_order) as (
  values
    ('Identity & Records', 10),
    ('Banking & Finance', 20),
    ('Family Insurance', 30),
    ('Tax', 40),
    ('Home & Property', 50),
    ('Medical', 60),
    ('Legal & Contracts', 70),
    ('Receipts & Warranties', 80),
    ('Books & Reading', 90),
    ('Discussion Attachment', 100),
    ('Other', 110)
)
insert into archive_categories (category_id, name, sort_order, is_system)
select gen_random_uuid(), defaults.name, defaults.sort_order, true
from defaults
where not exists (
  select 1 from archive_categories existing where lower(existing.name) = lower(defaults.name)
);

alter table documents drop constraint if exists documents_category_check;

alter table documents
  add column if not exists folder_id uuid references archive_folders(folder_id) on delete set null;

create index if not exists documents_archive_folder_idx
  on documents (folder_id, uploaded_at desc)
  where deleted_at is null and coalesce(is_current_version, true) = true;

create index if not exists documents_archive_trash_idx
  on documents (deleted_at desc)
  where deleted_at is not null and coalesce(is_current_version, true) = true;

comment on column documents.category is
  'File purpose. Personal Archive names are managed in archive_categories; other templates continue to validate their configured category lists.';

comment on column documents.folder_id is
  'Optional Personal Archive folder. Object-storage keys remain stable when files move between folders.';
