alter table documents
  add column if not exists document_group_id uuid;

alter table documents
  add column if not exists version_number integer;

alter table documents
  add column if not exists is_current_version boolean not null default true;

alter table documents
  add column if not exists superseded_by uuid;

alter table documents
  add column if not exists superseded_at timestamptz;

update documents
set document_group_id = document_id
where document_group_id is null;

update documents
set version_number = 1
where version_number is null;

update documents
set is_current_version = true
where is_current_version is null;

alter table documents
  alter column document_group_id set not null;

alter table documents
  alter column version_number set not null;

alter table documents
  alter column version_number set default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'documents_superseded_by_fkey'
  ) then
    alter table documents
      add constraint documents_superseded_by_fkey
      foreign key (superseded_by) references documents(document_id);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'documents_version_number_check'
  ) then
    alter table documents
      add constraint documents_version_number_check
      check (version_number >= 1);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'documents_case_group_version_key'
  ) then
    alter table documents
      add constraint documents_case_group_version_key
      unique (case_id, document_group_id, version_number);
  end if;
end $$;

create index if not exists idx_documents_group_version
  on documents (document_group_id, version_number desc);

create index if not exists idx_documents_case_current
  on documents (case_id, is_current_version)
  where deleted_at is null;

comment on column documents.document_group_id is
  'Stable logical document group. All versions of the same business document share this UUID.';

comment on column documents.version_number is
  'Sequential version number within a document group.';

comment on column documents.is_current_version is
  'True for the visible current version; older versions remain retained for audit.';

comment on column documents.superseded_by is
  'Document version that replaced this version, when applicable.';

comment on column documents.superseded_at is
  'UTC timestamp when this version was superseded.';
