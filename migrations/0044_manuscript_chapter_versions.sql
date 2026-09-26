alter table manuscript_chapters
  add column if not exists revision bigint not null default 1,
  add column if not exists last_save_source text not null default 'manual',
  add column if not exists last_saved_by uuid references users(user_id) on delete set null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'manuscript_chapters_last_save_source_check'
  ) then
    alter table manuscript_chapters
      add constraint manuscript_chapters_last_save_source_check
      check (last_save_source in ('autosave', 'manual', 'restore'));
  end if;
end $$;

create table if not exists manuscript_chapter_versions (
  version_id uuid primary key default gen_random_uuid(),
  manuscript_id uuid not null references manuscripts(manuscript_id) on delete cascade,
  chapter_id uuid not null references manuscript_chapters(chapter_id) on delete cascade,
  revision bigint not null,
  title varchar(240) not null,
  body text not null default '',
  content_format text not null default 'rich-text',
  character_count integer not null default 0,
  save_source text not null default 'manual',
  saved_by uuid references users(user_id) on delete set null,
  saved_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint manuscript_chapter_versions_revision_check check (revision > 0),
  constraint manuscript_chapter_versions_character_count_check check (character_count >= 0),
  constraint manuscript_chapter_versions_content_format_check check (content_format in ('rich-text', 'markdown')),
  constraint manuscript_chapter_versions_save_source_check check (save_source in ('autosave', 'manual', 'restore')),
  constraint manuscript_chapter_versions_chapter_revision_unique unique (chapter_id, revision)
);

create index if not exists manuscript_chapter_versions_chapter_created_idx
  on manuscript_chapter_versions (chapter_id, created_at desc);

comment on table manuscript_chapter_versions is
  'Throttled recoverable snapshots of Long writing chapters. Current content remains in manuscript_chapters.';
