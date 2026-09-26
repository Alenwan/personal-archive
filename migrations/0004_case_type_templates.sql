create table if not exists case_type_templates (
  case_type_code text primary key,
  display_name text not null,
  description text not null default '',
  required_document_categories text[] not null default '{}',
  checklist_template jsonb not null default '[]'::jsonb,
  closing_readiness_enabled boolean not null default true,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table case_type_templates is 'Configurable case workflow templates. Each template controls required document categories and default checklist tasks.';
comment on column case_type_templates.case_type_code is 'Stable code stored on cases. Display names can change without changing business references.';
comment on column case_type_templates.checklist_template is 'Ordered checklist item definitions used when creating a new case of this type.';

insert into case_type_templates (
  case_type_code,
  display_name,
  description,
  required_document_categories,
  checklist_template,
  closing_readiness_enabled,
  sort_order,
  is_active
)
values
  (
    'residential_purchase',
    'Residential Purchase',
    'Standard single-family, townhouse, or multi-family purchase workflow.',
    array['Contract', 'Bank Documents', 'Title Documents', 'Closing Documents']::text[],
    '[
      {"title":"Executed contract received","description":"Confirm the signed contract package is uploaded and categorized.","dueFrom":"created","dueOffsetDays":1},
      {"title":"Inspection follow-up","description":"Track inspection report, punch-list items, and party responses.","dueFrom":"created","dueOffsetDays":7},
      {"title":"Mortgage commitment","description":"Confirm lender commitment or financing status before closing preparation.","dueFrom":"closing","dueOffsetDays":-21},
      {"title":"Title review","description":"Review title report, exceptions, municipal searches, and clearance items.","dueFrom":"closing","dueOffsetDays":-14},
      {"title":"Closing package","description":"Prepare closing disclosure, final statement, payoff items, and signatures.","dueFrom":"closing","dueOffsetDays":-5},
      {"title":"Final closing","description":"Confirm funding, recording, and final file archive.","dueFrom":"closing","dueOffsetDays":0}
    ]'::jsonb,
    true,
    10,
    true
  ),
  (
    'condo_coop',
    'Condo / Co-op',
    'Residential transaction with board, building, and buyer package coordination.',
    array['Contract', 'Buyer Documents', 'Bank Documents', 'Title Documents', 'Closing Documents']::text[],
    '[
      {"title":"Executed contract received","description":"Confirm the signed contract package is uploaded and categorized.","dueFrom":"created","dueOffsetDays":1},
      {"title":"Board package review","description":"Track board application, financials, questionnaire, and approval status.","dueFrom":"created","dueOffsetDays":10},
      {"title":"Mortgage commitment","description":"Confirm lender commitment and building-specific lender conditions.","dueFrom":"closing","dueOffsetDays":-21},
      {"title":"Title and building review","description":"Review title, building documents, questionnaire, and management requirements.","dueFrom":"closing","dueOffsetDays":-14},
      {"title":"Closing package","description":"Prepare board, lender, attorney, and title closing materials.","dueFrom":"closing","dueOffsetDays":-5}
    ]'::jsonb,
    true,
    20,
    true
  ),
  (
    'commercial_purchase',
    'Commercial Purchase',
    'Commercial, mixed-use, or investor purchase with due diligence and title review.',
    array['Contract', 'Attorney Documents', 'Title Documents', 'Closing Documents']::text[],
    '[
      {"title":"Contract and rider review","description":"Confirm contract, riders, schedules, and attorney review notes.","dueFrom":"created","dueOffsetDays":2},
      {"title":"Due diligence package","description":"Track leases, estoppels, certificates, inspection materials, and disclosures.","dueFrom":"created","dueOffsetDays":14},
      {"title":"Title and municipal clearance","description":"Review title, violations, searches, tax items, and clearance plan.","dueFrom":"closing","dueOffsetDays":-18},
      {"title":"Closing package","description":"Prepare entity documents, closing statement, transfer docs, and signatures.","dueFrom":"closing","dueOffsetDays":-7}
    ]'::jsonb,
    true,
    30,
    true
  ),
  (
    'refinance',
    'Refinance',
    'Loan refinance workflow focused on lender, payoff, title, and closing materials.',
    array['Bank Documents', 'Title Documents', 'Closing Documents']::text[],
    '[
      {"title":"Lender intake","description":"Confirm borrower, lender, payoff, and loan package requirements.","dueFrom":"created","dueOffsetDays":1},
      {"title":"Title and payoff review","description":"Review title, payoff letters, taxes, and open lien items.","dueFrom":"closing","dueOffsetDays":-14},
      {"title":"Lender clearance","description":"Confirm lender conditions and closing authorization.","dueFrom":"closing","dueOffsetDays":-5},
      {"title":"Closing package","description":"Prepare signing package, settlement statement, funding, and archive.","dueFrom":"closing","dueOffsetDays":0}
    ]'::jsonb,
    true,
    40,
    true
  ),
  (
    'demo_training',
    'Demo / Training Workspace',
    'Client-facing demo, training, or internal reference case without closing blockers.',
    array[]::text[],
    '[]'::jsonb,
    false,
    90,
    true
  )
on conflict (case_type_code) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  required_document_categories = excluded.required_document_categories,
  checklist_template = excluded.checklist_template,
  closing_readiness_enabled = excluded.closing_readiness_enabled,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active,
  updated_at = now();

alter table cases add column if not exists case_type_code text not null default 'residential_purchase';

update cases
set case_type_code = 'condo_coop'
where property_type in ('Condo', 'Co-op');

update cases
set case_type_code = 'commercial_purchase'
where property_type in ('Commercial', 'Mixed Use');

update cases
set case_type_code = 'demo_training'
where exists (
  select 1
  from case_tags
  join tags on tags.tag_id = case_tags.tag_id
  where case_tags.case_id = cases.case_id
    and tags.name in ('client-demo', 'training', 'system-overview')
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cases_case_type_code_fkey') then
    alter table cases
      add constraint cases_case_type_code_fkey
      foreign key (case_type_code) references case_type_templates(case_type_code);
  end if;
end $$;

create index if not exists idx_cases_case_type on cases(case_type_code);
create index if not exists idx_case_type_templates_active_sort on case_type_templates(is_active, sort_order);
