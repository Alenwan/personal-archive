import type {
  AuditLog,
  CaseContact,
  CaseRecord,
  Contact,
  DocumentRecord,
  NoteRecord,
  Tag,
  TaskRecord,
  User
} from "../shared/types";

const now = "2026-04-29T12:00:00.000Z";

export const demoUsers: User[] = [
  {
    userId: "10000000-0000-4000-8000-000000000001",
    name: "Demo Administrator",
    email: "admin@realtycase.demo",
    role: "Admin",
    createdAt: now
  },
  {
    userId: "10000000-0000-4000-8000-000000000002",
    name: "Demo Manager",
    email: "manager@realtycase.demo",
    role: "Manager",
    createdAt: now
  },
  {
    userId: "10000000-0000-4000-8000-000000000003",
    name: "Demo Staff",
    email: "staff@realtycase.demo",
    role: "Staff",
    createdAt: now
  },
  {
    userId: "10000000-0000-4000-8000-000000000004",
    name: "Demo Read-only User",
    email: "readonly@realtycase.demo",
    role: "ReadOnly",
    createdAt: now
  }
];

export const demoTags: Tag[] = [
  { tagId: "20000000-0000-4000-8000-000000000001", name: "urgent", color: "#9f3f46" },
  { tagId: "20000000-0000-4000-8000-000000000002", name: "cash-buyer", color: "#3d7257" },
  { tagId: "20000000-0000-4000-8000-000000000003", name: "mortgage", color: "#345f7d" },
  { tagId: "20000000-0000-4000-8000-000000000004", name: "inspection-open", color: "#b98d3a" },
  { tagId: "20000000-0000-4000-8000-000000000005", name: "title-review", color: "#2c827f" },
  { tagId: "20000000-0000-4000-8000-000000000006", name: "closing-week", color: "#6f5fa8" }
];

export const demoCases: CaseRecord[] = [];

export const demoContacts: Contact[] = [];

export const demoCaseContacts: CaseContact[] = [];

export const demoDocuments: DocumentRecord[] = [];

export const demoNotes: NoteRecord[] = [];

export const demoTasks: TaskRecord[] = [];

export const demoAuditLogs: AuditLog[] = [];
