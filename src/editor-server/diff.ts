import YAML from "yaml";
import { parseFrontmatter } from "../content/load.ts";
import { markdownText } from "../render/markdown.ts";
import { areaLabel, DOCS } from "./store.ts";

/**
 * What differs between two states of a content file, in the words of the editor («Sponsoren:
 * Feldschlösschen: Webseite» instead of "sponsors.3.url"). Pure: the Verlauf reads the two states
 * from git and passes them in.
 */

export interface WordPart {
  /** gap: unchanged words left out. */
  t: "same" | "add" | "del" | "gap";
  text: string;
}

export interface Change {
  label: string;
  kind: "added" | "removed" | "changed";
  before?: string;
  after?: string;
  /** Instead of before/after, for texts: the words that changed, in context. */
  words?: WordPart[];
}

export interface FileChanges {
  area: string;
  changes: Change[];
}

type Obj = Record<string, unknown>;
type Labels = Record<string, string>;

interface ListSpec {
  label: string;
  /** Items with the same key are the same item, even if everything else changed. */
  key: (item: never) => string;
  title: (item: never) => string;
  fields?: Labels;
  /** The website shows the items in this order, so moving one is a change. */
  ordered: boolean;
}

interface DocSpec {
  fields: Labels;
  lists: Record<string, ListSpec>;
}

const SPONSOR_FIELDS: Labels = { name: "Name", logo: "Logo", url: "Webseite" };
const sponsorList = (label: string): ListSpec => ({
  label,
  key: (s: { name?: string }) => s.name ?? "",
  title: (s: { name?: string }) => s.name ?? "",
  fields: SPONSOR_FIELDS,
  ordered: true,
});

const SPECS: Record<string, DocSpec> = {
  [DOCS.site.file]: {
    fields: {
      title: "Name der Website",
      "event.days": "Festtage",
      "event.label": "Datum anders geschrieben",
      "event.location": "Festort",
      "hero.image": "Startbild",
      "links.goenner": "Button «Gönner werden»",
      "links.helfer": "Button «Helfer werden»",
      "helperCta.title": "Titel im Helfer-Band",
      "helperCta.image": "Bild im Helfer-Band",
      "contact.email": "E-Mail-Adresse",
      "contact.datenschutz": "Link zur Datenschutzerklärung",
      "contact.ktv": "Link zum KTV Wil",
      "social.instagram": "Instagram",
      "social.facebook": "Facebook",
      "pageImages.geschichte": "Titelbild Geschichte",
      "pageImages.impressionen": "Titelbild Impressionen",
      "pageImages.kontakt": "Titelbild Kontakt",
      "seo.description": "Kurzbeschreibung für Google",
      "seo.image": "Vorschaubild beim Teilen",
      "editor.feedbackEmail": "E-Mail für Feedback",
    },
    lists: {},
  },
  [DOCS.sponsors.file]: {
    fields: {
      "presenting.name": "Presenting-Partner: Name",
      "presenting.logo": "Presenting-Partner: Logo farbig",
      "presenting.logoWhite": "Presenting-Partner: Logo weiss",
      "presenting.url": "Presenting-Partner: Webseite",
    },
    lists: {
      main: sponsorList("Hauptsponsor"),
      sponsors: sponsorList("Sponsor"),
      media: sponsorList("Medienpartner"),
      goenner: { label: "Gönner", key: (g: string) => g, title: (g: string) => g, ordered: true },
    },
  },
  [DOCS.anzapfer.file]: {
    fields: {},
    lists: {
      list: {
        label: "Anzapfer",
        key: (a: { year?: number }) => String(a.year),
        title: (a: { year?: number; name?: string; note?: string }) => [a.year, a.name || a.note].filter(Boolean).join(" – "),
        fields: { year: "Jahr", name: "Name(n)", note: "Hinweis", photo: "Foto" },
        // The website sorts them by year.
        ordered: false,
      },
    },
  },
  [DOCS.team.file]: {
    fields: { groupPhoto: "Gruppenfoto" },
    lists: {
      members: {
        label: "Mitglied",
        key: (m: { name?: string }) => m.name ?? "",
        title: (m: { name?: string }) => m.name ?? "",
        fields: { name: "Name", role: "Aufgabe", photo: "Porträt" },
        ordered: true,
      },
    },
  },
  [DOCS.timeline.file]: {
    fields: {},
    lists: {
      entries: {
        label: "Eintrag",
        key: (e: { year?: string }) => e.year ?? "",
        title: (e: { year?: string }) => e.year ?? "",
        fields: { year: "Jahr", text: "Text", highlight: "Hervorheben" },
        ordered: true,
      },
    },
  },
};

const NEWS_FIELDS: Labels = {
  title: "Titel",
  date: "Datum",
  image: "Bild",
  imageAlt: "Bildbeschreibung",
  ctaTarget: "Button",
  ctaLabel: "Button-Text",
  ctaUrl: "Button führt zu",
  draft: "Entwurf",
};
const PAGE_FIELDS: Labels = { title: "Titel", description: "Kurzbeschreibung", redirect: "Weiterleitung" };

const CTA: Record<string, string> = { helfer: "Helfer werden", goenner: "Gönner werden" };

/** "", null and an unset checkbox all mean: nothing there. */
function empty(v: unknown): boolean {
  return v === undefined || v === null || v === "" || v === false || (Array.isArray(v) && v.length === 0);
}

function show(v: unknown): string {
  if (Array.isArray(v)) return v.map(show).join(", ");
  if (v === true) return "Ja";
  const s = String(v);
  if (s.startsWith("media/")) return s.split("/").pop()!;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return `${Number(iso[3])}.${Number(iso[2])}.${iso[1]}`;
  return CTA[s] ?? s;
}

/** Longer texts get a word diff, addresses and file names are one thing that changed. */
const isProse = (a: unknown, b: unknown): boolean =>
  typeof a === "string" && typeof b === "string" && /\s/.test(a) && /\s/.test(b);

function valueChange(label: string, a: unknown, b: unknown): Change | null {
  if (empty(a) && empty(b)) return null;
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a === true || b === true) return { label, kind: "changed", before: a === true ? "Ja" : "Nein", after: b === true ? "Ja" : "Nein" };
  if (empty(a)) return { label, kind: "added", after: show(b) };
  if (empty(b)) return { label, kind: "removed", before: show(a) };
  if (isProse(a, b)) return { label, kind: "changed", words: wordDiff(a as string, b as string) };
  return { label, kind: "changed", before: show(a), after: show(b) };
}

/** {a: {b: 1}} → {"a.b": 1}. Arrays count as one value. */
function flatten(v: unknown, prefix = "", out: Obj = {}): Obj {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const [k, x] of Object.entries(v)) flatten(x, prefix ? `${prefix}.${k}` : k, out);
  } else if (prefix) {
    out[prefix] = v;
  }
  return out;
}

function fieldChanges(before: unknown, after: unknown, labels: Labels, skip: string[] = [], prefix = ""): Change[] {
  const a = flatten(before);
  const b = flatten(after);
  const out: Change[] = [];
  const paths = [...new Set([...Object.keys(labels), ...Object.keys(a), ...Object.keys(b)])];
  for (const p of paths) {
    if (skip.includes(p.split(".")[0]!)) continue;
    const c = valueChange(`${prefix}${labels[p] ?? p}`, a[p], b[p]);
    if (c) out.push(c);
  }
  return out;
}

function sharesValue(a: unknown, b: unknown): boolean {
  const values = new Set(Object.values(flatten(a)).filter((v) => !empty(v)).map(String));
  return Object.values(flatten(b)).some((v) => !empty(v) && values.has(String(v)));
}

/** Pairs old and new items: identical first, then by key, then what still shares a value (a renamed sponsor keeps its logo). */
function listChanges(before: unknown, after: unknown, spec: ListSpec): Change[] {
  const a: unknown[] = Array.isArray(before) ? before : [];
  const b: unknown[] = Array.isArray(after) ? after : [];
  const key = spec.key as (i: unknown) => string;
  const title = spec.title as (i: unknown) => string;
  const pairOf = new Map<number, number>();
  const taken = new Set<number>();
  const pair = (same: (x: unknown, y: unknown) => boolean) => {
    for (const [i, x] of a.entries()) {
      if (pairOf.has(i)) continue;
      const j = b.findIndex((y, n) => !taken.has(n) && same(x, y));
      if (j >= 0) {
        pairOf.set(i, j);
        taken.add(j);
      }
    }
  };
  pair((x, y) => JSON.stringify(x) === JSON.stringify(y));
  pair((x, y) => key(x) === key(y));
  pair((x, y) => typeof x === "object" && sharesValue(x, y));

  const out: Change[] = [];
  for (const [i, x] of a.entries()) {
    const j = pairOf.get(i);
    if (j === undefined) out.push({ label: `${spec.label}: ${title(x)}`, kind: "removed" });
    else if (spec.fields) out.push(...fieldChanges(x, b[j], spec.fields, [], `${spec.label} ${title(b[j])}: `));
  }
  for (const [j, y] of b.entries()) if (!taken.has(j)) out.push({ label: `${spec.label}: ${title(y)}`, kind: "added" });
  const order = [...pairOf.entries()].sort((p, q) => p[0] - q[0]).map((p) => p[1]);
  if (spec.ordered && order.some((v, i) => i > 0 && v < order[i - 1]!)) out.push({ label: `${spec.label}: Reihenfolge geändert`, kind: "changed" });
  return out;
}

const MAX_LCS = 250_000;

/** Which words of `a` are also in `b`, in the same order (longest common subsequence). */
function commonWords(a: string[], b: string[]): WordPart[] {
  const table = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const out: WordPart[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      out.push({ t: "same", text: a[i]! });
      i++;
      j++;
    } else if (j >= b.length || (i < a.length && table[i + 1]![j]! >= table[i]![j + 1]!)) {
      out.push({ t: "del", text: a[i++]! });
    } else {
      out.push({ t: "add", text: b[j++]! });
    }
  }
  return out;
}

const CONTEXT = 8;

export function wordDiff(before: string, after: string): WordPart[] {
  const a = before.split(/\s+/).filter(Boolean);
  const b = after.split(/\s+/).filter(Boolean);
  // Usually one spot changed: the table only needs what is between the common start and end.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  const midA = a.slice(start, a.length - end);
  const midB = b.slice(start, b.length - end);
  const mid =
    midA.length * midB.length > MAX_LCS
      ? [...midA.map((text): WordPart => ({ t: "del", text })), ...midB.map((text): WordPart => ({ t: "add", text }))]
      : commonWords(midA, midB);
  const parts = [...a.slice(0, start).map((text): WordPart => ({ t: "same", text })), ...mid, ...a.slice(a.length - end).map((text): WordPart => ({ t: "same", text }))];

  // Neighbouring words of one kind in one piece; long unchanged stretches shrink to their ends.
  const runs: { t: WordPart["t"]; words: string[] }[] = [];
  for (const p of parts) {
    const last = runs.at(-1);
    if (last?.t === p.t) last.words.push(p.text);
    else runs.push({ t: p.t, words: [p.text] });
  }
  return runs.flatMap((run, i): WordPart[] => {
    const text = run.words.join(" ");
    if (run.t !== "same") return [{ t: run.t, text }];
    const first = i === 0;
    const last = i === runs.length - 1;
    const keep = (first ? 0 : CONTEXT) + (last ? 0 : CONTEXT);
    if (run.words.length <= keep + 1) return [{ t: "same", text }];
    const out: WordPart[] = [];
    if (!first) out.push({ t: "same", text: run.words.slice(0, CONTEXT).join(" ") });
    out.push({ t: "gap", text: "…" });
    if (!last) out.push({ t: "same", text: run.words.slice(-CONTEXT).join(" ") });
    return out;
  });
}

function textChange(before: string, after: string): Change | null {
  if (before.trim() === after.trim()) return null;
  const a = markdownText(before);
  const b = markdownText(after);
  if (a === b) return { label: "Text: Formatierung oder Link geändert", kind: "changed" };
  if (!a) return { label: "Text", kind: "added", after: b };
  if (!b) return { label: "Text", kind: "removed", before: a };
  return { label: "Text", kind: "changed", words: wordDiff(a, b) };
}

function yamlChanges(file: string, before: string | null, after: string | null): Change[] {
  if (before === null) return [{ label: "Erstmals gespeichert", kind: "added" }];
  if (after === null) return [{ label: "Entfernt", kind: "removed" }];
  const a = YAML.parse(before) as Obj | null;
  const b = YAML.parse(after) as Obj | null;
  if (file === DOCS.galleries.file) {
    const photos = (d: Obj | null) => new Map(((d?.galleries ?? []) as { year: number; images: unknown[] }[]).map((g) => [g.year, g.images.length]));
    const [x, y] = [photos(a), photos(b)];
    return [...new Set([...x.keys(), ...y.keys()])]
      .sort((p, q) => q - p)
      .flatMap((year) => (x.get(year) === y.get(year) ? [] : [{ label: `Fotos ${year}`, kind: "changed" as const, before: String(x.get(year) ?? 0), after: String(y.get(year) ?? 0) }]));
  }
  const spec = SPECS[file];
  if (!spec) return [];
  return [
    ...fieldChanges(a, b, spec.fields, Object.keys(spec.lists)),
    ...Object.entries(spec.lists).flatMap(([key, list]) => listChanges(a?.[key], b?.[key], list)),
  ];
}

function documentChanges(before: string | null, after: string | null, fields: Labels, what: string): Change[] {
  if (before === null) return [{ label: `${what} neu`, kind: "added" }];
  if (after === null) return [{ label: `${what} gelöscht`, kind: "removed" }];
  const a = parseFrontmatter(before);
  const b = parseFrontmatter(after);
  const text = textChange(a.body, b.body);
  return [...fieldChanges(a.data, b.data, fields), ...(text ? [text] : [])];
}

/** Null: not a content file an editor knows (e.g. .gitignore). */
export function fileChanges(file: string, before: string | null, after: string | null): FileChanges | null {
  const label = areaLabel(file);
  if (!label) return null;
  let area = label;
  let changes: Change[];
  try {
    if (file.startsWith("news/")) {
      const title = (parseFrontmatter(after ?? before ?? "").data as { title?: string }).title;
      area = `News «${title ?? file}»`;
      changes = documentChanges(before, after, NEWS_FIELDS, "News");
    } else if (file.startsWith("pages/")) {
      changes = documentChanges(before, after, PAGE_FIELDS, label);
    } else {
      changes = yamlChanges(file, before, after);
    }
  } catch {
    // A state that was written by hand and cannot be read: at least say that something changed.
    changes = [{ label: "Inhalt geändert", kind: "changed" }];
  }
  return changes.length ? { area, changes } : null;
}
