alter table service_discussion_messages
  add column if not exists thread_status text not null default 'open';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'service_discussion_thread_status_check'
  ) then
    alter table service_discussion_messages
      add constraint service_discussion_thread_status_check
      check (thread_status in ('open', 'needs-action', 'resolved', 'archived'));
  end if;
end $$;

create index if not exists service_discussion_messages_thread_status_idx
  on service_discussion_messages (thread_status, updated_at desc)
  where deleted_at is null;

create table if not exists service_discussion_asset_links (
  discussion_asset_link_id uuid primary key default gen_random_uuid(),
  message_id uuid not null references service_discussion_messages(message_id) on delete cascade,
  asset_id uuid not null references managed_assets(asset_id) on delete cascade,
  relationship text not null default 'related',
  created_by uuid references users(user_id),
  created_at timestamptz not null default now(),
  unique (message_id, asset_id)
);

create index if not exists service_discussion_asset_links_message_idx
  on service_discussion_asset_links (message_id, created_at);

create index if not exists service_discussion_asset_links_asset_idx
  on service_discussion_asset_links (asset_id, created_at);

comment on column service_discussion_messages.thread_status is
  'Thread-level workflow status for the service discussion: open, needs-action, resolved, or archived.';

comment on table service_discussion_asset_links is
  'Lightweight links from discussion messages to managed assets so operational context can be found from either side.';
