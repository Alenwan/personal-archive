create table if not exists manuscripts (
  manuscript_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default '90000000-0000-4000-8000-000000000001' references tenants(tenant_id),
  title varchar(240) not null,
  manuscript_kind text not null default 'Long document',
  status text not null default 'Draft',
  description text not null default '',
  created_by uuid references users(user_id),
  updated_by uuid references users(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint manuscripts_kind_check check (
    manuscript_kind in ('Novel', 'Long document', 'Memoir', 'Collection', 'Other')
  ),
  constraint manuscripts_status_check check (
    status in ('Draft', 'In progress', 'Complete', 'Archived')
  )
);

create table if not exists manuscript_chapters (
  chapter_id uuid primary key default gen_random_uuid(),
  manuscript_id uuid not null references manuscripts(manuscript_id) on delete cascade,
  title varchar(240) not null,
  body text not null default '',
  sort_order integer not null default 0,
  character_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint manuscript_chapters_character_count_check check (character_count >= 0)
);

create index if not exists manuscripts_active_updated_idx
  on manuscripts (tenant_id, updated_at desc)
  where deleted_at is null;

create index if not exists manuscripts_title_idx
  on manuscripts (lower(title))
  where deleted_at is null;

create index if not exists manuscript_chapters_manuscript_order_idx
  on manuscript_chapters (manuscript_id, sort_order, created_at)
  where deleted_at is null;

comment on table manuscripts is
  'Chapter-based long-form works such as novels and large reference documents.';

comment on table manuscript_chapters is
  'Independently loaded and saved chapters so very long works do not require one large document payload.';
