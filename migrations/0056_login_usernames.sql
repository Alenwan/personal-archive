alter table users add column if not exists username text;

alter table users add constraint users_username_format_check
  check (username is null or username ~ '^[a-z][a-z0-9._-]{2,31}$');

create unique index if not exists users_username_lower_unique
  on users (lower(username)) where username is not null;
