alter table documents drop constraint if exists documents_category_check;

alter table documents
  add constraint documents_category_check check (category in (
    'Contract',
    'Seller Documents',
    'Buyer Documents',
    'Bank Documents',
    'Attorney Documents',
    'Title Documents',
    'Inspection',
    'Closing Documents',
    'Service Request',
    'Scope / Proposal',
    'PBX',
    'Network',
    'DVR / Security',
    'Cabling',
    'Support',
    'Internal Infrastructure',
    'Carrier / Vendor Records',
    'Credentials Reference',
    'Discussion Attachment',
    'Photos / Screenshots',
    'Other'
  ));
