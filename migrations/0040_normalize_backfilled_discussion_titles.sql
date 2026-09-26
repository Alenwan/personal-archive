with title_candidates as (
  select
    message_id,
    case
      when body_text ~* '<h[1-6][^>]*>' then
        regexp_replace(
          substring(body_text from '(?is)<h[1-6][^>]*>(.*?)</h[1-6]>'),
          '<[^>]+>',
          ' ',
          'g'
        )
      when body_text ~* '<(p|div|li)[^>]*>' then
        regexp_replace(
          substring(body_text from '(?is)<(?:p|div|li)[^>]*>(.*?)</(?:p|div|li)>'),
          '<[^>]+>',
          ' ',
          'g'
        )
      else
        regexp_replace(
          split_part(btrim(body_text), E'\n', 1),
          '^#{1,6}[[:space:]]*',
          ''
        )
    end as candidate
  from service_discussion_messages
  where parent_message_id is null
    and deleted_at is null
)
update service_discussion_messages as message
set title = left(
  coalesce(
    nullif(
      btrim(
        regexp_replace(
          replace(
            replace(
              replace(
                replace(title_candidates.candidate, '&nbsp;', ' '),
                '&amp;',
                '&'
              ),
              '&lt;',
              '<'
            ),
            '&gt;',
            '>'
          ),
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
from title_candidates
where message.message_id = title_candidates.message_id;
