import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import type { z } from "zod";
import {
  AnzapferSchema,
  GalleriesSchema,
  NewsFrontmatter,
  PageFrontmatter,
  SiteSchema,
  SponsorsSchema,
  TeamSchema,
  type Anzapfer,
  type Galleries,
  type NewsMeta,
  type Site,
  type Sponsors,
  type Team,
} from "./schema.ts";

export interface NewsItem extends NewsMeta {
  slug: string;
  body: string;
}

export interface Page {
  title: string;
  description?: string;
  body: string;
}

export interface Content {
  site: Site;
  sponsors: Sponsors;
  anzapfer: Anzapfer;
  team: Team;
  galleries: Galleries;
  /** Newest first, drafts excluded unless requested. */
  news: NewsItem[];
  pages: Record<string, Page>;
}

export class ContentError extends Error {}

function check<S extends z.ZodType>(schema: S, data: unknown, file: string): z.infer<S> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const issues = result.error.issues.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
  throw new ContentError(`${file}:\n${issues}`);
}

async function yamlFile<S extends z.ZodType>(dir: string, file: string, schema: S): Promise<z.infer<S>> {
  let text: string;
  try {
    text = await readFile(path.join(dir, file), "utf8");
  } catch {
    throw new ContentError(`${file}: Datei fehlt`);
  }
  return check(schema, YAML.parse(text) ?? {}, file);
}

/** Splits `---\nyaml\n---\nbody` into data and body. */
export function parseFrontmatter(text: string): { data: unknown; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { data: {}, body: text };
  return { data: YAML.parse(m[1]!) ?? {}, body: m[2]! };
}

export function stringifyFrontmatter(data: Record<string, unknown>, body: string): string {
  const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined && v !== ""));
  return `---\n${YAML.stringify(clean).trimEnd()}\n---\n\n${body.trim()}\n`;
}

async function mdFiles(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((f) => f.endsWith(".md")).sort();
  } catch {
    return [];
  }
}

export async function loadContent(dir: string, opts: { drafts?: boolean } = {}): Promise<Content> {
  const [site, sponsors, anzapfer, team, galleries] = await Promise.all([
    yamlFile(dir, "site.yaml", SiteSchema),
    yamlFile(dir, "sponsors.yaml", SponsorsSchema),
    yamlFile(dir, "anzapfer.yaml", AnzapferSchema),
    yamlFile(dir, "team.yaml", TeamSchema),
    yamlFile(dir, "galleries.yaml", GalleriesSchema),
  ]);

  const news: NewsItem[] = [];
  for (const f of await mdFiles(path.join(dir, "news"))) {
    const { data, body } = parseFrontmatter(await readFile(path.join(dir, "news", f), "utf8"));
    const meta = check(NewsFrontmatter, data, `news/${f}`);
    if (meta.draft && !opts.drafts) continue;
    news.push({ ...meta, slug: f.replace(/\.md$/, ""), body });
  }
  news.sort((a, b) => b.date.localeCompare(a.date));

  const pages: Record<string, Page> = {};
  for (const f of await mdFiles(path.join(dir, "pages"))) {
    const { data, body } = parseFrontmatter(await readFile(path.join(dir, "pages", f), "utf8"));
    pages[f.replace(/\.md$/, "")] = { ...check(PageFrontmatter, data, `pages/${f}`), body };
  }

  anzapfer.list.sort((a, b) => b.year - a.year);
  galleries.galleries.sort((a, b) => b.year - a.year);
  return { site, sponsors, anzapfer, team, galleries, news, pages };
}

const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

/**
 * "23. & 24. Juli 2027", "31. Juli & 1. August 2027", "Samstag, 24. Juli 2027".
 * Dates are ISO strings; no time zone math needed.
 */
export function eventLabel(days: string[], opts: { weekday?: boolean } = {}): string {
  const ds = [...days].sort().map((d) => {
    const [y, m, day] = d.split("-").map(Number) as [number, number, number];
    return { y, m, day, wd: new Date(Date.UTC(y, m - 1, day)).getUTCDay() };
  });
  if (ds.length === 1) {
    const d = ds[0]!;
    return `${opts.weekday ? `${WEEKDAYS[d.wd]}, ` : ""}${d.day}. ${MONTHS[d.m - 1]} ${d.y}`;
  }
  const last = ds[ds.length - 1]!;
  const sameMonth = ds.every((d) => d.m === last.m && d.y === last.y);
  const parts = ds.map((d, i) =>
    sameMonth && i < ds.length - 1 ? `${d.day}.` : `${d.day}. ${MONTHS[d.m - 1]}${d.y !== last.y ? ` ${d.y}` : ""}`,
  );
  const joined = parts.length === 2 ? parts.join(" & ") : `${parts.slice(0, -1).join(", ")} & ${parts.at(-1)}`;
  return `${joined} ${last.y}`;
}

/** Year the content is "about": the last festival day. */
export function eventYear(site: Site): number {
  return Number([...site.event.days].sort().at(-1)!.slice(0, 4));
}
