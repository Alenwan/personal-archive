create table if not exists pbx_settings (
  pbx_settings_id uuid primary key default '70000000-0000-4000-8000-000000000001',
  organization_id uuid references organizations(organization_id),
  is_enabled boolean not null default false,
  allowed_dids jsonb not null default '[]'::jsonb,
  allowed_destinations jsonb not null default '[]'::jsonb,
  ignored_dids jsonb not null default '[]'::jsonb,
  ignored_destinations jsonb not null default '[]'::jsonb,
  show_unknown_callers boolean not null default true,
  popup_retention_seconds integer not null default 30 check (popup_retention_seconds between 5 and 600),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references users(user_id)
);

insert into pbx_settings (
  pbx_settings_id,
  organization_id,
  is_enabled,
  allowed_dids,
  allowed_destinations,
  ignored_dids,
  ignored_destinations,
  show_unknown_callers,
  popup_retention_seconds
)
values (
  '70000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000001',
  false,
  '[]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  true,
  30
)
on conflict (pbx_settings_id) do nothing;

comment on table pbx_settings is 'Controls PBX caller popup filtering for self-hosted MD3 deployments.';
comment on column pbx_settings.allowed_dids is 'Inbound DID or called-number values allowed to trigger the CRM caller popup.';
comment on column pbx_settings.allowed_destinations is 'PBX destinations, ring groups, queues, or extensions allowed to trigger the CRM caller popup.';
