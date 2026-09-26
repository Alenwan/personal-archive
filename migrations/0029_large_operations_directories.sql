alter table saved_directory_views
  drop constraint if exists saved_directory_views_scope_check;

alter table saved_directory_views
  add constraint saved_directory_views_scope_check
  check (scope in ('contacts', 'organizations', 'documents', 'communications', 'assets', 'services'));

create index if not exists work_items_active_directory_idx
  on work_items (tenant_id, status, work_item_type_code, target_date, updated_at desc)
  where deleted_at is null;

create index if not exists work_items_archive_directory_idx
  on work_items (tenant_id, deleted_at, updated_at desc);

create index if not exists work_item_participants_role_work_item_idx
  on work_item_participants (role, work_item_id);

create index if not exists case_tags_case_tag_idx
  on case_tags (case_id, tag_id);

create index if not exists managed_assets_active_directory_idx
  on managed_assets (tenant_id, status, asset_type, updated_at desc)
  where deleted_at is null;

create index if not exists managed_assets_relationship_directory_idx
  on managed_assets (tenant_id, party_organization_id, work_item_id, parent_asset_id, updated_at desc)
  where deleted_at is null;

create index if not exists asset_credentials_asset_active_idx
  on asset_credentials (asset_id)
  where deleted_at is null;

create index if not exists communications_active_followup_idx
  on communications (tenant_id, follow_up_assigned_to, follow_up_due_date, occurred_at desc)
  where deleted_at is null and status = 'Needs follow-up';

create index if not exists communications_active_occurred_idx
  on communications (tenant_id, communication_type, direction, source, status, occurred_at desc)
  where deleted_at is null;
