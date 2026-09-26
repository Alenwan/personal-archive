alter table contacts add column if not exists job_title text not null default '';

update contacts
set job_title = case contact_id
  when '40000000-0000-4000-8000-000000000003' then 'Licensed Real Estate Agent'
  when '40000000-0000-4000-8000-000000000004' then 'Title Closer'
  when '40000000-0000-4000-8000-000000000005' then 'Partner Attorney'
  when '40000000-0000-4000-8000-000000000006' then 'Mortgage Processor'
  when '40000000-0000-4000-8000-000000000007' then 'Managing Attorney'
  when '40000000-0000-4000-8000-000000000008' then 'Property Inspector'
  else job_title
end
where contact_id in (
  '40000000-0000-4000-8000-000000000003',
  '40000000-0000-4000-8000-000000000004',
  '40000000-0000-4000-8000-000000000005',
  '40000000-0000-4000-8000-000000000006',
  '40000000-0000-4000-8000-000000000007',
  '40000000-0000-4000-8000-000000000008'
) and job_title = '';

create index if not exists idx_contacts_job_title on contacts(job_title);
