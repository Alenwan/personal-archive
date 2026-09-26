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
    'md3_one_time_service',
    'One-time Service',
    'Single visit, remote adjustment, DVR local deployment, network change, or short service job.',
    array[]::text[],
    '[
      {"title":"Confirm request and scope","description":"Record what the customer needs, expected service window, site access, and success criteria.","dueFrom":"created","dueOffsetDays":0},
      {"title":"Complete service notes","description":"Record what was changed, tested, and handed back to the customer.","dueFrom":"created","dueOffsetDays":1}
    ]'::jsonb,
    true,
    110,
    true
  ),
  (
    'md3_deployment_recurring_service',
    'Deployment + Recurring Support',
    'Initial installation plus ongoing monthly communication service, support, or maintenance.',
    array[]::text[],
    '[
      {"title":"Confirm deployment scope","description":"Record customer site, system design, numbers, devices, accounts, and recurring support expectations.","dueFrom":"created","dueOffsetDays":0},
      {"title":"Link managed assets","description":"Attach PBX, phones, trunks, gateways, SIMs, routers, accounts, or other managed assets to this service.","dueFrom":"created","dueOffsetDays":1},
      {"title":"Verify credentials","description":"Confirm encrypted credentials are saved only where needed and access is limited to Admin and Manager roles.","dueFrom":"created","dueOffsetDays":1},
      {"title":"Handoff and recurring support notes","description":"Record support terms, customer contacts, maintenance notes, and known follow-up items.","dueFrom":"created","dueOffsetDays":3}
    ]'::jsonb,
    true,
    120,
    true
  ),
  (
    'md3_pbx_service',
    'PBX / VoIP Service',
    'PBX server, VoIP phones, SIP trunk, number routing, voicemail, IVR, or related voice service.',
    array[]::text[],
    '[
      {"title":"Record voice service design","description":"Capture numbers, extensions, routing, SIP trunk, phones, gateways, and customer contacts.","dueFrom":"created","dueOffsetDays":0},
      {"title":"Test inbound and outbound calls","description":"Confirm call flow, emergency routing assumptions, voicemail, recording, and customer acceptance.","dueFrom":"created","dueOffsetDays":2}
    ]'::jsonb,
    true,
    130,
    true
  ),
  (
    'md3_network_service',
    'Network Service',
    'Router, firewall, switch, Wi-Fi, VPN, VLAN, static IP, cabling coordination, or network troubleshooting.',
    array[]::text[],
    '[
      {"title":"Record network scope","description":"Capture topology, IP ranges, device access, ISP details, and planned changes.","dueFrom":"created","dueOffsetDays":0},
      {"title":"Test connectivity","description":"Confirm LAN/WAN connectivity, Wi-Fi, VPN, phone service impact, and customer acceptance.","dueFrom":"created","dueOffsetDays":1}
    ]'::jsonb,
    true,
    140,
    true
  ),
  (
    'md3_dvr_security_service',
    'DVR / Security Service',
    'DVR/NVR, camera, local recording, remote access, monitoring, or security system service.',
    array[]::text[],
    '[
      {"title":"Record security system scope","description":"Capture DVR/NVR, cameras, channels, storage, remote access, and customer access details.","dueFrom":"created","dueOffsetDays":0},
      {"title":"Verify viewing and recording","description":"Confirm local recording, remote viewing, user access, and customer acceptance.","dueFrom":"created","dueOffsetDays":1}
    ]'::jsonb,
    true,
    150,
    true
  ),
  (
    'md3_cabling_service',
    'Cabling / Site Work',
    'On-site cabling, jack work, device placement, rack cleanup, or coordination with installers.',
    array[]::text[],
    '[
      {"title":"Confirm site work details","description":"Capture rooms, drops, device locations, access timing, and customer approval.","dueFrom":"created","dueOffsetDays":0}
    ]'::jsonb,
    true,
    160,
    true
  ),
  (
    'md3_support_service',
    'Support / Maintenance',
    'Troubleshooting, recurring support, account maintenance, configuration update, or customer assistance.',
    array[]::text[],
    '[
      {"title":"Record support request","description":"Capture issue, affected service, customer contact, priority, and follow-up notes.","dueFrom":"created","dueOffsetDays":0}
    ]'::jsonb,
    true,
    170,
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

insert into work_item_types (
  tenant_id,
  type_code,
  display_name,
  object_label,
  description,
  number_prefix,
  required_document_categories,
  checklist_template,
  readiness_enabled,
  config,
  sort_order,
  is_active
)
select
  t.tenant_id,
  ctt.case_type_code,
  ctt.display_name,
  'Service',
  ctt.description,
  'MD3',
  ctt.required_document_categories,
  ctt.checklist_template,
  ctt.closing_readiness_enabled,
  jsonb_build_object(
    'templateFamily', 'md3-service',
    'primaryDateLabel', 'Target date',
    'primaryValueLabel', 'Estimated value',
    'primaryLocationLabel', 'Service location'
  ),
  ctt.sort_order,
  ctt.is_active
from tenants t
cross join case_type_templates ctt
where ctt.case_type_code like 'md3_%'
on conflict (tenant_id, type_code) do update set
  display_name = excluded.display_name,
  object_label = excluded.object_label,
  description = excluded.description,
  number_prefix = excluded.number_prefix,
  required_document_categories = excluded.required_document_categories,
  checklist_template = excluded.checklist_template,
  readiness_enabled = excluded.readiness_enabled,
  config = excluded.config,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active,
  updated_at = now();
