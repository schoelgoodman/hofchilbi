import MarkdownIt from "markdown-it";
import { raw, type Raw } from "./html.ts";

/**
 * Markdown from the editor → HTML. Raw HTML in Markdown is escaped (html: false) and
 * markdown-it's validateLink drops javascript:/vbscript:/data: links, so editor text can never
 * inject script. External links open in a new tab.
 */
// breaks: false = same as Milkdown: a single newline is a space, a hard break (Shift+Enter, saved
// as "\\" at line end) is a line break. What editors see is what the site shows.
const md = new MarkdownIt({ html: false, linkify: true, typographer: false, breaks: false });

const defaultLink = md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const href = String(tokens[idx]!.attrGet("href") ?? "");
  if (/^https?:\/\//i.test(href)) {
    tokens[idx]!.attrSet("target", "_blank");
    tokens[idx]!.attrSet("rel", "noopener");
  }
  return defaultLink(tokens, idx, options, env, self);
};

/** Headings in editor text start at h3: h1 is the page title, h2 the section. */
md.core.ruler.push("shift_headings", (state) => {
  for (const t of state.tokens) {
    if ((t.type === "heading_open" || t.type === "heading_close") && /^h[1-6]$/.test(t.tag)) {
      t.tag = `h${Math.min(6, Number(t.tag[1]) + 2)}`;
    }
  }
});

export function markdown(text: string): Raw {
  return raw(md.render(text));
}

/** Plain text (for meta descriptions). */
export function markdownText(text: string): string {
  return md
    .render(text)
    .replace(/<\/(p|h\d|li|blockquote)>|<br\s*\/?>/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
