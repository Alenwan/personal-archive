alter table tasks
  add column if not exists priority text not null default 'Normal';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_priority_check') then
    alter table tasks
      add constraint tasks_priority_check check (priority in ('Low', 'Normal', 'High', 'Urgent'));
  end if;
end $$;

create index if not exists idx_tasks_due_status_priority
  on tasks(due_date, status, priority);

update case_type_templates
set checklist_template = case case_type_code
  when 'md3_one_time_service' then
    '[
      {"title":"Confirm request and scope","description":"Record what the customer needs, expected service window, site access, and success criteria.","priority":"High","dueFrom":"created","dueOffsetDays":0},
      {"title":"Complete service notes","description":"Record what was changed, tested, and handed back to the customer.","priority":"Normal","dueFrom":"created","dueOffsetDays":1}
    ]'::jsonb
  when 'md3_deployment_recurring_service' then
    '[
      {"title":"Confirm deployment scope","description":"Record customer site, system design, numbers, devices, accounts, and recurring support expectations.","priority":"High","dueFrom":"created","dueOffsetDays":0},
      {"title":"Link managed assets","description":"Attach PBX, phones, trunks, gateways, SIMs, routers, accounts, or other managed assets to this service.","priority":"High","dueFrom":"created","dueOffsetDays":1},
      {"title":"Verify credentials","description":"Confirm encrypted credentials are saved only where needed and access is limited to Admin and Manager roles.","priority":"High","dueFrom":"created","dueOffsetDays":1},
      {"title":"Handoff and recurring support notes","description":"Record support terms, customer contacts, maintenance notes, and known follow-up items.","priority":"Normal","dueFrom":"created","dueOffsetDays":3}
    ]'::jsonb
  when 'md3_pbx_service' then
    '[
      {"title":"Record voice service design","description":"Capture numbers, extensions, routing, SIP trunk, phones, gateways, and customer contacts.","priority":"High","dueFrom":"created","dueOffsetDays":0},
      {"title":"Test inbound and outbound calls","description":"Confirm call flow, emergency routing assumptions, voicemail, recording, and customer acceptance.","priority":"High","dueFrom":"created","dueOffsetDays":2}
    ]'::jsonb
  when 'md3_network_service' then
    '[
      {"title":"Record network scope","description":"Capture topology, IP ranges, device access, ISP details, and planned changes.","priority":"High","dueFrom":"created","dueOffsetDays":0},
      {"title":"Test connectivity","description":"Confirm LAN/WAN connectivity, Wi-Fi, VPN, phone service impact, and customer acceptance.","priority":"High","dueFrom":"created","dueOffsetDays":1}
    ]'::jsonb
  when 'md3_dvr_security_service' then
    '[
      {"title":"Record security system scope","description":"Capture DVR/NVR, cameras, channels, storage, remote access, and customer access details.","priority":"High","dueFrom":"created","dueOffsetDays":0},
      {"title":"Verify viewing and recording","description":"Confirm local recording, remote viewing, user access, and customer acceptance.","priority":"Normal","dueFrom":"created","dueOffsetDays":1}
    ]'::jsonb
  when 'md3_cabling_service' then
    '[
      {"title":"Confirm site work details","description":"Capture rooms, drops, device locations, access timing, and customer approval.","priority":"Normal","dueFrom":"created","dueOffsetDays":0}
    ]'::jsonb
  when 'md3_support_service' then
    '[
      {"title":"Record support request","description":"Capture issue, affected service, customer contact, priority, and follow-up notes.","priority":"High","dueFrom":"created","dueOffsetDays":0}
    ]'::jsonb
  else checklist_template
end,
updated_at = now()
where case_type_code like 'md3_%';

update work_item_types wit
set checklist_template = ctt.checklist_template,
    updated_at = now()
from case_type_templates ctt
where wit.type_code = ctt.case_type_code
  and wit.type_code like 'md3_%';

comment on column tasks.priority is 'Operational priority for daily service queues. MD3 uses Low, Normal, High, and Urgent.';
