create table if not exists document_review_statuses (
  status_code text primary key,
  display_name text not null,
  description text not null default '',
  color text not null default '#2c827f',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into document_review_statuses (status_code, display_name, description, color, sort_order)
values
  ('needs-review', 'Needs review', 'Uploaded and waiting for review.', '#b98d3a', 10),
  ('in-review', 'In review', 'Currently being reviewed by staff, attorney, or manager.', '#345f7d', 20),
  ('approved', 'Approved', 'Reviewed and accepted for the current case workflow.', '#2f855a', 30),
  ('needs-info', 'Needs information', 'Additional information or a corrected file is needed.', '#b7791f', 40),
  ('rejected', 'Rejected', 'Reviewed and rejected for this workflow.', '#9f3f46', 50),
  ('superseded', 'Superseded', 'Replaced by a newer or corrected document.', '#747160', 60)
on conflict (status_code) do update
set display_name = excluded.display_name,
    description = excluded.description,
    color = excluded.color,
    sort_order = excluded.sort_order,
    updated_at = now();

alter table documents add column if not exists review_status text not null default 'needs-review';
alter table documents add column if not exists reviewed_by uuid references users(user_id);
alter table documents add column if not exists reviewed_at timestamptz;
alter table documents add column if not exists review_notes text not null default '';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'documents_review_status_fkey'
  ) then
    alter table documents
      add constraint documents_review_status_fkey
      foreign key (review_status)
      references document_review_statuses(status_code);
  end if;
end $$;

create index if not exists idx_documents_review_status on documents(review_status);
create index if not exists idx_documents_case_review on documents(case_id, review_status);

comment on table document_review_statuses is 'Configurable lookup table for document review workflow states.';
comment on column documents.review_status is 'Current workflow state for document review and acceptance.';
comment on column documents.review_notes is 'Internal review notes for follow-up, rejection reasons, or approval context.';
