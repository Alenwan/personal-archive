-- Historical authorship is evidence to review, not authority to recover a key.
-- Existing rows deliberately remain unresolved, including encrypted works.
alter table manuscripts add column key_owner_user_id uuid references users(user_id) on delete restrict;

create table manuscript_key_owner_claims (
  claim_id uuid primary key,
  manuscript_id uuid not null unique references manuscripts(manuscript_id) on delete restrict,
  owner_user_id uuid not null references users(user_id) on delete restrict,
  previous_updated_at timestamptz not null,
  evidence_reference text not null check (length(evidence_reference) between 3 and 160),
  operator_reference text not null check (length(operator_reference) between 3 and 160),
  recorded_by text not null default current_user,
  created_at timestamptz not null default now()
);

create function archive_guard_manuscript_key_owner() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.key_owner_user_id is not null and new.key_owner_user_id is distinct from new.created_by then
      raise exception 'New manuscript key owner must match its authenticated creator';
    end if;
  elsif new.key_owner_user_id is distinct from old.key_owner_user_id then
    if old.key_owner_user_id is not null or new.key_owner_user_id is null then
      raise exception 'Confirmed manuscript key ownership is immutable';
    end if;
    if not exists (
      select 1 from manuscript_key_owner_claims c
      where c.manuscript_id = old.manuscript_id and c.owner_user_id = new.key_owner_user_id
        and c.previous_updated_at = old.updated_at
    ) then
      raise exception 'An audited maintenance claim is required';
    end if;
  end if;
  return new;
end;
$$;
create trigger archive_manuscript_key_owner_guard before insert or update on manuscripts
  for each row execute function archive_guard_manuscript_key_owner();

create function archive_guard_key_owner_claim() returns trigger language plpgsql as $$
begin
  if tg_op <> 'INSERT' then raise exception 'Key ownership claim records are immutable'; end if;
  -- Same row lock as the repository: serializes reviews and ownership changes.
  perform 1 from manuscripts m where m.manuscript_id = new.manuscript_id
    and m.key_owner_user_id is null and m.updated_at = new.previous_updated_at for update;
  if not found then raise exception 'Key ownership review is stale or already claimed'; end if;
  return new;
end;
$$;
create trigger archive_key_owner_claim_guard before insert or update or delete on manuscript_key_owner_claims
  for each row execute function archive_guard_key_owner_claim();

-- Do not allow an audit record to commit without its matching owner transition.
create function archive_check_key_owner_claim() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from manuscripts m where m.manuscript_id = new.manuscript_id
    and m.key_owner_user_id = new.owner_user_id) then
    raise exception 'Key ownership claim must commit with its owner';
  end if;
  return null;
end;
$$;
create constraint trigger archive_key_owner_claim_consistency after insert on manuscript_key_owner_claims
  deferrable initially deferred for each row execute function archive_check_key_owner_claim();
