create table if not exists managed_assets (
  asset_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default '90000000-0000-4000-8000-000000000001' references tenants(tenant_id),
  party_organization_id uuid references party_organizations(party_organization_id),
  work_item_id uuid references work_items(work_item_id),
  name text not null,
  asset_type text not null default 'Other',
  status text not null default 'Active',
  manufacturer text not null default '',
  model text not null default '',
  serial_number text not null default '',
  mac_address text not null default '',
  imei text not null default '',
  iccid text not null default '',
  phone_number text not null default '',
  extension text not null default '',
  hostname text not null default '',
  lan_ip text not null default '',
  wan_ip text not null default '',
  installed_location text not null default '',
  installed_at date,
  last_service_at date,
  notes text not null default '',
  created_by uuid references users(user_id),
  updated_by uuid references users(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists asset_credentials (
  credential_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default '90000000-0000-4000-8000-000000000001' references tenants(tenant_id),
  asset_id uuid not null references managed_assets(asset_id) on delete cascade,
  party_organization_id uuid references party_organizations(party_organization_id),
  work_item_id uuid references work_items(work_item_id),
  label text not null,
  credential_type text not null default 'Other',
  username text not null default '',
  login_url text not null default '',
  host text not null default '',
  notes text not null default '',
  encrypted_secret text not null default '',
  secret_iv text not null default '',
  secret_tag text not null default '',
  encrypted_private_notes text not null default '',
  private_notes_iv text not null default '',
  private_notes_tag text not null default '',
  encryption_algorithm text not null default 'AES-256-GCM',
  last_verified_at date,
  rotation_due_at date,
  created_by uuid references users(user_id),
  updated_by uuid references users(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_managed_assets_tenant_updated on managed_assets(tenant_id, updated_at desc);
create index if not exists idx_managed_assets_tenant_type on managed_assets(tenant_id, asset_type);
create index if not exists idx_managed_assets_tenant_status on managed_assets(tenant_id, status);
create index if not exists idx_managed_assets_party_organization on managed_assets(party_organization_id);
create index if not exists idx_managed_assets_work_item on managed_assets(work_item_id);
create index if not exists idx_asset_credentials_asset on asset_credentials(asset_id, deleted_at);
create index if not exists idx_asset_credentials_party_organization on asset_credentials(party_organization_id);
create index if not exists idx_asset_credentials_work_item on asset_credentials(work_item_id);

insert into permissions (code, description)
values
  ('asset.view', 'View managed assets.'),
  ('asset.create', 'Create managed assets.'),
  ('asset.update', 'Update managed assets.'),
  ('asset.delete', 'Archive managed assets.'),
  ('credential.view', 'View credential metadata.'),
  ('credential.create', 'Create encrypted credentials.'),
  ('credential.update', 'Update encrypted credentials.'),
  ('credential.delete', 'Archive encrypted credentials.'),
  ('credential.reveal', 'Reveal or copy decrypted credentials.')
on conflict (code) do update set description = excluded.description;

insert into role_permissions (role_id, permission_id)
select r.role_id, p.permission_id
from roles r
cross join permissions p
where r.organization_id = '90000000-0000-4000-8000-000000000001'
  and r.code = 'admin'
  and p.code in (
    'asset.view', 'asset.create', 'asset.update', 'asset.delete',
    'credential.view', 'credential.create', 'credential.update', 'credential.delete', 'credential.reveal'
  )
on conflict do nothing;

insert into role_permissions (role_id, permission_id)
select r.role_id, p.permission_id
from roles r
join permissions p on p.code in (
  'asset.view', 'asset.create', 'asset.update', 'asset.delete',
  'credential.view', 'credential.create', 'credential.update', 'credential.delete', 'credential.reveal'
)
where r.organization_id = '90000000-0000-4000-8000-000000000001'
  and r.code = 'manager'
on conflict do nothing;

insert into role_permissions (role_id, permission_id)
select r.role_id, p.permission_id
from roles r
join permissions p on p.code in ('asset.view', 'credential.view')
where r.organization_id = '90000000-0000-4000-8000-000000000001'
  and r.code in ('staff', 'readonly')
on conflict do nothing;

comment on table managed_assets is 'MD3 managed devices, lines, accounts, numbers, systems, and other operational assets. These are separate from contacts and organizations.';
comment on table asset_credentials is 'Encrypted credential records for assets. Secrets are encrypted at application level with the deployment credential key.';
