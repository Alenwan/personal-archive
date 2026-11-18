import { marked, Renderer, type Tokens } from "marked";
import { normalizeRelaxedMarkdownHeadings } from "./manuscriptContent";
import type { MarkdownSourceMap } from "./manuscriptViewport";

/** Render-only spans map actual DOM characters to source offsets. Never saved. */
export function positionedMarkdown(source: string): { html: string; positions: MarkdownSourceMap } {
  const normalized = normalizeRelaxedMarkdownHeadings(source.replace(/\r\n?/g, "\n"));
  const originals: number[] = [];
  let cursor = 0;
  for (const char of normalized) {
    // The normalizer only inserts a heading space and normalizes CRLF.
    if (char === " " && source[cursor] !== " ") { originals.push(cursor); continue; }
    if (char === "\n" && source[cursor] === "\r" && source[cursor + 1] === "\n") cursor++;
    for (let i = 0; i < char.length; i++) originals.push(cursor++);
  }
  const positions: MarkdownSourceMap = new Map();
  const decoder = document.createElement("textarea");
  const decode = (value: string) => { decoder.innerHTML = value; return decoder.value; };
  let current = 0, limit = normalized.length;
  class PositionRenderer extends Renderer {
    within(token: { raw: string }, render: () => string, leaf = false, code = false, htmlBlock = false) {
      const parentLimit = limit;
      const found = normalized.indexOf(token.raw, current);
      const exact = found >= current && found + token.raw.length <= limit;
      const start = exact ? found : current;
      const end = exact ? start + token.raw.length : limit;
      current = start; limit = end;
      let html = render();
      if (leaf) {
        // Raw HTML has not reached the reader's sanitizer yet. Parse only in an
        // inert document; never create event-bearing nodes in the live page.
        const inert = new DOMParser().parseFromString(`<body><div id="source-map-fragment">${html}</div></body>`, "text/html");
        const fragment = inert.getElementById("source-map-fragment")!;
        const text = (code && html.startsWith("<pre>") ? fragment.querySelector("code")?.textContent : fragment.textContent) ?? "";
        let search = start;
        if (code && /^ {0,3}(`{3,}|~{3,})/.test(token.raw)) search = normalized.indexOf("\n", start) + 1;
        else if (code && token.raw.startsWith("`")) search += token.raw.match(/^`+/)![0].length;
        const chars: string[] = [], offsets: number[] = [], normalizedOffsets: number[] = [];
        for (let i = search; i < end; i++) {
          const tag = htmlBlock && normalized[i] === "<" ? normalized.slice(i, end).match(/^(?:<!--[\s\S]*?-->|<(?:[^>"']|"[^"]*"|'[^']*')*>)/)?.[0] : null;
          if (tag) { i += tag.length - 1; continue; }
          const entity = !code && normalized[i] === "&" ? normalized.slice(i, end).match(/^&(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);/i)?.[0] : null;
          const value = entity ? decode(entity) : normalized[i];
          for (let j = 0; j < value.length; j++) { chars.push(value[j]); offsets.push(originals[i]); normalizedOffsets.push(i); }
          if (entity) i += entity.length - 1;
        }
        const map: number[] = [];
        let at = 0;
        for (let i = 0; i < text.length; i++) {
          while (at < chars.length && chars[at] !== text[i] && !(code && /\s/.test(chars[at]) && /\s/.test(text[i]))) at++;
          if (at >= chars.length) break;
          map.push(offsets[at++]);
        }
        if (map.length === text.length && map.length) {
          const id = String(positions.size);
          positions.set(id, map);
          // Span inside <code> preserves preformatted whitespace/layout.
          html = code && html.startsWith("<pre>")
            ? html.replace(/(<code[^>]*>)([\s\S]*)(<\/code>)/, `$1<span data-manuscript-source="${id}">$2</span>$3`)
            : htmlBlock ? `<div data-manuscript-source="${id}">${html}</div>` : `<span data-manuscript-source="${id}">${html}</span>`;
          current = Math.max(current, at ? normalizedOffsets[at - 1] + 1 : start);
        }
      }
      if (exact) current = end;
      limit = parentLimit;
      return html;
    }
    override paragraph(t: Tokens.Paragraph) { return this.within(t, () => super.paragraph(t)); }
    override def(t: Tokens.Def) { return this.within(t, () => super.def(t)); }
    override hr(t: Tokens.Hr) { return this.within(t, () => super.hr(t)); }
    override heading(t: Tokens.Heading) { return this.within(t, () => super.heading(t)); }
    override blockquote(t: Tokens.Blockquote) { return this.within(t, () => super.blockquote(t)); }
    override list(t: Tokens.List) { return this.within(t, () => super.list(t)); }
    override listitem(t: Tokens.ListItem) { return this.within(t, () => super.listitem(t)); }
    override table(t: Tokens.Table) { return this.within(t, () => super.table(t)); }
    override strong(t: Tokens.Strong) { return this.within(t, () => super.strong(t)); }
    override em(t: Tokens.Em) { return this.within(t, () => super.em(t)); }
    override del(t: Tokens.Del) { return this.within(t, () => super.del(t)); }
    override link(t: Tokens.Link) { return this.within(t, () => super.link(t)); }
    override image(t: Tokens.Image) {
      return this.within(t, () => {
        const id = String(positions.size); positions.set(id, [originals[current]]);
        return super.image(t).replace("<img", `<img data-manuscript-source="${id}"`);
      });
    }
    override br(t: Tokens.Br) { return this.within(t, () => super.br(t)); }
    override text(t: Tokens.Text | Tokens.Escape) { return this.within(t, () => super.text(t), !("tokens" in t && t.tokens)); }
    override codespan(t: Tokens.Codespan) { return this.within(t, () => super.codespan(t), true, true); }
    override code(t: Tokens.Code) { return this.within(t, () => super.code(t), true, true); }
    override html(t: Tokens.HTML | Tokens.Tag) { return this.within(t, () => super.html(t), "block" in t && t.block, false, true); }
  }
  return { html: String(marked.parse(normalized, { async: false, breaks: true, gfm: true, renderer: new PositionRenderer() })), positions };
}
