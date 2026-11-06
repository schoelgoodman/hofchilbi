import { api, thumb, type NewsEntry } from "../api.ts";
import { confirmDialog, h, toast, announceSaved } from "../dom.ts";
import { Form, checkbox, handleSaveError, image, linkOrFile, saveBar, text } from "../form.ts";
import type { MarkdownEditor } from "../markdown.ts";
import type { Ctx } from "./doc.ts";
import { siteArea, titleImageField } from "./site.ts";

/** Disposes the Milkdown instance of the previous screen. */
let activeEditor: MarkdownEditor | null = null;
export async function disposeEditor(): Promise<void> {
  const e = activeEditor;
  activeEditor = null;
  await e?.destroy().catch(() => undefined);
}

/** A second content file saved with the same button (the title image lives in site.yaml). */
interface AlsoSaved {
  form: Form;
  save: () => Promise<void>;
}

/** Form with metadata fields + Milkdown body + save bar. */
function textEditor(
  ctx: Ctx,
  meta: Record<string, unknown>,
  body: string,
  fields: (f: Form) => (HTMLElement | null)[],
  save: (meta: unknown, body: string) => Promise<void>,
  /** Below the text, e.g. deleting: not beside «Speichern», where a thumb could hit it. */
  footer?: HTMLElement,
  also?: AlsoSaved,
  /** Fields below the text. */
  fieldsBelow?: (f: Form) => (HTMLElement | null)[],
): HTMLElement {
  const form = new Form({ meta, body });
  const metaBox = h("div", { class: "form" });
  const belowBox = h("div", { class: "form" });
  const editorBox = h("div", { class: "md" });
  const dirty = () => form.dirty() || Boolean(also?.form.dirty());
  const bar = saveBar(async () => {
    let saving: Form = form;
    try {
      // Only what changed, so the Verlauf shows what really happened.
      if (also?.form.dirty()) {
        saving = also.form;
        await also.save();
        also.form.markSaved();
      }
      saving = form;
      if (form.dirty()) {
        await save(form.draft.meta, form.draft.body);
        form.markSaved();
        renderMeta();
      }
    } catch (err) {
      bar.setDirty(true);
      handleSaveError(err, saving);
    }
  });
  const renderMeta = () => {
    metaBox.replaceChildren(...fields(form).filter((x): x is HTMLElement => x !== null));
    belowBox.replaceChildren(...(fieldsBelow?.(form) ?? []).filter((x): x is HTMLElement => x !== null));
  };
  form.onStructure = renderMeta;
  form.onDirty = () => bar.setDirty(dirty());
  if (also) also.form.onDirty = () => bar.setDirty(dirty());
  ctx.guard(dirty);
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
  return h("div", {}, metaBox, h("div", { class: "field" }, h("span", { class: "label" }, "Text"), editorBox), belowBox, footer ? h("div", { class: "text__foot" }, footer) : null, bar.el);
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

  // Narrow screens (.news--open): either the list or the open news, with a way back.
  return h(
    "div",
    { class: `screen${current ? " news--open" : ""}` },
    current ? h("a", { class: "news__back", href: "#/news" }, "← Alle News") : null,
    h("h1", {}, "News"),
    h("p", { class: "intro" }, "News erscheinen oben auf der Startseite, die neueste zuerst. Neue News sind zuerst ein Entwurf und erst sichtbar, wenn «Entwurf» ausgeschaltet ist."),
    create,
    h("div", { class: "split" }, listEl, current ? newsEditor(ctx, current) : h("p", { class: "muted split__hint" }, news.length ? "Links eine News auswählen." : "Noch keine News.")),
  );
}

type ButtonChoice = "kein" | "helfer" | "goenner" | "eigen";

/** The button below a news text: none, one of the site-wide buttons (links set on Start), or its own. */
function newsButtonFields(f: Form, isCustom: () => boolean, setCustom: (v: boolean) => void): (HTMLElement | null)[] {
  const target = f.get("meta.ctaTarget") as "helfer" | "goenner" | undefined;
  const current: ButtonChoice = target ?? (isCustom() ? "eigen" : "kein");
  const options: [ButtonChoice, string][] = [["kein", "Kein Button"], ["helfer", "Helfer werden"], ["goenner", "Gönner werden"], ["eigen", "Eigener Button"]];
  const select = h("select", { id: "f-news-button" }, options.map(([v, label]) => h("option", { value: v, selected: v === current }, label)));
  select.addEventListener("change", () => {
    const v = select.value as ButtonChoice;
    setCustom(v === "eigen");
    f.set("meta.ctaLabel", undefined);
    f.set("meta.ctaUrl", undefined);
    f.set("meta.ctaTarget", v === "helfer" || v === "goenner" ? v : undefined, true);
  });
  const err = f.errors["meta.ctaTarget"];
  return [
    h(
      "div",
      { class: `field${err ? " field--error" : ""}`, "data-path": "meta.ctaTarget" },
      h("label", { for: "f-news-button" }, "Button unter dem Text"),
      select,
      target ? h("small", { class: "hint" }, "Führt immer dorthin, wo dieser Button auch sonst auf der Website hinführt. Festgelegt unter ", h("a", { href: "#/start" }, "Start"), ".") : null,
      err ? h("small", { class: "error" }, err) : null,
    ),
    current === "eigen" ? text(f, "meta.ctaLabel", "Button-Text", { placeholder: "z. B. Jetzt anmelden" }) : null,
    current === "eigen" ? linkOrFile(f, "meta.ctaUrl", "Button führt zu", "dokumente", "Webadresse (https://…) oder eine Seite dieser Website (z. B. /geschichte).") : null,
  ];
}

function newsEditor(ctx: Ctx, n: NewsEntry): HTMLElement {
  let base = n.version;
  let customButton = Boolean(n.meta.ctaLabel || n.meta.ctaUrl);
  const del = h(
    "button",
    {
      type: "button",
      class: "btn btn--danger-ghost",
      onclick: async () => {
        if (!(await confirmDialog(`News «${n.meta.title}» löschen? Sie lässt sich im Verlauf wiederherstellen.`))) return;
        try {
          const { hash, file } = await api.deleteNews(n.slug, base);
          ctx.guard(() => false);
          await ctx.reload();
          location.hash = "#/news";
          announceSaved();
          toast("Gelöscht.", "ok", {
            label: "Rückgängig",
            run: async () => {
              try {
                await api.restoreFile(hash, file);
                announceSaved();
                await ctx.reload();
                location.hash = `#/news/${n.slug}`;
                toast("Die News ist wieder da.");
              } catch (err) {
                handleSaveError(err);
              }
            },
          });
        } catch (err) {
          handleSaveError(err);
        }
      },
    },
    "Löschen",
  );
  const copy = h(
    "button",
    {
      type: "button",
      class: "btn",
      onclick: async () => {
        // Reloading would throw away what was typed; the copy is made of the saved news.
        if (ctx.isDirty()) {
          toast("Bitte zuerst speichern, dann kopieren.", "error");
          return;
        }
        try {
          const { slug } = await api.copyNews(n.slug);
          await ctx.reload();
          location.hash = `#/news/${slug}`;
          toast("Kopie erstellt. Sie ist ein Entwurf und erst sichtbar, wenn «Entwurf» ausgeschaltet ist.");
        } catch (err) {
          handleSaveError(err);
        }
      },
    },
    "Kopieren",
  );
  return h(
    "div",
    { class: "editor" },
    textEditor(
      ctx,
      { ...n.meta, draft: Boolean(n.meta.draft) },
      n.body,
      (f) => [text(f, "meta.title", "Titel")],
      async (meta, body) => {
        const r = await api.putNews(n.slug, meta, body, base);
        base = r.version;
        const m = meta as NewsEntry["meta"];
        Object.assign(n, { meta: structuredClone(m), body, version: base });
        toast(m.draft ? "Gespeichert (Entwurf, auf der Website nicht sichtbar)." : "Gespeichert. Die Website ist in wenigen Sekunden aktualisiert.");
        announceSaved();
      },
      h("div", { class: "row" }, copy, del),
      undefined,
      (f) => [
        text(f, "meta.date", "Datum", { type: "date" }),
        checkbox(f, "meta.draft", "Entwurf (auf der Website noch nicht sichtbar)"),
        image(f, "meta.image", "Bild (optional)", { dir: "news", optional: true, hint: "Wird automatisch zugeschnitten: Querformat 4:3. Hochformat 4:5, wenn die News gross erscheint." }),
        f.get("meta.image") ? text(f, "meta.imageAlt", "Bildbeschreibung", { hint: "Kurz beschreiben, was zu sehen ist (für Google und blinde Menschen)." }) : null,
        ...newsButtonFields(f, () => customButton, (v) => (customButton = v)),
      ],
    ),
  );
}

function fmt(date: string): string {
  const [y, m, d] = date.split("-");
  return d && m && y ? `${Number(d)}.${Number(m)}.${y}` : date;
}

// ---------------------------------------------------------------- Geschichte
export function pageScreen(
  ctx: Ctx,
  name: string,
  title: string,
  intro: string,
  opts: { template?: string; extraFields?: (f: Form) => (HTMLElement | null)[]; titleImage?: string } = {},
): HTMLElement {
  const page = ctx.state.pages[name] ?? { meta: { title }, body: "", version: "" };
  let base = page.version;
  const titleImage = opts.titleImage;
  let also: AlsoSaved | undefined;
  const imageBox = h("div", {});
  if (titleImage) {
    const siteForm = new Form(ctx.state.docs.site.data ?? {});
    siteForm.where = siteArea;
    const renderImage = () => imageBox.replaceChildren(titleImageField(siteForm, titleImage));
    siteForm.onStructure = renderImage;
    renderImage();
    also = {
      form: siteForm,
      save: async () => {
        const r = await api.putDoc("site", siteForm.draft, ctx.state.docs.site.version);
        ctx.state.docs.site = { data: structuredClone(siteForm.draft), version: r.version };
        toast("Gespeichert. Die Website ist in wenigen Sekunden aktualisiert.");
        announceSaved();
      },
    };
  }
  return h(
    "div",
    { class: "screen" },
    h("h1", {}, title),
    h("p", { class: "intro" }, intro),
    imageBox,
    textEditor(
      ctx,
      { title, ...page.meta },
      page.body || opts.template || "",
      (f) => [
        text(f, "meta.title", "Titel der Seite"),
        text(f, "meta.description", "Kurzbeschreibung für Google (optional)", { multiline: true, hint: "Leer: die ersten Sätze des Textes werden verwendet." }),
        ...(opts.extraFields?.(f) ?? []),
      ],
      async (meta, body) => {
        const r = await api.putPage(name, meta, body, base);
        base = r.version;
        ctx.state.pages[name] = { meta: structuredClone(meta) as never, body, version: base };
        toast("Gespeichert. Die Website ist in wenigen Sekunden aktualisiert.");
        announceSaved();
      },
      undefined,
      also,
    ),
  );
}

// Lines inside a block end with "\\" = hard line break (Shift+Enter in the editor).
const IMPRESSUM_TEMPLATE = [
  "**Veranstalter**\\",
  "KTV Wil Handball\\",
  "[Strasse Nr.]\\",
  "9500 Wil SG",
  "",
  "**Kontakt**\\",
  "hofchilbi@ktvwil-handball.ch",
  "",
  "**Verantwortlich für den Inhalt**\\",
  "[Vorname Name, Funktion]",
  "",
  "**Haftung für Links**\\",
  "Für den Inhalt verlinkter Websites sind ausschliesslich deren Betreiber verantwortlich.",
  "",
  "**Urheberrechte**\\",
  "Texte und Bilder auf dieser Website gehören dem KTV Wil Handball oder den genannten Urheberinnen und Urhebern. Eine Verwendung ist nur mit Erlaubnis gestattet.",
].join("\n");

// Only what the site really does: no cookies, no analytics, nothing loaded from other providers
// (see the CSP in modules/services/hofchilbi/swag.nix). Adapt it when that changes.
const DATENSCHUTZ_TEMPLATE = [
  "Diese Erklärung zeigt, welche Personendaten beim Besuch dieser Website bearbeitet werden. Sie richtet sich nach dem Schweizer Datenschutzgesetz (DSG).",
  "",
  "**Verantwortlich**\\",
  "KTV Wil Handball\\",
  "9500 Wil SG\\",
  "hofchilbi@ktvwil-handball.ch",
  "",
  "**Besuch der Website**\\",
  "Beim Aufruf einer Seite verarbeitet der Server technisch notwendige Angaben: IP-Adresse, Datum und Uhrzeit, aufgerufene Seite sowie Browser und Betriebssystem. Sie dienen nur dem Betrieb und der Sicherheit der Website.",
  "",
  "**Keine Cookies, keine Analyse**\\",
  "Diese Website setzt keine Cookies und verwendet keine Analyse- oder Werbedienste. Schriften und Bilder liegen auf der Website selbst, Inhalte anderer Anbieter werden nicht eingebunden.",
  "",
  "**Kontakt per E-Mail**\\",
  "Wenn Sie uns schreiben, verwenden wir Ihre Angaben nur, um Ihre Anfrage zu beantworten.",
  "",
  "**Helferformular und Links**\\",
  "Das Formular für Helferinnen und Helfer läuft über Microsoft Forms. Ihre Angaben verwenden wir nur für die Organisation der Hofchilbi. Microsoft kann Daten auch im Ausland bearbeiten. Für Microsoft, Instagram, Facebook und andere verlinkte Websites gelten deren eigene Datenschutzbestimmungen.",
  "",
  "**Fotos**\\",
  "Auf dieser Website zeigen wir Fotos der Hofchilbi und unseres Teams. Wenn Sie auf einem Foto erkennbar sind und es entfernen lassen möchten, genügt eine E-Mail an uns.",
  "",
  "**Ihre Rechte**\\",
  "Sie können Auskunft über Ihre Daten verlangen und deren Berichtigung oder Löschung fordern oder einer Bearbeitung widersprechen; gesetzliche Ausnahmen bleiben vorbehalten. Schreiben Sie dazu an die oben genannte Adresse. Beschwerden können Sie beim Eidgenössischen Datenschutz- und Öffentlichkeitsbeauftragten (EDÖB) einreichen.",
  "",
  "Stand: November 2026",
].join("\n");

const forwardField = (name: string) => (f: Form) => [
  text(f, "meta.redirect", "Stattdessen weiterleiten zu (optional)", {
    type: "url",
    placeholder: "https://ktvwil-handball.ch/…",
    hint: `Ist hier eine Adresse eingetragen, zeigt die Website keine eigene Seite: Der Link im Fuss und /${name} führen direkt dorthin. Leer lassen für die eigene Seite.`,
  }),
];

export function impressumScreen(ctx: Ctx): HTMLElement {
  return pageScreen(
    ctx,
    "impressum",
    "Impressum",
    "Wer hinter der Website steht. Solange der Text leer ist, gibt es keine Impressum-Seite. Die Vorlage unten bitte vervollständigen ([…] ersetzen) und speichern.",
    { template: IMPRESSUM_TEMPLATE, extraFields: forwardField("impressum") },
  );
}

export function datenschutzScreen(ctx: Ctx): HTMLElement {
  return pageScreen(
    ctx,
    "datenschutz",
    "Datenschutz",
    "Welche Daten die Website bearbeitet. Ist eine Weiterleitung eingetragen, erscheint der Text unten nicht auf der Website. Für die eigene Seite die Weiterleitung löschen und speichern.",
    { template: DATENSCHUTZ_TEMPLATE, extraFields: forwardField("datenschutz") },
  );
}
