import { strToU8, zipSync, type Zippable } from "fflate";
import { marked } from "marked";
import type { DocumentRecord, Manuscript, ManuscriptChapter } from "../../shared/types";

export interface ManuscriptExportAsset {
  document: DocumentRecord;
  body: Uint8Array;
}

export interface ManuscriptExportResult {
  body: Uint8Array<ArrayBuffer>;
  fileName: string;
  includedImageCount: number;
  missingImageIds: string[];
}

type ManuscriptExportInput = {
  manuscript: Manuscript;
  chapters: ManuscriptChapter[];
  loadAsset: (documentId: string) => Promise<ManuscriptExportAsset | null>;
  exportedAt?: Date;
};

type ExportImage = {
  documentId: string;
  archivePath: string;
  fileName: string;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  body: Uint8Array;
};

const INTERNAL_DOCUMENT_PATTERN = /(?<![A-Za-z0-9:])\/api\/documents\/([0-9a-fA-F-]{36})\/preview(?:\?[^)\s"'<>]*)?/g;

function portableFileSegment(value: string, fallback: string, maximumLength = 100): string {
  const cleaned = value
    .normalize("NFC")
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, maximumLength);
  return cleaned || fallback;
}

function markdownHeading(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeRelaxedMarkdownHeadings(source: string): string {
  let fenced = false;
  return source.split("\n").map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return line;
    }
    if (fenced) return line;
    const compactHeading = line.match(/^(\s{0,3})(#{1,6})(?!#)([^\s#].*)$/);
    return compactHeading
      ? `${compactHeading[1]}${compactHeading[2]} ${compactHeading[3]}`
      : line;
  }).join("\n");
}

function documentIdsFromBodies(chapters: ManuscriptChapter[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const chapter of chapters) {
    for (const match of chapter.body.matchAll(new RegExp(INTERNAL_DOCUMENT_PATTERN.source, "g"))) {
      const documentId = match[1].toLowerCase();
      if (seen.has(documentId)) continue;
      seen.add(documentId);
      ids.push(documentId);
    }
  }
  return ids;
}

function rewriteDocumentReferences(source: string, images: Map<string, ExportImage>, prefix: string): string {
  return source.replace(new RegExp(INTERNAL_DOCUMENT_PATTERN.source, "g"), (original, rawDocumentId: string) => {
    const image = images.get(rawDocumentId.toLowerCase());
    return image ? `${prefix}${image.fileName}` : original;
  });
}

function chapterMarkdown(chapter: ManuscriptChapter, body: string): string {
  const formatNote = chapter.contentFormat === "rich-text"
    ? "<!-- Original format: rich text. HTML is kept inside this Markdown file to preserve formatting. -->\n\n"
    : "";
  return `# ${markdownHeading(chapter.title)}\n\n${formatNote}${body.trim()}\n`;
}

function combinedMarkdown(manuscript: Manuscript, chapters: ManuscriptChapter[], images: Map<string, ExportImage>, exportedAt: Date): string {
  const lines = [
    `# ${markdownHeading(manuscript.title)}`,
    "",
    `> ${manuscript.kind} · ${manuscript.status} · exported ${exportedAt.toISOString()}`,
    ""
  ];
  if (manuscript.description.trim()) lines.push(manuscript.description.trim(), "");
  chapters.forEach((chapter, index) => {
    if (chapters.length > 1) lines.push(`## ${markdownHeading(chapter.title)}`, "");
    if (chapter.contentFormat === "rich-text") {
      lines.push("<!-- Rich-text HTML is embedded below so its formatting is not lost. -->", "");
    }
    lines.push(rewriteDocumentReferences(chapter.body, images, "images/").trim(), "");
    if (index < chapters.length - 1) lines.push("---", "");
  });
  return `${lines.join("\n").trim()}\n`;
}

function combinedHtml(manuscript: Manuscript, chapters: ManuscriptChapter[], images: Map<string, ExportImage>, exportedAt: Date): string {
  const chapterSections = chapters.map((chapter, index) => {
    const source = rewriteDocumentReferences(chapter.body, images, "images/");
    const rendered = chapter.contentFormat === "markdown"
      ? String(marked.parse(normalizeRelaxedMarkdownHeadings(source), { async: false, breaks: true, gfm: true }))
      : source;
    const heading = chapters.length > 1 ? `<h2>${escapeHtml(chapter.title)}</h2>` : "";
    return `<section class="chapter" data-part="${index + 1}">${heading}${rendered}</section>`;
  }).join("\n<hr>\n");
  const description = manuscript.description.trim()
    ? `<p class="description">${escapeHtml(manuscript.description)}</p>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data: https: http:; style-src 'unsafe-inline';">
  <title>${escapeHtml(manuscript.title)}</title>
  <style>
    :root { color-scheme: light; font-family: Georgia, 'Noto Serif SC', serif; }
    body { max-width: 780px; margin: 0 auto; padding: 48px 28px 96px; color: #302a22; background: #fbf7ef; font-size: 18px; line-height: 1.78; }
    h1, h2, h3, h4, h5, h6 { line-height: 1.25; }
    h1 { margin-bottom: .35em; font-size: 2.35rem; }
    h2 { margin-top: 2.5em; font-size: 1.65rem; }
    .meta, .description { color: #746a5b; }
    .meta { margin-bottom: 2.5rem; font-size: .84rem; }
    .description { padding-left: 1rem; border-left: 3px solid #c9bda9; }
    .chapter { margin-top: 3rem; }
    img { display: block; max-width: 100%; height: auto; margin: 1.5rem auto; }
    figure { margin: 1.5rem 0; }
    figcaption { color: #746a5b; font-size: .82rem; text-align: center; }
    blockquote { margin-left: 0; padding-left: 1rem; border-left: 3px solid #c9bda9; color: #5f574d; }
    pre, code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    pre { overflow-x: auto; padding: 1rem; background: #eee7dc; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #c9bda9; padding: .45rem .6rem; }
    hr { margin: 4rem 0; border: 0; border-top: 1px solid #c9bda9; }
    a { color: #266d67; }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(manuscript.title)}</h1>
    ${description}
    <p class="meta">${escapeHtml(manuscript.kind)} · ${escapeHtml(manuscript.status)} · exported ${escapeHtml(exportedAt.toISOString())}</p>
  </header>
  <main>${chapterSections}</main>
</body>
</html>
`;
}

function readme(manuscript: Manuscript, chapters: ManuscriptChapter[], images: ExportImage[], missingImageIds: string[], exportedAt: Date): string {
  return `# ${markdownHeading(manuscript.title)} — portable export

Exported from Personal Archive at ${exportedAt.toISOString()}.

## Contents

- \`${portableFileSegment(manuscript.title, "manuscript")}.md\`: the complete work in one Markdown-compatible file.
- \`${portableFileSegment(manuscript.title, "manuscript")}.html\`: the complete work as a standalone reading page.
- \`chapters/\`: one Markdown-compatible file per part, in reading order.
- \`source/\`: each part in its original Markdown or rich-text HTML format.
- \`images/\`: ${images.length} embedded Archive image${images.length === 1 ? "" : "s"} copied into the package.
- \`manifest.json\`: work metadata, chapter order, revisions, and image references.

The export contains ${chapters.length} part${chapters.length === 1 ? "" : "s"} and ${manuscript.characterCount} characters.
${missingImageIds.length ? `\nWarning: ${missingImageIds.length} referenced image${missingImageIds.length === 1 ? " was" : "s were"} unavailable and could not be copied. See \`manifest.json\`.\n` : ""}
`;
}

export async function buildManuscriptExport(input: ManuscriptExportInput): Promise<ManuscriptExportResult> {
  const exportedAt = input.exportedAt ?? new Date();
  const orderedChapters = [...input.chapters].sort((left, right) => left.sortOrder - right.sortOrder || left.createdAt.localeCompare(right.createdAt));
  const imageIds = documentIdsFromBodies(orderedChapters);
  const images: ExportImage[] = [];
  const missingImageIds: string[] = [];

  for (const [index, documentId] of imageIds.entries()) {
    const asset = await input.loadAsset(documentId);
    if (!asset) {
      missingImageIds.push(documentId);
      continue;
    }
    const originalFileName = asset.document.originalFileName || asset.document.fileName || `image-${index + 1}`;
    const fileName = `${String(index + 1).padStart(3, "0")}-${portableFileSegment(originalFileName, `image-${index + 1}`)}`;
    images.push({
      documentId,
      archivePath: `images/${fileName}`,
      fileName,
      originalFileName,
      mimeType: asset.document.mimeType,
      fileSize: asset.document.fileSize,
      body: asset.body
    });
  }

  const imageMap = new Map(images.map((image) => [image.documentId.toLowerCase(), image]));
  const workFileName = portableFileSegment(input.manuscript.title, "manuscript");
  const root = `${workFileName}-export`;
  const files: Zippable = {};
  const addText = (path: string, value: string) => { files[`${root}/${path}`] = strToU8(value); };

  addText(`${workFileName}.md`, combinedMarkdown(input.manuscript, orderedChapters, imageMap, exportedAt));
  addText(`${workFileName}.html`, combinedHtml(input.manuscript, orderedChapters, imageMap, exportedAt));

  orderedChapters.forEach((chapter, index) => {
    const prefix = `${String(index + 1).padStart(3, "0")}-${portableFileSegment(chapter.title, `part-${index + 1}`, 80)}`;
    const rewritten = rewriteDocumentReferences(chapter.body, imageMap, "../images/");
    addText(`chapters/${prefix}.md`, chapterMarkdown(chapter, rewritten));
    addText(
      `source/${prefix}.${chapter.contentFormat === "markdown" ? "md" : "html"}`,
      chapter.contentFormat === "markdown"
        ? `${rewritten.trim()}\n`
        : `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data: https: http:; style-src 'unsafe-inline';"><title>${escapeHtml(chapter.title)}</title></head><body>${rewritten}</body></html>\n`
    );
  });

  images.forEach((image) => {
    files[`${root}/${image.archivePath}`] = [image.body, { level: 0 }];
  });

  const manifest = {
    formatVersion: 1,
    source: "Personal Archive",
    exportedAt: exportedAt.toISOString(),
    manuscript: {
      manuscriptId: input.manuscript.manuscriptId,
      title: input.manuscript.title,
      kind: input.manuscript.kind,
      status: input.manuscript.status,
      description: input.manuscript.description,
      characterCount: input.manuscript.characterCount,
      createdAt: input.manuscript.createdAt,
      updatedAt: input.manuscript.updatedAt
    },
    chapters: orderedChapters.map((chapter, index) => ({
      position: index + 1,
      chapterId: chapter.chapterId,
      title: chapter.title,
      contentFormat: chapter.contentFormat,
      sortOrder: chapter.sortOrder,
      characterCount: chapter.characterCount,
      revision: chapter.revision,
      lastSaveSource: chapter.lastSaveSource,
      createdAt: chapter.createdAt,
      updatedAt: chapter.updatedAt
    })),
    images: images.map(({ body: _body, ...image }) => image),
    missingImageIds
  };
  addText("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  addText("README.md", readme(input.manuscript, orderedChapters, images, missingImageIds, exportedAt));

  const body = zipSync(files, { level: 6 });
  return {
    body,
    fileName: `${workFileName}-${exportedAt.toISOString().slice(0, 10)}.zip`,
    includedImageCount: images.length,
    missingImageIds
  };
}
