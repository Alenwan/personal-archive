import type { CaseRecord, ChecklistTemplateItem } from "../../shared/types";
import type { AppRepository } from "../repositories/types";

function normalizeDateInput(value: string): string {
  const raw = String(value ?? "").trim();
  const dateOnly = raw.match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
  if (dateOnly) {
    return `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Unable to calculate checklist due date from "${raw || "empty date"}"`);
  }
  return parsed.toISOString().slice(0, 10);
}

function addDays(dateInput: string, days: number): string {
  const date = new Date(`${normalizeDateInput(dateInput)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function taskDueDate(item: ChecklistTemplateItem, caseRecord: CaseRecord): string {
  const anchor = item.dueFrom === "closing" ? caseRecord.closingDate : caseRecord.createdAt;
  return addDays(anchor, item.dueOffsetDays);
}

export async function createChecklistTasksForCase(repo: AppRepository, caseRecord: CaseRecord): Promise<number> {
  const template = await repo.getCaseTypeTemplate(caseRecord.caseTypeCode);
  if (!template?.closingReadinessEnabled || template.checklist.length === 0) return 0;

  let created = 0;
  for (const item of template.checklist) {
    await repo.createTask({
      caseId: caseRecord.caseId,
      title: item.title,
      description: item.description,
      priority: item.priority ?? "Normal",
      dueDate: taskDueDate(item, caseRecord),
      assignedTo: null
    });
    created += 1;
  }
  return created;
}
