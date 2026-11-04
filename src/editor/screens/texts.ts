import { api, thumb, type NewsEntry } from "../api.ts";
import { confirmDialog, h, toast } from "../dom.ts";
import { Form, checkbox, handleSaveError, image, saveBar, text } from "../form.ts";
import type { MarkdownEditor } from "../markdown.ts";
import type { Ctx } from "./doc.ts";

/** Disposes the Milkdown instance of the previous screen. */
let activeEditor: MarkdownEditor | null = null;
export async function disposeEditor(): Promise<void> {
  const e = activeEditor;
  activeEditor = null;
  await e?.destroy().catch(() => undefined);
}

/** Form with metadata fields + Milkdown body + save bar. */
function textEditor(
  ctx: Ctx,
  meta: Record<string, unknown>,
  body: string,
  fields: (f: Form) => (HTMLElement | null)[],
  save: (meta: unknown, body: string) => Promise<void>,
  extra: HTMLElement[] = [],
): HTMLElement {
  const form = new Form({ meta, body });
  const metaBox = h("div", { class: "form" });
  const editorBox = h("div", { class: "md" });
  const bar = saveBar(async () => {
    try {
      await save(form.draft.meta, form.draft.body);
      form.markSaved();
      renderMeta();
    } catch (err) {
      bar.setDirty(true);
      handleSaveError(err, form);
    }
  }, extra);
  const renderMeta = () => metaBox.replaceChildren(...fields(form).filter((x): x is HTMLElement => x !== null));
  form.onStructure = renderMeta;
  form.onDirty = (d) => bar.setDirty(d);
  ctx.guard(() => form.dirty());
  renderMeta();
  // Milkdown is large: loaded only when a text screen opens.
  editorBox.append(h("p", { class: "muted md__loading" }, "Editor wird geladen …"));
  import("../markdown.ts")
    .then(({ markdownEditor }) => {
      editorBox.replaceChildren();
      return markdownEditor(editorBox, body, (md) => form.set("body", md));
    })
    .then((ed) => (activeEditor = ed))
    .catch(() => toast("Der Texteditor konnte nicht geladen werden. Bitte Seite neu laden.", "error"));
  return h("div", {}, metaBox, h("div", { class: "field" }, h("span", { class: "label" }, "Text"), editorBox), bar.el);
}

// ---------------------------------------------------------------- News
export function newsScreen(ctx: Ctx, slug?: string): HTMLElement {
  const news = ctx.state.news;
  const current = news.find((n) => n.slug === slug);
  const listEl = h(
    "ul",
    { class: "newslist" },
    news.map((n) =>
      h(
        "li",
        { class: n.slug === slug ? "is-active" : "" },
        h(
          "a",
          { href: `#/news/${n.slug}` },
          n.meta.image ? h("img", { src: thumb(n.meta.image, 120), alt: "", loading: "lazy" }) : h("span", { class: "newslist__noimg" }),
          h("span", {}, h("strong", {}, n.meta.title), h("small", {}, `${fmt(n.meta.date)}${n.meta.draft ? " · Entwurf (nicht sichtbar)" : ""}`)),
        ),
      ),
    ),
  );
  const create = h(
    "form",
    {
      class: "row",
      onsubmit: async (e: Event) => {
        e.preventDefault();
        const title = input.value.trim();
        if (!title) return;
        try {
          const { slug: s } = await api.createNews(title);
          await ctx.reload();
          location.hash = `#/news/${s}`;
        } catch (err) {
          handleSaveError(err);
        }
      },
    },
  );
  const input = h("input", { type: "text", placeholder: "Titel der neuen News", "aria-label": "Titel der neuen News" });
  create.append(input, h("button", { type: "submit", class: "btn btn--primary" }, "+ News anlegen"));

  return h(
    "div",
    { class: "screen" },
    h("h1", {}, "News"),
    h("p", { class: "intro" }, "News erscheinen oben auf der Startseite, die neueste zuerst. Neue News sind zuerst ein Entwurf und erst sichtbar, wenn «Entwurf» ausgeschaltet ist."),
    create,
    h("div", { class: "split" }, listEl, current ? newsEditor(ctx, current) : h("p", { class: "muted" }, news.length ? "Links eine News auswählen." : "Noch keine News.")),
  );
}

function newsEditor(ctx: Ctx, n: NewsEntry): HTMLElement {
  let base = n.version;
  const del = h(
    "button",
    {
      type: "button",
      class: "btn btn--danger-ghost",
      onclick: async () => {
        if (!(await confirmDialog(`News «${n.meta.title}» löschen? Sie lässt sich im Verlauf wiederherstellen.`))) return;
        try {
          await api.deleteNews(n.slug, base);
          ctx.guard(() => false);
          await ctx.reload();
          location.hash = "#/news";
          toast("Gelöscht.");
        } catch (err) {
          handleSaveError(err);
        }
      },
    },
    "Löschen",
  );
  return h(
    "div",
    { class: "editor" },
    textEditor(
      ctx,
      { ...n.meta, draft: Boolean(n.meta.draft) },
      n.body,
      (f) => [
        text(f, "meta.title", "Titel"),
        text(f, "meta.date", "Datum", { type: "date" }),
        checkbox(f, "meta.draft", "Entwurf (auf der Website noch nicht sichtbar)"),
        image(f, "meta.image", "Bild (optional)", { dir: "news", optional: true }),
        f.get("meta.image") ? text(f, "meta.imageAlt", "Bildbeschreibung", { hint: "Kurz beschreiben, was zu sehen ist (für Google und blinde Menschen)." }) : null,
      ],
      async (meta, body) => {
        const r = await api.putNews(n.slug, meta, body, base);
        base = r.version;
        const m = meta as NewsEntry["meta"];
        Object.assign(n, { meta: structuredClone(m), body, version: base });
        toast(m.draft ? "Gespeichert (Entwurf, auf der Website nicht sichtbar)." : "Gespeichert. Die Website ist in wenigen Sekunden aktualisiert.");
      },
      [del],
    ),
  );
}

function fmt(date: string): string {
  const [y, m, d] = date.split("-");
  return d && m && y ? `${Number(d)}.${Number(m)}.${y}` : date;
}

// ---------------------------------------------------------------- Geschichte
export function pageScreen(ctx: Ctx, name: string, title: string, intro: string): HTMLElement {
  const page = ctx.state.pages[name] ?? { meta: { title }, body: "", version: "" };
  let base = page.version;
  return h(
    "div",
    { class: "screen" },
    h("h1", {}, title),
    h("p", { class: "intro" }, intro),
    textEditor(
      ctx,
      { title, ...page.meta },
      page.body,
      (f) => [
        text(f, "meta.title", "Titel der Seite"),
        text(f, "meta.description", "Kurzbeschreibung für Google (optional)", { multiline: true, hint: "Leer: die ersten Sätze des Textes werden verwendet." }),
      ],
      async (meta, body) => {
        const r = await api.putPage(name, meta, body, base);
        base = r.version;
        ctx.state.pages[name] = { meta: structuredClone(meta) as never, body, version: base };
        toast("Gespeichert. Die Website ist in wenigen Sekunden aktualisiert.");
      },
    ),
  );
}

// ---------------------------------------------------------------- Verlauf
export function historyScreen(ctx: Ctx): HTMLElement {
  const listEl = h("ol", { class: "history" }, h("li", { class: "muted" }, "Lade …"));
  api
    .history()
    .then((entries) => {
      listEl.replaceChildren(
        ...entries.map((e, i) =>
          h(
            "li",
            {},
            h("div", {}, h("strong", {}, e.message), h("small", {}, new Date(e.date).toLocaleString("de-CH", { dateStyle: "medium", timeStyle: "short" }))),
            i === 0
              ? h("span", { class: "muted" }, "aktueller Stand")
              : h(
                  "button",
                  {
                    type: "button",
                    class: "btn",
                    onclick: async () => {
                      if (!(await confirmDialog("Die ganze Website auf diesen Stand zurücksetzen? Alles danach bleibt im Verlauf und lässt sich wieder herstellen.", "Wiederherstellen"))) return;
                      try {
                        await api.restore(e.hash);
                        toast("Wiederhergestellt. Die Website ist in wenigen Sekunden aktualisiert.");
                        await ctx.reload();
                      } catch (err) {
                        handleSaveError(err);
                      }
                    },
                  },
                  "Diesen Stand wiederherstellen",
                ),
          ),
        ),
      );
    })
    .catch((err) => handleSaveError(err));
  return h(
    "div",
    { class: "screen" },
    h("h1", {}, "Verlauf"),
    h("p", { class: "intro" }, "Jede Speicherung ist hier festgehalten. Ein alter Stand lässt sich zurückholen; nichts geht dabei verloren."),
    listEl,
  );
}
