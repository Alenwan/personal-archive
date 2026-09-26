insert into users (user_id, name, email, role, organization_id, created_at)
values (
  '90000000-0000-4000-8000-000000000099',
  'MD3 Platform System',
  'system@md3-platform.local',
  'ReadOnly',
  '90000000-0000-4000-8000-000000000001',
  now()
)
on conflict (email) do update set
  name = excluded.name,
  role = excluded.role,
  organization_id = coalesce(users.organization_id, excluded.organization_id);

insert into user_roles (user_id, role_id, organization_id)
select
  '90000000-0000-4000-8000-000000000099',
  r.role_id,
  r.organization_id
from roles r
where r.organization_id = '90000000-0000-4000-8000-000000000001'
  and r.code = 'readonly'
on conflict (user_id, role_id, organization_id) do nothing;
