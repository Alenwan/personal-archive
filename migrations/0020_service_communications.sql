create table if not exists communications (
  communication_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default '90000000-0000-4000-8000-000000000001' references tenants(tenant_id),
  case_id uuid not null references cases(case_id) on delete cascade,
  work_item_id uuid not null references work_items(work_item_id) on delete cascade,
  party_organization_id uuid references party_organizations(party_organization_id),
  contact_id uuid references contacts(contact_id),
  asset_id uuid references managed_assets(asset_id),
  communication_type text not null check (
    communication_type in (
      'Call',
      'Email',
      'SMS',
      'Voicemail',
      'Carrier / Vendor Update',
      'Customer Decision',
      'Internal Note'
    )
  ),
  direction text not null default 'Internal' check (direction in ('Inbound', 'Outbound', 'Internal')),
  subject text not null,
  body text not null default '',
  occurred_at timestamptz not null default now(),
  created_by uuid references users(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists communications_tenant_work_item_occurred_idx
  on communications (tenant_id, work_item_id, occurred_at desc)
  where deleted_at is null;

create index if not exists communications_party_organization_idx
  on communications (party_organization_id)
  where party_organization_id is not null and deleted_at is null;

create index if not exists communications_contact_idx
  on communications (contact_id)
  where contact_id is not null and deleted_at is null;

create index if not exists communications_asset_idx
  on communications (asset_id)
  where asset_id is not null and deleted_at is null;

comment on table communications is 'Manual communications history entries linked to work items/services, organizations, contacts, and optionally assets.';
