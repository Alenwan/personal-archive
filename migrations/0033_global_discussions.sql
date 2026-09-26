alter table service_discussion_messages
  alter column work_item_id drop not null;

alter table service_discussion_messages
  add column if not exists visibility text not null default 'team';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'service_discussion_visibility_check'
  ) then
    alter table service_discussion_messages
      add constraint service_discussion_visibility_check check (visibility in ('team'));
  end if;
end $$;

alter table documents
  alter column case_id drop not null;

create table if not exists service_discussion_mentions (
  message_id uuid not null references service_discussion_messages(message_id) on delete cascade,
  user_id uuid not null references users(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create table if not exists service_discussion_reads (
  message_id uuid not null references service_discussion_messages(message_id) on delete cascade,
  user_id uuid not null references users(user_id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index if not exists service_discussion_messages_global_created_idx
  on service_discussion_messages (created_at desc)
  where deleted_at is null;

create index if not exists service_discussion_messages_global_updated_idx
  on service_discussion_messages (updated_at desc)
  where deleted_at is null;

create index if not exists service_discussion_messages_unlinked_idx
  on service_discussion_messages (created_at desc)
  where deleted_at is null and work_item_id is null;

create index if not exists service_discussion_mentions_user_idx
  on service_discussion_mentions (user_id, created_at desc);

create index if not exists service_discussion_reads_user_idx
  on service_discussion_reads (user_id, read_at desc);

alter table saved_directory_views
  drop constraint if exists saved_directory_views_scope_check;

alter table saved_directory_views
  add constraint saved_directory_views_scope_check
  check (scope in ('contacts', 'organizations', 'documents', 'communications', 'assets', 'services', 'discussions'));

comment on column service_discussion_messages.work_item_id is
  'Optional linked service/work item. Null means the internal discussion is currently unlinked and can be associated with a service later.';

comment on column service_discussion_messages.visibility is
  'First-stage discussion visibility. V1 supports team-visible internal messages; direct/private messaging is planned separately.';

comment on table service_discussion_mentions is
  'Basic @mention records for filtering messages that mention a user. Notification delivery is handled in a later phase.';

comment on table service_discussion_reads is
  'Per-user read receipts for Discussion unread filtering.';
