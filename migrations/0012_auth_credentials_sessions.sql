create table if not exists user_credentials (
  user_id uuid primary key references users(user_id) on delete cascade,
  password_hash text not null,
  password_salt text not null,
  password_algorithm text not null default 'pbkdf2-sha256',
  password_iterations integer not null default 100000,
  must_change_password boolean not null default true,
  password_changed_at timestamptz,
  temporary_password_issued_at timestamptz,
  failed_login_count integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (password_iterations > 0)
);

create table if not exists auth_sessions (
  session_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(user_id) on delete cascade,
  current_tenant_id uuid references tenants(tenant_id),
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_seen_at timestamptz
);

create index if not exists idx_auth_sessions_user_active
  on auth_sessions(user_id, expires_at desc)
  where revoked_at is null;

create index if not exists idx_auth_sessions_token_active
  on auth_sessions(token_hash)
  where revoked_at is null;

comment on table user_credentials is 'Per-user password credentials. Passwords are stored as salted hashes and can force first-login password changes.';
comment on table auth_sessions is 'Opaque server-side sessions referenced by HttpOnly cookies. current_tenant_id prepares the auth layer for future tenant switching.';
