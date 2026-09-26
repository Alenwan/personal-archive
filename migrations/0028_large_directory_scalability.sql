create table if not exists saved_directory_views (
  saved_view_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default '90000000-0000-4000-8000-000000000001' references tenants(tenant_id),
  scope text not null check (scope in ('contacts', 'organizations', 'documents')),
  name text not null,
  filters jsonb not null default '{}'::jsonb,
  sort text not null default '',
  page_size integer not null default 25 check (page_size between 10 and 100),
  is_default boolean not null default false,
  created_by uuid references users(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists saved_directory_views_active_user_name_idx
  on saved_directory_views(tenant_id, scope, created_by, lower(name))
  where deleted_at is null;

create unique index if not exists saved_directory_views_active_user_default_idx
  on saved_directory_views(tenant_id, scope, created_by)
  where deleted_at is null and is_default = true;

create index if not exists contacts_active_updated_idx
  on contacts(updated_at desc)
  where deleted_at is null;

create index if not exists contacts_active_name_idx
  on contacts(lower(coalesce(nullif(display_name, ''), trim(first_name || ' ' || last_name))))
  where deleted_at is null;

create index if not exists contacts_active_phone_digits_idx
  on contacts(regexp_replace(coalesce(phone, ''), '[^0-9]+', '', 'g'))
  where deleted_at is null;

create index if not exists contact_organization_affiliations_primary_idx
  on contact_organization_affiliations(contact_id, party_organization_id)
  where is_primary = true;

create index if not exists party_organizations_active_name_idx
  on party_organizations(tenant_id, lower(name))
  where deleted_at is null;

create index if not exists party_organizations_active_updated_idx
  on party_organizations(tenant_id, updated_at desc)
  where deleted_at is null;

create index if not exists party_organizations_active_phone_digits_idx
  on party_organizations(tenant_id, regexp_replace(coalesce(phone, ''), '[^0-9]+', '', 'g'))
  where deleted_at is null;

create index if not exists documents_active_work_item_uploaded_idx
  on documents(coalesce(work_item_id, case_id), uploaded_at desc)
  where deleted_at is null and coalesce(is_current_version, true) = true;

create index if not exists documents_active_review_category_uploaded_idx
  on documents(review_status, category, uploaded_at desc)
  where deleted_at is null and coalesce(is_current_version, true) = true;

create index if not exists documents_active_uploaded_idx
  on documents(uploaded_at desc)
  where deleted_at is null and coalesce(is_current_version, true) = true;

create index if not exists document_tags_tag_document_idx
  on document_tags(tag_id, document_id);
