alter table cases
  add column if not exists party_organization_id uuid references party_organizations(party_organization_id);

create index if not exists idx_cases_party_organization
  on cases(party_organization_id)
  where party_organization_id is not null;

alter table managed_assets
  add column if not exists parent_asset_id uuid references managed_assets(asset_id);

create index if not exists idx_managed_assets_parent_asset
  on managed_assets(parent_asset_id)
  where parent_asset_id is not null;

comment on column cases.party_organization_id is 'Optional direct customer/organization association for service-oriented templates such as MD3 Service.';
comment on column managed_assets.parent_asset_id is 'Optional hosted-on/runs-on relationship for infrastructure assets, such as a container service running on a Docker host.';
