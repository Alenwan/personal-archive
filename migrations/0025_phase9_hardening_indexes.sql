create index if not exists communications_active_filters_idx
  on communications (
    tenant_id,
    status,
    communication_type,
    direction,
    source,
    occurred_at desc,
    created_at desc
  )
  where deleted_at is null;

create index if not exists communications_active_link_filters_idx
  on communications (
    tenant_id,
    work_item_id,
    case_id,
    party_organization_id,
    contact_id,
    asset_id,
    occurred_at desc
  )
  where deleted_at is null;

create index if not exists communications_active_external_ref_idx
  on communications (tenant_id, source, external_provider, external_reference)
  where deleted_at is null and external_reference <> '';

comment on index communications_active_filters_idx is
  'Supports Communications Inbox filtering without loading a fixed recent-row window into application memory.';

comment on index communications_active_external_ref_idx is
  'Supports safer Gmail/PBX duplicate detection by provider and external reference.';
