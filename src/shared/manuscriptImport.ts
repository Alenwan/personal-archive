import DOMPurify from "dompurify";
import { unzipSync } from "fflate";
import type { ManuscriptChapterFormat, ManuscriptKind } from "./types";

const MAX_IMPORT_FILE_BYTES = 50 * 1024 * 1024;
const MAX_EPUB_TEXT_BYTES = 100 * 1024 * 1024;
const MAX_CHAPTER_BODY_LENGTH = 12_000_000;
const MAX_CHAPTER_TEXT_LENGTH = 2_000_000;
const MAX_EPUB_CHAPTERS = 1000;

const IMPORTED_RICH_TEXT_TAGS = [
  "a", "b", "blockquote", "br", "code", "del", "div", "em", "figcaption", "figure", "h1", "h2", "h3", "h4",
  "h5", "h6", "hr", "i", "li", "ol", "p", "pre", "s", "small", "span", "strike", "strong", "sub", "sup", "table",
  "tbody", "td", "th", "thead", "tr", "u", "ul"
];

export const MANUSCRIPT_IMPORT_ACCEPT = ".txt,.md,.markdown,.epub,text/plain,text/markdown,application/epub+zip";
export const MANUSCRIPT_IMPORT_MAX_FILES = 50;

export interface ImportedManuscriptChapter {
  title: string;
  body: string;
  contentFormat: ManuscriptChapterFormat;
}

export interface ImportedManuscript {
  title: string;
  kind: ManuscriptKind;
  description: string;
  chapters: ImportedManuscriptChapter[];
}

function truncate(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  return value.slice(0, Math.max(1, maximum - 1)).trimEnd() + "…";
}

function extensionFor(fileName: string): string {
  return fileName.toLowerCase().split(".").pop() ?? "";
}

function titleFromFileName(fileName: string): string {
  return truncate(fileName.replace(/\.(?:txt|md|markdown|epub)$/i, "").trim() || "Imported work", 240);
}

function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder("gb18030", { fatal: true }).decode(bytes);
    } catch {
      throw new Error("The text encoding is not supported. Save the file as UTF-8, UTF-16, or GB18030 and try again.");
    }
  }
}

function normalizeArchivePath(value: string): string {
  let decoded = value.split("#")[0] || "";
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Keep malformed percent sequences literal so the import can still try the archive path.
  }
  const parts: string[] = [];
  for (const part of decoded.replace(/\\/g, "/").replace(/^\/+/, "").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function resolveArchivePath(baseFile: string, href: string): string {
  const cleanHref = href.split("#")[0] || "";
  if (!cleanHref) return normalizeArchivePath(baseFile);
  const baseDirectory = baseFile.split("/").slice(0, -1).join("/");
  return normalizeArchivePath(cleanHref.startsWith("/") ? cleanHref : `${baseDirectory}/${cleanHref}`);
}

function xmlElements(documentNode: XMLDocument, localName: string): Element[] {
  return Array.from(documentNode.getElementsByTagNameNS("*", localName));
}

function parseXml(source: string, label: string): XMLDocument {
  const documentNode = new DOMParser().parseFromString(source, "application/xml");
  if (documentNode.querySelector("parsererror")) throw new Error(`${label} is malformed.`);
  return documentNode;
}

function extractArchiveFiles(
  archive: Uint8Array,
  wantedPaths: Set<string>,
  maximumBytes = MAX_EPUB_TEXT_BYTES
): Record<string, Uint8Array> {
  let extractedBytes = 0;
  const files = unzipSync(archive, {
    filter: (file) => {
      const wanted = wantedPaths.has(normalizeArchivePath(file.name));
      if (!wanted) return false;
      extractedBytes += file.originalSize;
      if (extractedBytes > maximumBytes) throw new Error("The EPUB contains too much extracted text to import safely.");
      return true;
    }
  });
  return Object.fromEntries(
    Object.entries(files).map(([path, bytes]) => [normalizeArchivePath(path), bytes])
  );
}

function bodyFromHtml(source: string): HTMLElement {
  const documentNode = new DOMParser().parseFromString(source, "text/html");
  return documentNode.body;
}

function sanitizeImportedHtml(source: string): { html: string; textLength: number } {
  const body = bodyFromHtml(source);
  body.querySelectorAll("script, style, iframe, object, embed, form, input, button, video, audio, picture, source, svg, canvas").forEach((node) => node.remove());
  body.querySelectorAll("img").forEach((image) => image.remove());
  body.querySelectorAll("a[href]").forEach((link) => {
    const href = link.getAttribute("href")?.trim() ?? "";
    if (href && !/^(?:#|https?:|mailto:)/i.test(href)) link.removeAttribute("href");
  });
  const textLength = body.textContent?.length ?? 0;
  const html = String(DOMPurify.sanitize(body.innerHTML, {
    ALLOWED_TAGS: IMPORTED_RICH_TEXT_TAGS,
    ALLOWED_ATTR: ["colspan", "href", "rowspan", "title"],
    ALLOW_DATA_ATTR: false,
    FORBID_ATTR: ["style"]
  })).trim();
  if (html.length > MAX_CHAPTER_BODY_LENGTH || textLength > MAX_CHAPTER_TEXT_LENGTH) {
    throw new Error("A chapter is too large for Long Writing. Split the source into smaller chapters and try again.");
  }
  return { html, textLength };
}

function plainTextToRichText(source: string): string {
  const documentNode = new DOMParser().parseFromString("<main></main>", "text/html");
  const container = documentNode.createElement("main");
  let paragraph: string[] = [];
  const flush = () => {
    if (!paragraph.length) return;
    const element = documentNode.createElement("p");
    paragraph.forEach((line, index) => {
      if (index) element.appendChild(documentNode.createElement("br"));
      element.appendChild(documentNode.createTextNode(line));
    });
    container.appendChild(element);
    paragraph = [];
  };
  source.replace(/\r\n?/g, "\n").split("\n").forEach((line) => {
    if (!line.trim()) flush();
    else paragraph.push(line);
  });
  flush();
  return container.innerHTML;
}

function chapterTitleFromHtml(source: string, fallbackIndex: number): string {
  const documentNode = new DOMParser().parseFromString(source, "text/html");
  const title = documentNode.querySelector("h1, h2, h3, title")?.textContent?.trim();
  return truncate(title || `Chapter ${fallbackIndex + 1}`, 240);
}

function epubNavigationTitles(
  manifest: Map<string, { path: string; mediaType: string; properties: string }>,
  files: Record<string, Uint8Array>
): Map<string, string> {
  const titles = new Map<string, string>();
  const navItem = [...manifest.values()].find((item) => item.properties.split(/\s+/).includes("nav"));
  if (navItem && files[navItem.path]) {
    const navDocument = new DOMParser().parseFromString(decodeText(files[navItem.path]), "text/html");
    const nav = [...navDocument.querySelectorAll("nav")].find((item) => item.getAttribute("epub:type") === "toc")
      ?? navDocument.querySelector("nav");
    nav?.querySelectorAll("a[href]").forEach((link) => {
      const path = resolveArchivePath(navItem.path, link.getAttribute("href") || "");
      const label = link.textContent?.trim();
      if (path && label && !titles.has(path)) titles.set(path, label);
    });
  }

  const ncxItem = [...manifest.values()].find((item) => item.mediaType === "application/x-dtbncx+xml");
  if (ncxItem && files[ncxItem.path]) {
    const ncx = parseXml(decodeText(files[ncxItem.path]), "The EPUB table of contents");
    xmlElements(ncx, "navPoint").forEach((point) => {
      const directChildren = Array.from(point.children);
      const content = directChildren.find((child) => child.localName === "content");
      const navLabel = directChildren.find((child) => child.localName === "navLabel");
      const label = navLabel
        ? Array.from(navLabel.children).find((child) => child.localName === "text")?.textContent?.trim()
        : "";
      const source = content?.getAttribute("src") ?? "";
      const path = resolveArchivePath(ncxItem.path, source);
      if (path && label && !titles.has(path)) titles.set(path, label);
    });
  }
  return titles;
}

async function importTextFile(file: File, format: "txt" | "md" | "markdown"): Promise<ImportedManuscript> {
  const source = decodeText(new Uint8Array(await file.arrayBuffer())).replace(/^\uFEFF/, "");
  if (!source.trim()) throw new Error("The file does not contain any text.");
  const markdown = format !== "txt";
  const body = markdown ? source : plainTextToRichText(source);
  const textLength = markdown ? source.length : bodyFromHtml(body).textContent?.length ?? 0;
  if (body.length > MAX_CHAPTER_BODY_LENGTH || textLength > MAX_CHAPTER_TEXT_LENGTH) {
    throw new Error("The file is too large for one Long Writing chapter.");
  }
  return {
    title: titleFromFileName(file.name),
    kind: "Long document",
    description: `Imported from ${file.name}.`,
    chapters: [{
      title: markdown ? "Chapter 1" : "Text",
      body,
      contentFormat: markdown ? "markdown" : "rich-text"
    }]
  };
}

async function importEpubFile(file: File): Promise<ImportedManuscript> {
  const archive = new Uint8Array(await file.arrayBuffer());
  const containerPath = "META-INF/container.xml";
  const containerFiles = extractArchiveFiles(archive, new Set([containerPath]), 1024 * 1024);
  if (!containerFiles[containerPath]) throw new Error("The EPUB does not contain META-INF/container.xml.");
  const container = parseXml(decodeText(containerFiles[containerPath]), "The EPUB container");
  const packagePath = normalizeArchivePath(xmlElements(container, "rootfile")[0]?.getAttribute("full-path") ?? "");
  if (!packagePath) throw new Error("The EPUB package document could not be found.");

  const packageFiles = extractArchiveFiles(archive, new Set([packagePath]), 4 * 1024 * 1024);
  if (!packageFiles[packagePath]) throw new Error("The EPUB package document could not be read.");
  const packageDocument = parseXml(decodeText(packageFiles[packagePath]), "The EPUB package document");
  const manifest = new Map<string, { path: string; mediaType: string; properties: string }>();
  xmlElements(packageDocument, "item").forEach((item) => {
    const id = item.getAttribute("id") || "";
    const href = item.getAttribute("href") || "";
    if (!id || !href) return;
    manifest.set(id, {
      path: resolveArchivePath(packagePath, href),
      mediaType: item.getAttribute("media-type") || "application/octet-stream",
      properties: item.getAttribute("properties") || ""
    });
  });

  const spine = xmlElements(packageDocument, "itemref")
    .map((itemRef) => manifest.get(itemRef.getAttribute("idref") || ""))
    .filter((item): item is { path: string; mediaType: string; properties: string } => Boolean(item));
  if (!spine.length) throw new Error("No readable chapters were found in this EPUB.");
  if (spine.length > MAX_EPUB_CHAPTERS) throw new Error(`This EPUB has more than ${MAX_EPUB_CHAPTERS} chapters.`);

  const navItems = [...manifest.values()].filter((item) =>
    item.properties.split(/\s+/).includes("nav") || item.mediaType === "application/x-dtbncx+xml"
  );
  const wantedPaths = new Set([...spine.map((item) => item.path), ...navItems.map((item) => item.path)]);
  const contentFiles = extractArchiveFiles(archive, wantedPaths);
  const navigationTitles = epubNavigationTitles(manifest, contentFiles);
  const chapters: ImportedManuscriptChapter[] = [];
  spine.forEach((item, index) => {
    const bytes = contentFiles[item.path];
    if (!bytes) return;
    const source = decodeText(bytes);
    const sanitized = sanitizeImportedHtml(source);
    if (!sanitized.textLength || !sanitized.html) return;
    chapters.push({
      title: truncate(navigationTitles.get(item.path)?.trim() || chapterTitleFromHtml(source, index), 240),
      body: sanitized.html,
      contentFormat: "rich-text"
    });
  });
  if (!chapters.length) throw new Error("No readable text chapters were found in this EPUB.");

  const metadataTitle = xmlElements(packageDocument, "title")[0]?.textContent?.trim();
  return {
    title: truncate(metadataTitle || titleFromFileName(file.name), 240),
    kind: "Long document",
    description: `Imported from ${file.name}. EPUB text and basic formatting were imported; embedded images and styles were skipped.`,
    chapters
  };
}

export async function importManuscriptFile(file: File): Promise<ImportedManuscript> {
  if (file.size > MAX_IMPORT_FILE_BYTES) throw new Error("The file is larger than the 50 MB import limit.");
  const extension = extensionFor(file.name);
  if (extension === "txt" || extension === "md" || extension === "markdown") return importTextFile(file, extension);
  if (extension === "epub") return importEpubFile(file);
  throw new Error("Unsupported file type. Choose TXT, Markdown, or EPUB files.");
}
