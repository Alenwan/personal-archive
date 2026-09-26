alter table communications
  alter column case_id drop not null,
  alter column work_item_id drop not null;

alter table communications
  add column if not exists status text not null default 'Logged';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'communications_status_check'
  ) then
    alter table communications
      add constraint communications_status_check
      check (status in ('New', 'Logged', 'Needs follow-up', 'Linked', 'Ignored / Spam'));
  end if;
end $$;

update communications
set status = 'Linked'
where status = 'Logged'
  and coalesce(work_item_id, case_id) is not null;

create index if not exists communications_tenant_status_occurred_idx
  on communications (tenant_id, status, occurred_at desc)
  where deleted_at is null;

create index if not exists communications_unlinked_occurred_idx
  on communications (tenant_id, occurred_at desc)
  where coalesce(work_item_id, case_id) is null and deleted_at is null;

comment on column communications.status is 'Lightweight workflow status for the communications inbox.';
