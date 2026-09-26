alter table service_discussion_messages
  add column if not exists title varchar(200);

update service_discussion_messages
set title = left(
  coalesce(
    nullif(
      btrim(
        regexp_replace(
          regexp_replace(body_text, '<[^>]+>', ' ', 'g'),
          '[[:space:]]+',
          ' ',
          'g'
        )
      ),
      ''
    ),
    'Untitled note'
  ),
  200
)
where parent_message_id is null
  and (title is null or btrim(title) = '');

create index if not exists service_discussion_messages_title_idx
  on service_discussion_messages (lower(title))
  where deleted_at is null and parent_message_id is null;

comment on column service_discussion_messages.title is
  'Human-readable title for a top-level discussion thread or personal reading note; replies may leave it null.';
