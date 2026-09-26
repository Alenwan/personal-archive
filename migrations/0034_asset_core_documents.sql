create table if not exists asset_document_links (
  asset_document_link_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default '90000000-0000-4000-8000-000000000001' references tenants(tenant_id),
  asset_id uuid not null references managed_assets(asset_id) on delete cascade,
  document_id uuid not null references documents(document_id) on delete cascade,
  relationship text not null default 'Other',
  note text not null default '',
  is_pinned boolean not null default false,
  sort_order integer not null default 0,
  created_by uuid references users(user_id),
  updated_by uuid references users(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists asset_document_links_active_unique_idx
  on asset_document_links (asset_id, document_id)
  where deleted_at is null;

create index if not exists asset_document_links_asset_idx
  on asset_document_links (asset_id, is_pinned desc, sort_order, updated_at desc)
  where deleted_at is null;

create index if not exists asset_document_links_document_idx
  on asset_document_links (document_id)
  where deleted_at is null;

comment on table asset_document_links is
  'Core document links for managed assets. Documents remain stored once in Documents; this table pins important files to the asset context.';

comment on column asset_document_links.relationship is
  'Operational use for this document on the asset, such as Setup guide, Runbook, Cable / wiring, Config backup, Vendor manual, or Troubleshooting.';
