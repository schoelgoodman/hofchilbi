import { createHash, randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import type { z } from "zod";
import { parseFrontmatter, stringifyFrontmatter } from "../content/load.ts";
import {
  AnzapferSchema,
  GalleriesSchema,
  NewsFrontmatter,
  PageFrontmatter,
  SiteSchema,
  SponsorsSchema,
  TeamSchema,
} from "../content/schema.ts";

/**
 * Reads and writes content files for the editor. Every file has a version (hash of its bytes);
 * a save must name the version it was based on, so two people editing at once never silently
 * overwrite each other (the second gets 409 and reloads).
 */

export const DOCS = {
  site: { file: "site.yaml", schema: SiteSchema, label: "Event & Allgemein" },
  sponsors: { file: "sponsors.yaml", schema: SponsorsSchema, label: "Sponsoren & Gönner" },
  anzapfer: { file: "anzapfer.yaml", schema: AnzapferSchema, label: "Anzapfer" },
  team: { file: "team.yaml", schema: TeamSchema, label: "Team" },
  galleries: { file: "galleries.yaml", schema: GalleriesSchema, label: "Galerien" },
} as const;
export type DocName = keyof typeof DOCS;

export const PAGES = ["geschichte"] as const;
export type PageName = (typeof PAGES)[number];

export class HttpError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function version(bytes: string | Buffer | null): string {
  return bytes === null ? "" : createHash("sha1").update(bytes).digest("hex").slice(0, 16);
}

/** Zod issues → { "path.to.field": "message" } for the form. */
function issues(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of err.issues) out[i.path.join(".") || "_"] ??= i.message;
  return out;
}

export function validate<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(422, "Bitte die markierten Felder prüfen.", issues(r.error));
  return r.data;
}

/** Writes via temp file + rename so the site never reads a half-written file. */
export async function atomicWrite(file: string, data: string | Buffer): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, file);
}

export class Store {
  readonly dir: string;
  constructor(dir: string) {
    this.dir = dir;
  }

  private async read(rel: string): Promise<string | null> {
    try {
      return await readFile(path.join(this.dir, rel), "utf8");
    } catch {
      return null;
    }
  }

  private async checkBase(rel: string, base: unknown): Promise<void> {
    const current = version(await this.read(rel));
    if (typeof base !== "string" || base !== current) {
      throw new HttpError(409, "Jemand anderes hat das inzwischen geändert. Bitte neu laden.", { current });
    }
  }

  /** Tells the site container to rebuild (it polls this file's mtime). Not in git. */
  async touch(): Promise<void> {
    await atomicWrite(path.join(this.dir, ".version"), String(Date.now()));
  }

  // ---- structured YAML documents
  async getDoc(name: DocName): Promise<{ data: unknown; version: string }> {
    const text = await this.read(DOCS[name].file);
    return { data: text === null ? null : YAML.parse(text), version: version(text) };
  }

  async putDoc(name: DocName, data: unknown, base: unknown): Promise<string> {
    const { file, schema } = DOCS[name];
    const clean = validate(schema, data);
    await this.checkBase(file, base);
    const text = YAML.stringify(clean, { lineWidth: 0 });
    await atomicWrite(path.join(this.dir, file), text);
    return version(text);
  }

  // ---- news (one Markdown file each)
  private newsRel(slug: string): string {
    if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(slug)) throw new HttpError(400, "Ungültiger Name");
    return `news/${slug}.md`;
  }

  async listNews(): Promise<{ slug: string; meta: unknown; body: string; version: string }[]> {
    let files: string[] = [];
    try {
      files = (await readdir(path.join(this.dir, "news"))).filter((f) => f.endsWith(".md"));
    } catch {
      // no news yet
    }
    const out = [];
    for (const f of files) {
      const text = (await this.read(`news/${f}`))!;
      const { data, body } = parseFrontmatter(text);
      out.push({ slug: f.slice(0, -3), meta: data, body: body.trim(), version: version(text) });
    }
    return out.sort((a, b) => String((b.meta as { date?: string }).date ?? "").localeCompare(String((a.meta as { date?: string }).date ?? "")));
  }

  async putNews(slug: string, meta: unknown, body: unknown, base: unknown): Promise<string> {
    const rel = this.newsRel(slug);
    const clean = validate(NewsFrontmatter, meta);
    if (typeof body !== "string" || body.length > 50_000) throw new HttpError(422, "Text fehlt oder ist zu lang.");
    await this.checkBase(rel, base);
    const text = stringifyFrontmatter(clean, body);
    await atomicWrite(path.join(this.dir, rel), text);
    return version(text);
  }

  async createNews(title: unknown): Promise<string> {
    if (typeof title !== "string" || !title.trim()) throw new HttpError(422, "Titel fehlt.", { title: "Titel fehlt" });
    const date = new Date().toISOString().slice(0, 10);
    const base = `${date}-${slugify(title)}`.slice(0, 70).replace(/-+$/, "");
    let slug = base;
    for (let i = 2; (await this.read(this.newsRel(slug))) !== null; i++) slug = `${base}-${i}`;
    const text = stringifyFrontmatter({ title: title.trim(), date, draft: true }, "");
    await atomicWrite(path.join(this.dir, this.newsRel(slug)), text);
    return slug;
  }

  async deleteNews(slug: string, base: unknown): Promise<string> {
    const rel = this.newsRel(slug);
    await this.checkBase(rel, base);
    const { data } = parseFrontmatter((await this.read(rel)) ?? "");
    await rm(path.join(this.dir, rel));
    return String((data as { title?: string }).title ?? slug);
  }

  // ---- free-text pages
  private pageRel(name: string): string {
    if (!(PAGES as readonly string[]).includes(name)) throw new HttpError(404, "Unbekannte Seite");
    return `pages/${name}.md`;
  }

  async getPage(name: string): Promise<{ meta: unknown; body: string; version: string }> {
    const text = await this.read(this.pageRel(name));
    const { data, body } = parseFrontmatter(text ?? "");
    return { meta: data, body: body.trim(), version: version(text) };
  }

  async putPage(name: string, meta: unknown, body: unknown, base: unknown): Promise<string> {
    const rel = this.pageRel(name);
    const clean = validate(PageFrontmatter, meta);
    if (typeof body !== "string" || body.length > 100_000) throw new HttpError(422, "Text fehlt oder ist zu lang.");
    await this.checkBase(rel, base);
    const text = stringifyFrontmatter(clean, body);
    await atomicWrite(path.join(this.dir, rel), text);
    return version(text);
  }
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 50) || "eintrag";
}
