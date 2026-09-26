import type { AppRepository } from "../repositories/types";
import type { AuditLog, CaseTimelineEvent, CaseTimelineEventType, CommunicationRecord, NoteRecord } from "../../shared/types";

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function eventType(action: string, entityType: string): CaseTimelineEventType {
  if (action.startsWith("document.")) return "document";
  if (action.startsWith("task.")) return "task";
  if (action.startsWith("case_contact.")) return "party";
  if (action.startsWith("communication.")) return "communication";
  if (action.startsWith("service_discussion.")) return "note";
  if (action.startsWith("knowledge.")) return "note";
  if (action.startsWith("asset.")) return "asset";
  if (action.startsWith("credential.")) return "credential";
  if (action.startsWith("case.")) return "case";
  if (entityType === "document") return "document";
  if (entityType === "task") return "task";
  if (entityType === "communication") return "communication";
  if (entityType === "asset") return "asset";
  if (entityType === "credential") return "credential";
  if (entityType === "case") return "case";
  return "system";
}

function reviewStatusLabel(status: unknown): string {
  switch (status) {
    case "needs-review":
      return "Needs review";
    case "in-review":
      return "In review";
    case "approved":
      return "Approved";
    case "needs-info":
      return "Needs information";
    case "rejected":
      return "Rejected";
    case "superseded":
      return "Superseded";
    default:
      return text(status);
  }
}

function noteEvent(note: NoteRecord): CaseTimelineEvent {
  return {
    eventId: `note:${note.noteId}`,
    caseId: note.caseId,
    type: "note",
    title: "Note added",
    description: note.body,
    createdAt: note.createdAt,
    createdByName: note.createdByName,
    source: "note",
    entityType: "note",
    entityId: note.noteId
  };
}

function communicationEvent(communication: CommunicationRecord): CaseTimelineEvent {
  const relatedContext = [
    communication.direction,
    communication.source !== "Manual" ? communication.source : "",
    communication.externalProvider,
    communication.externalReference,
    communication.partyOrganizationName,
    communication.contactName,
    communication.assetName,
    communication.supportingDocumentName
  ].filter(Boolean);
  return {
    eventId: `communication:${communication.communicationId}`,
    caseId: communication.caseId ?? "",
    type: "communication",
    title: `${communication.communicationType}: ${communication.subject}`,
    description: [relatedContext.join(" · "), communication.body].filter(Boolean).join("\n\n"),
    createdAt: communication.occurredAt,
    createdByName: communication.createdByName ?? "Unknown User",
    source: "communication",
    action: "communication.recorded",
    entityType: "communication",
    entityId: communication.communicationId,
    metadata: {
      communicationType: communication.communicationType,
      direction: communication.direction,
      source: communication.source,
      followUpAssignedTo: communication.followUpAssignedTo ?? null,
      followUpAssignedToName: communication.followUpAssignedToName ?? null,
      followUpDueDate: communication.followUpDueDate ?? null,
      externalProvider: communication.externalProvider,
      externalReference: communication.externalReference,
      externalUrl: communication.externalUrl,
      partyOrganizationId: communication.partyOrganizationId ?? null,
      contactId: communication.contactId ?? null,
      assetId: communication.assetId ?? null,
      supportingDocumentId: communication.supportingDocumentId ?? null
    }
  };
}

function auditTitle(log: AuditLog): string {
  switch (log.action) {
    case "case.created":
      return "Case created";
    case "case.updated":
      return "Case updated";
    case "case.closed":
      return "Case closed";
    case "case.close_blocked":
      return "Close attempt blocked";
    case "case.archived":
      return "Case archived";
    case "case.restored":
      return "Case restored";
    case "case_contact.added":
      return "Party attached";
    case "communication.created":
      return "Communication recorded";
    case "service_discussion.message_created":
      return "Discussion message added";
    case "service_discussion.reply_created":
      return "Discussion reply added";
    case "service_discussion.message_updated":
      return "Discussion message updated";
    case "service_discussion.message_deleted":
      return "Discussion message removed";
    case "service_discussion.attachment_uploaded":
      return "Discussion attachment uploaded";
    case "knowledge.created_from_discussion":
      return "Knowledge created from discussion";
    case "document.uploaded":
      return "Document uploaded";
    case "document.version_uploaded":
      return "Document version uploaded";
    case "document.updated":
      return "Document metadata updated";
    case "document.deleted":
      return "Document deleted";
    case "document.downloaded":
      return "Document downloaded";
    case "document.previewed":
      return "Document previewed";
    case "task.created":
      return "Task created";
    case "task.updated":
      return "Task updated";
    case "asset.created":
      return "Asset linked";
    case "asset.updated":
      return "Asset updated";
    case "asset.deleted":
      return "Asset archived";
    case "credential.created":
      return "Credential added";
    case "credential.updated":
      return "Credential updated";
    case "credential.deleted":
      return "Credential archived";
    case "credential.revealed":
      return "Credential revealed";
    case "credential.copied":
      return "Credential copied";
    default:
      return log.action
        .split(".")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
  }
}

function auditDescription(log: AuditLog): string {
  const metadata = log.metadata ?? {};
  switch (log.action) {
    case "case.created":
      return `Case ${text(metadata.caseNumber, "record")} was created.`;
    case "case.updated":
      return text(metadata.status)
        ? `Case status or details were updated. Current status: ${metadata.status}.`
        : "Case details were updated.";
    case "case.closed":
      return metadata.forced
        ? `Case was closed with an exception reason: ${text(metadata.reason, "No reason recorded")}.`
        : "Case was closed after readiness verification.";
    case "case.close_blocked": {
      const blockers = Array.isArray(metadata.blockers) ? metadata.blockers.length : 0;
      return blockers ? `Close workflow found ${blockers} unresolved blocker(s).` : "Close workflow found unresolved blockers.";
    }
    case "case.archived":
      return text(metadata.reason)
        ? `Case was archived. Reason: ${metadata.reason}.`
        : "Case was archived and removed from active work views.";
    case "case.restored":
      return text(metadata.reason)
        ? `Case was restored to active work views. Reason: ${metadata.reason}.`
        : "Case was restored to active work views.";
    case "case_contact.added":
      return text(metadata.role) ? `A contact was attached as ${metadata.role}.` : "A contact was attached to this case.";
    case "communication.created":
      return `${text(metadata.communicationType, "Communication")}: ${text(metadata.subject, "No subject recorded")}.`;
    case "service_discussion.message_created":
      return text(metadata.messageType) === "decision"
        ? "A decision was posted to the service discussion."
        : "A message was posted to the service discussion.";
    case "service_discussion.reply_created":
      return "A reply was posted to the service discussion.";
    case "service_discussion.message_updated":
      return metadata.bodyEdited
        ? "A service discussion message body was edited."
        : "A service discussion message status was updated.";
    case "service_discussion.message_deleted":
      return "A service discussion message was removed from the active discussion.";
    case "service_discussion.attachment_uploaded":
      return `${text(metadata.fileName, "A file")} was attached to the service discussion.`;
    case "knowledge.created_from_discussion":
      return `${text(metadata.title, "A knowledge item")} was created from a service discussion message.`;
    case "document.uploaded":
      return `${text(metadata.fileName, "A document")} was uploaded${text(metadata.category) ? ` as ${metadata.category}` : ""}.`;
    case "document.version_uploaded":
      return `${text(metadata.fileName, "A document")} was uploaded as a new version${text(metadata.category) ? ` in ${metadata.category}` : ""}.`;
    case "document.updated": {
      const details = [
        text(metadata.category) ? `category is ${metadata.category}` : "",
        text(metadata.reviewStatus) ? `review status is ${reviewStatusLabel(metadata.reviewStatus)}` : ""
      ].filter(Boolean);
      return `${text(metadata.fileName, "A document")} metadata was updated${details.length ? `; ${details.join("; ")}` : ""}.`;
    }
    case "document.deleted":
      return `${text(metadata.fileName, "A document")} was deleted from storage and marked inactive.`;
    case "document.downloaded":
      return `${text(metadata.fileName, "A document")} was downloaded.`;
    case "document.previewed":
      return `${text(metadata.fileName, "A document")} was previewed through the protected API.`;
    case "task.created":
      return text(metadata.title) ? `Task created: ${metadata.title}.` : "A task was created.";
    case "task.updated":
      return [
        text(metadata.title) ? `Task: ${metadata.title}` : "Task details were updated",
        text(metadata.status) ? `status ${metadata.status}` : "",
        text(metadata.priority) ? `priority ${metadata.priority}` : "",
        text(metadata.dueDate) ? `due ${metadata.dueDate}` : ""
      ]
        .filter(Boolean)
        .join("; ");
    case "asset.created":
      return `${text(metadata.name, "An asset")} was added${text(metadata.assetType) ? ` as ${metadata.assetType}` : ""}.`;
    case "asset.updated":
      return `${text(metadata.name, "An asset")} was updated${text(metadata.status) ? `; status ${metadata.status}` : ""}.`;
    case "asset.deleted":
      return `${text(metadata.name, "An asset")} was archived from active asset views.`;
    case "credential.created":
      return `${text(metadata.label, "A credential")} was added for ${text(metadata.assetName, "this asset")}.`;
    case "credential.updated":
      return `${text(metadata.label, "A credential")} was updated${metadata.secretChanged ? "; secret changed" : ""}${metadata.privateNotesChanged ? "; private notes changed" : ""}.`;
    case "credential.deleted":
      return `${text(metadata.label, "A credential")} was archived.`;
    case "credential.revealed":
      return `${text(metadata.label, "A credential")} was revealed by an authorized user.`;
    case "credential.copied":
      return `${text(metadata.label, "A credential")} secret was copied by an authorized user.`;
    default:
      return "System activity was recorded for this transaction file.";
  }
}

function auditEvent(caseId: string, log: AuditLog): CaseTimelineEvent {
  return {
    eventId: `audit:${log.auditLogId}`,
    caseId,
    type: eventType(log.action, log.entityType),
    title: auditTitle(log),
    description: auditDescription(log),
    createdAt: log.createdAt,
    createdByName: log.userName,
    source: "audit",
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    metadata: log.metadata
  };
}

export async function buildCaseTimeline(repo: AppRepository, caseId: string): Promise<CaseTimelineEvent[]> {
  const [notes, communications, auditLogs] = await Promise.all([
    repo.listNotes(caseId),
    repo.listCommunications(caseId),
    repo.listCaseAuditLogs(caseId)
  ]);
  return [
    ...notes.map(noteEvent),
    ...communications.map(communicationEvent),
    ...auditLogs.filter((log) => log.action !== "communication.created").map((log) => auditEvent(caseId, log))
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
