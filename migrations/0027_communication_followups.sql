alter table communications
  add column if not exists follow_up_assigned_to uuid references users(user_id),
  add column if not exists follow_up_due_date date;

create index if not exists communications_active_followup_due_idx
  on communications (tenant_id, status, follow_up_due_date, occurred_at desc)
  where deleted_at is null
    and status = 'Needs follow-up';

create index if not exists communications_active_followup_owner_idx
  on communications (tenant_id, follow_up_assigned_to, follow_up_due_date)
  where deleted_at is null
    and follow_up_assigned_to is not null;

comment on column communications.follow_up_assigned_to is
  'Optional owner for lightweight communication follow-up. Larger work can still become a normal task.';

comment on column communications.follow_up_due_date is
  'Optional due date for lightweight communication follow-up.';
