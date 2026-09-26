const DEFAULT_DISCUSSION_TITLE = "Untitled note";

function decodeBasicEntities(value: string) {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function plainText(value: string) {
  return decodeBasicEntities(value.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

export function deriveDiscussionTitle(bodyText: string, fallback = DEFAULT_DISCUSSION_TITLE) {
  const body = bodyText.trim();
  if (!body) return fallback;

  const htmlHeading = body.match(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i)?.[1];
  const markdownHeading = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^#{1,6}\s+/.test(line));
  const firstLine = body.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
  const candidate = htmlHeading
    ? plainText(htmlHeading)
    : markdownHeading
      ? plainText(markdownHeading.replace(/^#{1,6}\s+/, ""))
      : plainText(firstLine || body);

  if (!candidate) return fallback;
  return candidate.length > 200 ? `${candidate.slice(0, 197).trimEnd()}...` : candidate;
}

export function resolveDiscussionTitle(title: string | null | undefined, bodyText: string, fallback?: string) {
  const normalized = title?.replace(/\s+/g, " ").trim();
  if (normalized) return normalized.length > 200 ? normalized.slice(0, 200).trimEnd() : normalized;
  return deriveDiscussionTitle(bodyText, fallback);
}
