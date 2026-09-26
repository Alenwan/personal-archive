import { createApp, h, ref } from "vue";
import "../src/styles.css";
import ManuscriptReaderDialog from "../src/components/reading/ManuscriptReaderDialog.vue";
import type { Manuscript } from "../src/shared/types";
const now = new Date().toISOString();
const manuscript = ref<Manuscript>({ manuscriptId: "10000000-0000-4000-8000-000000000001", title: "Synthetic bookmark novel", kind: "Novel", status: "Draft", description: "", encryptionEnabled: false, chapterCount: 2, characterCount: 200000, createdAt: now, updatedAt: now,
  chapters: [1, 2].map((n) => ({ chapterId: `20000000-0000-4000-8000-00000000000${n}`, manuscriptId: "10000000-0000-4000-8000-000000000001", title: `Chapter ${n}`, contentFormat: n === 1 ? "markdown" : "rich-text", sortOrder: n, characterCount: 100000, revision: 1, lastSaveSource: "manual", createdAt: now, updatedAt: now })) });
const open = ref(true);
Object.assign(window, { bookmarkFixture: { manuscript, open } });
createApp({ render: () => h(ManuscriptReaderDialog, { modelValue: open.value, manuscript: manuscript.value, "onUpdate:modelValue": (value: boolean) => { open.value = value; } }) }).mount("#app");
