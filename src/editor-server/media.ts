import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { MediaPath } from "../content/schema.ts";
import { siteArea } from "../content/site-areas.ts";
import { DOCS, HttpError, PAGES, pageLabel, type DocName, type Store } from "./store.ts";

/** The Redaktion's overview of uploads, and where each one is used. Gallery photos stay out: Immich owns them. */

const ROUTES: Record<DocName, string> = { site: "allgemein", sponsors: "sponsoren", anzapfer: "anzapfer", team: "team", timeline: "zeitstrahl", galleries: "galerien" };
const NOT_MANAGED = ["media/immich/", "media/galerie/"];

export interface Usage {
  label: string;
  route: string;
}

export interface MediaFile {
  path: string;
  name: string;
  folder: string;
  kind: "image" | "pdf" | "other";
  size: number;
  used: Usage[];
}

/** A file the editor may list, delete and restore. */
export function isManagedMedia(p: string): boolean {
  return MediaPath.safeParse(p).success && !NOT_MANAGED.some((dir) => p.startsWith(dir));
}

function walk(v: unknown, at: string, found: (value: string, at: string) => void): void {
  if (typeof v === "string") found(v, at);
  else if (Array.isArray(v)) v.forEach((x, i) => walk(x, at ? `${at}.${i}` : String(i), found));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, at ? `${at}.${k}` : k, found);
}

/** media path → the screens that use it. */
export async function usages(store: Store): Promise<Map<string, Usage[]>> {
  const out = new Map<string, Usage[]>();
  const add = (p: string, u: Usage) => {
    const list = out.get(p) ?? [];
    if (!list.some((x) => x.route === u.route)) list.push(u);
    out.set(p, list);
  };
  for (const name of Object.keys(DOCS) as DocName[]) {
    walk((await store.getDoc(name)).data, "", (value, at) => {
      if (!value.startsWith("media/")) return;
      if (name === "site") {
        const label = siteArea(at);
        add(value, { label, route: label.toLowerCase() });
      } else add(value, { label: DOCS[name].label, route: ROUTES[name] });
    });
  }
  const inText = (text: string) => (text.match(/media\/[A-Za-z0-9._/-]+/g) ?? []).map((m) => m.replace(/\.+$/, ""));
  for (const n of await store.listNews()) {
    const title = String((n.meta as { title?: string }).title ?? n.slug);
    for (const p of inText(JSON.stringify(n.meta) + n.body)) add(p, { label: `News: ${title}`, route: `news/${n.slug}` });
  }
  for (const name of PAGES) {
    const page = await store.getPage(name);
    for (const p of inText(JSON.stringify(page.meta) + page.body)) add(p, { label: pageLabel(name), route: name });
  }
  return out;
}

export async function listMedia(store: Store): Promise<MediaFile[]> {
  const root = path.join(store.dir, "media");
  const used = await usages(store);
  const entries = await readdir(root, { recursive: true, withFileTypes: true }).catch(() => []);
  const files: MediaFile[] = [];
  for (const e of entries) {
    if (!e.isFile() || e.name.startsWith(".")) continue;
    const rel = path.relative(store.dir, path.join(e.parentPath, e.name)).split(path.sep).join("/");
    if (!isManagedMedia(rel)) continue;
    files.push({
      path: rel,
      name: e.name,
      folder: rel.split("/")[1] ?? "",
      kind: /\.(jpe?g|png|webp|avif|gif|svg)$/i.test(e.name) ? "image" : /\.pdf$/i.test(e.name) ? "pdf" : "other",
      size: (await stat(path.join(store.dir, rel))).size,
      used: used.get(rel) ?? [],
    });
  }
  return files.sort((a, b) => a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name));
}

/** Throws unless the file exists, may be managed and nothing uses it. */
export async function assertDeletable(store: Store, p: string): Promise<void> {
  if (!isManagedMedia(p)) throw new HttpError(400, "Ungültiger Pfad");
  const exists = await stat(path.join(store.dir, p)).then((s) => s.isFile(), () => false);
  if (!exists) throw new HttpError(404, "Diese Datei gibt es nicht mehr.");
  const used = (await usages(store)).get(p);
  if (used?.length) throw new HttpError(409, `Diese Datei wird noch verwendet: ${used.map((u) => u.label).join(", ")}.`);
}
