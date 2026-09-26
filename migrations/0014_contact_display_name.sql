alter table contacts add column if not exists display_name text;

update contacts
set display_name = nullif(trim(concat_ws(' ', first_name, nullif(last_name, ''))), '')
where display_name is null
  or trim(display_name) = '';

update contacts
set display_name = first_name
where display_name is null
  or trim(display_name) = '';

alter table contacts alter column display_name set default '';
alter table contacts alter column display_name set not null;

create index if not exists idx_contacts_display_name on contacts(lower(display_name));
