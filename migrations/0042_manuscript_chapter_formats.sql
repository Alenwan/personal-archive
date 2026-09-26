alter table manuscript_chapters
  add column if not exists content_format text not null default 'rich-text';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'manuscript_chapters_content_format_check'
  ) then
    alter table manuscript_chapters
      add constraint manuscript_chapters_content_format_check
      check (content_format in ('rich-text', 'markdown'));
  end if;
end $$;

comment on column manuscript_chapters.content_format is
  'Editing format for this chapter: rich-text HTML or Markdown source.';
