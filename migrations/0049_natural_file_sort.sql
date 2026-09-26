create or replace function personal_archive_natural_sort_key(value text)
returns text
language sql
immutable
parallel safe
as $$
  select coalesce(
    string_agg(
      case
        when token[1] ~ '^[0-9]+$' then lpad(token[1], 40, '0')
        else lower(token[1])
      end,
      '' order by ordinal
    ),
    ''
  )
  from regexp_matches(coalesce(value, ''), '([0-9]+|[^0-9]+)', 'g') with ordinality as parts(token, ordinal)
$$;

comment on function personal_archive_natural_sort_key(text) is
  'Builds a stable case-insensitive key whose numeric filename segments sort by numeric value.';
