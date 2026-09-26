with company_names as (
  select distinct
    '90000000-0000-4000-8000-000000000001'::uuid as organization_id,
    trim(company) as name
  from contacts
  where company is not null
    and trim(company) <> ''
    and deleted_at is null
    and not exists (
      select 1
      from contact_organization_affiliations existing_affiliation
      where existing_affiliation.contact_id = contacts.contact_id
        and existing_affiliation.is_primary = true
    )
),
missing_organizations as (
  select company_names.organization_id, company_names.name
  from company_names
  where not exists (
    select 1
    from party_organizations
    where party_organizations.organization_id = company_names.organization_id
      and lower(party_organizations.name) = lower(company_names.name)
      and party_organizations.deleted_at is null
  )
)
insert into party_organizations (organization_id, name, type)
select organization_id, name, 'Company'
from missing_organizations;

insert into contact_organization_affiliations (contact_id, party_organization_id, is_primary)
select contacts.contact_id, party_organizations.party_organization_id, true
from contacts
join party_organizations
  on party_organizations.organization_id = '90000000-0000-4000-8000-000000000001'::uuid
  and lower(party_organizations.name) = lower(trim(contacts.company))
  and party_organizations.deleted_at is null
where contacts.company is not null
  and trim(contacts.company) <> ''
  and contacts.deleted_at is null
  and not exists (
    select 1
    from contact_organization_affiliations existing_affiliation
    where existing_affiliation.contact_id = contacts.contact_id
      and existing_affiliation.is_primary = true
  )
on conflict (contact_id, party_organization_id) do update set is_primary = true;

alter table contacts drop column if exists company;
