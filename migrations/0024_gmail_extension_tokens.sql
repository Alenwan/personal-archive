create table if not exists gmail_extension_tokens (
  token_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default '90000000-0000-4000-8000-000000000001' references tenants(tenant_id),
  name text not null,
  token_hash text not null unique,
  scopes text[] not null default array['gmail:health', 'gmail:search', 'gmail:archive'],
  owner_user_id uuid not null references users(user_id),
  created_by uuid references users(user_id),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  check (array_length(scopes, 1) is not null)
);

create index if not exists gmail_extension_tokens_tenant_created_idx
  on gmail_extension_tokens (tenant_id, created_at desc);

create index if not exists gmail_extension_tokens_active_hash_idx
  on gmail_extension_tokens (token_hash)
  where revoked_at is null;

comment on table gmail_extension_tokens is 'Admin-managed bearer tokens used by the MD3 Gmail Chrome Extension integration.';
comment on column gmail_extension_tokens.token_hash is 'SHA-256 hash of the raw extension API token. Raw tokens are shown once and never stored.';
comment on column gmail_extension_tokens.scopes is 'Allowed Gmail extension integration scopes such as gmail:search and gmail:archive.';
