-- Starter checklist tasks are opt-in from this release onward. Complete only the
-- unmistakably generated rows: they match their template and were created with
-- the Service itself. Manual tasks and their history are left untouched.
update tasks as task
set status = 'Done',
    updated_at = now()
from cases as service
where task.case_id = service.case_id
  and task.status <> 'Done'
  and task.created_at between service.created_at - interval '1 second' and service.created_at + interval '1 minute'
  and exists (
    select 1
    from case_type_templates as template
    cross join lateral jsonb_array_elements(template.checklist_template) as checklist_item
    where template.case_type_code = service.case_type_code
      and checklist_item ->> 'title' = task.title
      and coalesce(checklist_item ->> 'description', '') = task.description
  );
