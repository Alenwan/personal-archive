alter table case_contacts
  drop constraint if exists case_contacts_role_check;

alter table case_contacts
  add constraint case_contacts_role_check
  check (role in (
    'Seller',
    'Buyer',
    'Seller Agent',
    'Buyer Agent',
    'Seller Attorney',
    'Buyer Attorney',
    'Bank',
    'Bank Attorney',
    'Title Company',
    'Inspector',
    'Customer',
    'Site Contact',
    'Billing Contact',
    'Technical Contact',
    'Vendor',
    'Carrier',
    'Technician',
    'Project Manager',
    'Other'
  ));
