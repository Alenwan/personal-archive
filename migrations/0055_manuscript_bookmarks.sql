-- Follows the open-source branch's 0050-0054 migrations.
create table manuscript_bookmarks (
  bookmark_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(user_id) on delete cascade,
  manuscript_id uuid not null references manuscripts(manuscript_id) on delete cascade,
  chapter_id uuid not null references manuscript_chapters(chapter_id) on delete cascade,
  name varchar(120) not null default '',
  anchor jsonb not null,
  position_only boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(anchor) = 'object')
);
create index manuscript_bookmarks_owner_work_idx on manuscript_bookmarks(user_id, manuscript_id, created_at);
create unique index manuscript_bookmarks_position_idx on manuscript_bookmarks
  (user_id, manuscript_id, chapter_id, (anchor->>'revision'), (anchor->>'version'), (anchor->>'format'), (anchor->>'block'), (anchor->>'offset'), (anchor->>'kind'));
