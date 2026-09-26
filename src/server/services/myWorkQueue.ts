import type {
  CaseRecord,
  MyWorkFilters,
  MyWorkItem,
  MyWorkQueue,
  MyWorkSource,
  MyWorkState,
  PublicUser,
  ServiceDiscussionMessage,
  TaskRecord
} from "../../shared/types";
import type { AppRepository } from "../repositories/types";

const TASK_WINDOW_DAYS = 7;
const SERVICE_WINDOW_DAYS = 14;

function dateOnly(value: string | null | undefined, fallback: string): string {
  const match = value?.match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? fallback;
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function compactText(value: string, limit = 180): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 3)}...`;
}

function statesForDate(date: string | null | undefined, today: string, dueSoonEnd: string): MyWorkState[] {
  if (!date) return ["unscheduled"];
  if (date < today) return ["overdue"];
  if (date === today) return ["due-today"];
  if (date <= dueSoonEnd) return ["due-soon"];
  return ["open"];
}

function uniqueStates(...groups: MyWorkState[][]): MyWorkState[] {
  return Array.from(new Set(groups.flat()));
}

function threadEntries(message: ServiceDiscussionMessage): ServiceDiscussionMessage[] {
  return [message, ...(message.replies ?? [])];
}

async function listAllDiscussionThreads(repo: AppRepository, userId: string): Promise<ServiceDiscussionMessage[]> {
  const results: ServiceDiscussionMessage[] = [];
  let page = 1;
  while (true) {
    const response = await repo.listServiceDiscussionsPage({ view: "all", sort: "recent" }, { page, pageSize: 100 }, userId);
    results.push(...response.items);
    if (!response.hasNextPage) return results;
    page += 1;
  }
}

function taskItem(task: TaskRecord, user: PublicUser, today: string, dueSoonEnd: string): MyWorkItem {
  const ownerScope = task.assignedTo ? "assigned" : "unassigned";
  const states = uniqueStates(
    statesForDate(task.dueDate, today, dueSoonEnd),
    task.status === "Blocked" ? ["blocked"] : [],
    ["open"]
  );
  return {
    key: `task:${task.taskId}`,
    source: "task",
    sourceId: task.taskId,
    title: task.title,
    summary: compactText(task.description) || "Service task",
    status: task.status,
    states,
    relevantDate: task.dueDate,
    dueDate: task.dueDate,
    activityAt: task.updatedAt,
    ownerUserId: task.assignedTo ?? null,
    ownerUserName: task.assignedToName ?? null,
    ownerScope,
    needsCurrentUserAttention: !task.assignedTo || task.assignedTo === user.userId,
    caseId: task.caseId,
    caseNumber: task.caseNumber ?? null,
    caseTitle: task.caseTitle ?? null,
    priority: task.priority
  };
}

function discussionItem(message: ServiceDiscussionMessage, user: PublicUser, today: string): MyWorkItem {
  const entries = threadEntries(message);
  const unread = entries.some((entry) => entry.isUnread);
  const mentioned = entries.some((entry) => entry.mentions.some((mention) => mention.userId === user.userId));
  const needsAction = message.threadStatus === "needs-action";
  const activityAt = message.latestActivityAt || message.updatedAt || message.createdAt;
  const ownerScope = message.threadOwnerUserId ? "assigned" : "unassigned";
  const states = uniqueStates(
    needsAction ? ["needs-action"] : ["open"],
    unread ? ["unread"] : []
  );
  return {
    key: `discussion:${message.messageId}`,
    source: "discussion",
    sourceId: message.messageId,
    title: compactText(message.bodyText.split(/\r?\n/)[0] || "Discussion thread", 120),
    summary: `${message.createdByName}${message.replyCount ? ` · ${message.replyCount} ${message.replyCount === 1 ? "reply" : "replies"}` : ""}`,
    status: needsAction ? "Needs action" : "Open",
    states,
    relevantDate: dateOnly(activityAt, today),
    dueDate: null,
    activityAt,
    ownerUserId: message.threadOwnerUserId ?? null,
    ownerUserName: message.threadOwnerUserName ?? null,
    ownerScope,
    needsCurrentUserAttention:
      unread || mentioned || message.threadOwnerUserId === user.userId || !message.threadOwnerUserId,
    caseId: message.caseId ?? null,
    caseNumber: message.caseNumber ?? null,
    caseTitle: message.caseTitle ?? null,
    replyCount: message.replyCount
  };
}

function serviceItem(service: CaseRecord, today: string, dueSoonEnd: string): MyWorkItem {
  return {
    key: `service:${service.caseId}`,
    source: "service",
    sourceId: service.caseId,
    title: service.propertyAddress,
    summary: `${service.caseNumber} · ${service.caseTypeName}`,
    status: service.status,
    states: uniqueStates(statesForDate(service.closingDate, today, dueSoonEnd), ["open"]),
    relevantDate: service.closingDate,
    dueDate: service.closingDate,
    activityAt: service.updatedAt,
    ownerUserId: null,
    ownerUserName: null,
    ownerScope: "shared",
    needsCurrentUserAttention: true,
    caseId: service.caseId,
    caseNumber: service.caseNumber,
    caseTitle: service.propertyAddress
  };
}

function sourceCounts(items: MyWorkItem[]): Record<MyWorkSource, number> {
  return {
    discussion: items.filter((item) => item.source === "discussion").length,
    task: items.filter((item) => item.source === "task").length,
    communication: items.filter((item) => item.source === "communication").length,
    service: items.filter((item) => item.source === "service").length
  };
}

function sortItems(items: MyWorkItem[]): MyWorkItem[] {
  const stateRank: Record<MyWorkState, number> = {
    overdue: 0,
    blocked: 1,
    "due-today": 2,
    "needs-action": 3,
    unread: 4,
    "due-soon": 5,
    unscheduled: 6,
    open: 7
  };
  const rank = (item: MyWorkItem) => Math.min(...item.states.map((state) => stateRank[state]));
  return [...items].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31") ||
      b.activityAt.localeCompare(a.activityAt) ||
      a.title.localeCompare(b.title)
  );
}

export async function buildMyWorkQueue(
  repo: AppRepository,
  user: PublicUser,
  filters: MyWorkFilters = {}
): Promise<MyWorkQueue> {
  const generatedAt = new Date().toISOString();
  const today = generatedAt.slice(0, 10);
  const taskWindowEnd = addDays(today, TASK_WINDOW_DAYS);
  const serviceWindowEnd = addDays(today, SERVICE_WINDOW_DAYS);
  const [services, tasks, discussions, communications] = await Promise.all([
    repo.listCases(),
    repo.listAllTasks(),
    listAllDiscussionThreads(repo, user.userId),
    repo.listAllCommunications({ workflowView: "followUp" })
  ]);
  const activeServices = new Map(services.map((service) => [service.caseId, service]));

  const taskItems = tasks
    .filter(
      (task) =>
        task.status !== "Done" &&
        activeServices.has(task.caseId) &&
        (task.status === "Blocked" || task.dueDate <= taskWindowEnd)
    )
    .map((task) => taskItem(task, user, today, taskWindowEnd));

  const discussionItems = discussions
    .filter((message) => {
      if (message.threadStatus === "resolved" || message.threadStatus === "archived") return false;
      const entries = threadEntries(message);
      return (
        message.threadStatus === "needs-action" ||
        Boolean(message.threadOwnerUserId) ||
        entries.some((entry) => entry.isUnread) ||
        entries.some((entry) => entry.mentions.some((mention) => mention.userId === user.userId))
      );
    })
    .map((message) => discussionItem(message, user, today));

  const communicationItems: MyWorkItem[] = communications
    .filter((communication) => !communication.caseId || activeServices.has(communication.caseId))
    .map((communication) => {
      const ownerScope = communication.followUpAssignedTo ? "assigned" : "unassigned";
      const activityAt = communication.updatedAt || communication.occurredAt;
      return {
        key: `communication:${communication.communicationId}`,
        source: "communication",
        sourceId: communication.communicationId,
        title: communication.subject,
        summary: compactText(communication.body) || `${communication.communicationType} follow-up`,
        status: "Needs follow-up",
        states: uniqueStates(
          statesForDate(communication.followUpDueDate, today, taskWindowEnd),
          ["needs-action"]
        ),
        relevantDate: communication.followUpDueDate ?? dateOnly(activityAt, today),
        dueDate: communication.followUpDueDate ?? null,
        activityAt,
        ownerUserId: communication.followUpAssignedTo ?? null,
        ownerUserName: communication.followUpAssignedToName ?? null,
        ownerScope,
        needsCurrentUserAttention:
          !communication.followUpAssignedTo || communication.followUpAssignedTo === user.userId,
        caseId: communication.caseId ?? null,
        caseNumber: communication.caseNumber ?? null,
        caseTitle: communication.caseTitle ?? null
      };
    });

  const serviceItems = services
    .filter(
      (service) =>
        service.status !== "Closed" &&
        service.status !== "Cancelled" &&
        Boolean(service.closingDate) &&
        service.closingDate <= serviceWindowEnd
    )
    .map((service) => serviceItem(service, today, serviceWindowEnd));

  const owner = filters.owner || "attention";
  const eligibleItems = sortItems([...discussionItems, ...taskItems, ...communicationItems, ...serviceItems]).filter((item) => {
    if (owner === "attention" && !item.needsCurrentUserAttention) return false;
    if (owner === "unassigned" && item.ownerScope !== "unassigned") return false;
    if (owner !== "attention" && owner !== "unassigned" && owner !== "all" && item.ownerUserId !== owner) return false;
    if (filters.state && !item.states.includes(filters.state)) return false;
    if (filters.dateFrom && item.relevantDate < filters.dateFrom) return false;
    if (filters.dateTo && item.relevantDate > filters.dateTo) return false;
    return true;
  });
  const items = filters.source ? eligibleItems.filter((item) => item.source === filters.source) : eligibleItems;

  return {
    generatedAt,
    today,
    items,
    summary: {
      total: items.length,
      overdue: items.filter((item) => item.states.includes("overdue")).length,
      dueToday: items.filter((item) => item.states.includes("due-today")).length,
      unassigned: items.filter((item) => item.ownerScope === "unassigned").length,
      bySource: sourceCounts(eligibleItems)
    }
  };
}
