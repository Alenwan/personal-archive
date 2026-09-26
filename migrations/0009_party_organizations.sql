create table if not exists party_organizations (
  party_organization_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default '90000000-0000-4000-8000-000000000001' references organizations(organization_id),
  name text not null,
  type text not null default 'Company' check (type in (
    'Company', 'Law Firm', 'Bank', 'Title Company', 'Government Agency', 'Vendor', 'Nonprofit', 'Other'
  )),
  tax_id_type text not null default '' check (tax_id_type in ('', 'EIN', 'ITIN', 'VAT', 'State Registration', 'Other')),
  tax_id_value text not null default '',
  website text not null default '',
  email text not null default '',
  phone text not null default '',
  fax text not null default '',
  address_line1 text not null default '',
  address_line2 text not null default '',
  city text not null default '',
  state text not null default '',
  zip_code text not null default '',
  country text not null default 'United States',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists party_organizations_active_name_idx
  on party_organizations(organization_id, lower(name))
  where deleted_at is null;

create table if not exists contact_organization_affiliations (
  contact_id uuid not null references contacts(contact_id) on delete cascade,
  party_organization_id uuid not null references party_organizations(party_organization_id) on delete cascade,
  title text not null default '',
  department text not null default '',
  is_primary boolean not null default true,
  notes text not null default '',
  created_at timestamptz not null default now(),
  primary key (contact_id, party_organization_id)
);

create unique index if not exists contact_organization_affiliations_primary_idx
  on contact_organization_affiliations(contact_id)
  where is_primary;

create index if not exists party_organizations_name_idx on party_organizations(name);
create index if not exists contact_organization_affiliations_party_idx
  on contact_organization_affiliations(party_organization_id);
