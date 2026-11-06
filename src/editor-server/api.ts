import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import type http from "node:http";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { MediaPath } from "../content/schema.ts";
import { readStatus } from "../render/build.ts";
import { serveStatic } from "../server/static.ts";
import { siteChecks, swissToday } from "./check.ts";
import { fileChanges, type FileChanges } from "./diff.ts";
import { History } from "./git.ts";
import { immichConfigFromEnv, ImmichSync } from "./immich.ts";
import { assertDeletable, isManagedMedia, listMedia } from "./media.ts";
import { parseFrontmatter } from "../content/load.ts";
import { areaLabel, DOCS, HttpError, pageLabel, PAGES, siteChange, Store, type DocName, type PageName } from "./store.ts";
import { MAX_UPLOAD, processUpload } from "./upload.ts";

/**
 * The editor's HTTP API. Every request has already passed TinyAuth, the key header from nginx
 * and the CSRF check (server/index.ts). Saving = publishing: each write is committed to the
 * content git and the site container rebuilds within a few seconds.
 */

const JSON_LIMIT = 2 * 1024 * 1024;

async function readBody(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > limit) throw new HttpError(413, `Die Datei ist zu gross (max. ${Math.round(limit / 1024 / 1024)} MB).`);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) {
      req.destroy();
      throw new HttpError(413, `Die Datei ist zu gross (max. ${Math.round(limit / 1024 / 1024)} MB).`);
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) throw new HttpError(415, "JSON erwartet");
  try {
    const v = JSON.parse((await readBody(req, JSON_LIMIT)).toString("utf8"));
    if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, "Ungültige Anfrage");
  }
}

function json(res: http.ServerResponse, status: number, data: unknown): true {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
  return true;
}

const FILE_DELETED = "Datei gelöscht: ";
/** Whole-website comparisons can touch many uploads: the first few by name, then a count. */
const MEDIA_LISTED = 5;

/** Entries written before the wording changed. */
function friendly(message: string): string {
  const page = /^Seite gespeichert: ([a-z]+)$/.exec(message)?.[1];
  if (page && (PAGES as readonly string[]).includes(page)) return `${pageLabel(page as PageName)}: Text geändert`;
  if (message === "Event & Allgemein gespeichert") return "Allgemein gespeichert";
  return message.replace(/^Wiederhergestellt: /, "Ganze Website zurückgeholt: ");
}

export class EditorApi {
  readonly store: Store;
  readonly history: History;
  readonly immich: ImmichSync;
  private thumbDir = path.join(os.tmpdir(), "hofchilbi-thumbs");
  private publicUrl: string;

  constructor(contentDir: string, publicUrl: string) {
    this.store = new Store(contentDir);
    this.history = new History(contentDir);
    this.publicUrl = publicUrl;
    this.immich = new ImmichSync(immichConfigFromEnv(), this.store, async (message) => void (await this.saved(message)));
  }

  async init(): Promise<void> {
    await mkdir(this.store.dir, { recursive: true });
    await this.history.init();
    this.immich.start();
    const prune = () => this.history.prune().catch((err) => console.error("Verlauf: Aufräumen fehlgeschlagen", err));
    void prune();
    setInterval(prune, 24 * 60 * 60 * 1000).unref();
  }

  private uploads: Promise<unknown> = Promise.resolve();
  private oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.uploads.then(fn, fn);
    this.uploads = next.catch(() => undefined);
    return next;
  }

  /** Commit + tell the site to rebuild. */
  private async saved(message: string): Promise<string> {
    const head = await this.history.commit(message);
    await this.store.touch();
    return head;
  }

  /** Returns true if the request was handled. */
  async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? "/", "http://x");
    const p = url.pathname;
    const m = req.method ?? "GET";

    if (p.startsWith("/media/")) {
      // Previews of uploaded files. SVGs get a sandbox CSP from nginx.
      return serveStatic(req, res, this.store.dir);
    }
    if (!p.startsWith("/api/")) return false;

    try {
      if (m === "GET" && p === "/api/state") return json(res, 200, await this.state());

      let r = /^\/api\/doc\/([a-z]+)$/.exec(p);
      if (r && m === "PUT") {
        const name = r[1]! as DocName;
        if (!(name in DOCS)) throw new HttpError(404, "Unbekannt");
        if (name === "galleries") throw new HttpError(403, "Die Galerien kommen aus Immich.");
        const body = await readJson(req);
        const before = name === "site" ? (await this.store.getDoc("site")).data : null;
        const v = await this.store.putDoc(name, body.data, body.base);
        await this.saved(name === "site" ? siteChange(before, (await this.store.getDoc("site")).data) : `${DOCS[name].label} geändert`);
        return json(res, 200, { version: v });
      }

      if (p === "/api/news" && m === "POST") {
        const body = await readJson(req);
        const slug = await this.store.createNews(body.title);
        await this.saved(`News angelegt: ${String(body.title).slice(0, 80)}`);
        return json(res, 201, { slug });
      }
      r = /^\/api\/news\/([a-z0-9-]+)\/copy$/.exec(p);
      if (r && m === "POST") {
        const { slug, title } = await this.store.copyNews(r[1]!);
        await this.saved(`News kopiert: ${title.slice(0, 80)}`);
        return json(res, 201, { slug });
      }

      r = /^\/api\/news\/([a-z0-9-]+)$/.exec(p);
      if (r && m === "PUT") {
        const body = await readJson(req);
        const v = await this.store.putNews(r[1]!, body.meta, body.body, body.base);
        const meta = body.meta as { title?: string; draft?: boolean };
        await this.saved(`News ${meta.draft ? "(Entwurf) " : ""}gespeichert: ${String(meta.title).slice(0, 80)}`);
        return json(res, 200, { version: v });
      }
      if (r && m === "DELETE") {
        const title = await this.store.deleteNews(r[1]!, url.searchParams.get("base"));
        const hash = await this.saved(`News gelöscht: ${title.slice(0, 80)}`);
        return json(res, 200, { hash, file: `news/${r[1]}.md` });
      }

      r = /^\/api\/page\/([a-z]+)$/.exec(p);
      if (r && m === "PUT") {
        const body = await readJson(req);
        const v = await this.store.putPage(r[1]!, body.meta, body.body, body.base);
        await this.saved(`${pageLabel(r[1] as PageName)}: Text geändert`);
        return json(res, 200, { version: v });
      }

      if (p === "/api/upload" && m === "POST") {
        let name = "datei";
        try {
          name = decodeURIComponent(String(req.headers["x-filename"] ?? "datei"));
        } catch {
          // Malformed name: the file is still fine, it just gets a generic name.
        }
        const buf = await readBody(req, MAX_UPLOAD);
        // One upload at a time: each decode can take a few hundred MB (container limit 1 GB).
        const up = await this.oneAtATime(() => processUpload(this.store.dir, url.searchParams.get("dir"), name, buf));
        await this.history.commit(`Datei hochgeladen: ${up.path}`);
        return json(res, 201, up);
      }

      if (p === "/api/media" && m === "GET") return json(res, 200, await listMedia(this.store));
      if (p === "/api/media" && m === "DELETE") {
        const file = url.searchParams.get("path") ?? "";
        await assertDeletable(this.store, file);
        await rm(path.join(this.store.dir, file));
        // Nothing used it, so the website does not change: no rebuild.
        const hash = await this.history.commit(`${FILE_DELETED}${path.basename(file)}`);
        return json(res, 200, { hash, file });
      }

      if (p === "/api/thumb" && m === "GET") {
        await this.thumb(url, res);
        return true;
      }

      if (p === "/api/immich/sync" && m === "POST") {
        if (!this.immich.status.enabled) throw new HttpError(404, "Immich ist nicht eingerichtet.");
        // Can take minutes; the editor polls /api/state for the result.
        void this.immich.sync().catch(() => undefined);
        return json(res, 202, this.immich.status);
      }

      if (p === "/api/history" && m === "GET") return json(res, 200, await this.historyPage(Number(url.searchParams.get("skip")) || 0));
      if (p === "/api/history/changes" && m === "GET") return json(res, 200, await this.changes(url));
      if (p === "/api/restore-file" && m === "POST") {
        const body = await readJson(req);
        const file = String(body.file ?? "");
        const hash = String(body.hash ?? "");
        const label = this.restorable(file);
        if (!label) throw new HttpError(400, "Dieser Bereich lässt sich nicht einzeln zurückholen.");
        const news = file.startsWith("news/") ? ((await this.history.fileAt(hash, file)) ?? (await this.history.fileAt(`${hash}^`, file))) : null;
        const name = news === null ? label : `News «${String((parseFrontmatter(news).data as { title?: string }).title ?? file)}»`;
        await this.history.restoreFile(hash, file, name).catch(() => {
          throw new HttpError(400, "Diesen Stand gibt es nicht.");
        });
        await this.store.touch();
        return json(res, 200, {});
      }
      if (p === "/api/restore" && m === "POST") {
        const body = await readJson(req);
        const date = await this.history.restore(String(body.hash ?? "")).catch(() => {
          throw new HttpError(400, "Diesen Stand gibt es nicht.");
        });
        await this.store.touch();
        return json(res, 200, { date });
      }

      throw new HttpError(404, "Nicht gefunden");
    } catch (err) {
      if (err instanceof HttpError) {
        json(res, err.status, { error: err.message, details: err.details });
        return true;
      }
      throw err;
    }
  }

  /**
   * What one save changed, or with compare=now what bringing back that state would change today
   * (optionally only for one file). `first`: the oldest state, there is nothing before it.
   */
  private async changes(url: URL): Promise<{ first: boolean; files: FileChanges[] }> {
    const hash = url.searchParams.get("hash") ?? "";
    const only = url.searchParams.get("file") ?? undefined;
    if (only !== undefined && !this.restorable(only)) throw new HttpError(400, "Dieser Bereich lässt sich nicht einzeln anzeigen.");
    const parent = await this.history.parentOf(hash).catch(() => {
      throw new HttpError(400, "Diesen Stand gibt es nicht.");
    });
    const now = url.searchParams.get("compare") === "now";
    if (!now && !parent) return { first: true, files: [] };
    const [from, to] = now ? ["HEAD", hash] : [parent!, hash];
    const changed = await this.history.changedFiles(from, to, only);
    const files: FileChanges[] = [];
    for (const { file } of changed) {
      if (file.startsWith("media/")) continue;
      const entry = fileChanges(file, await this.history.fileAt(from, file), await this.history.fileAt(to, file));
      if (entry) files.push(entry);
    }
    const media = changed.filter((c) => isManagedMedia(c.file));
    if (media.length) {
      const named = media.slice(0, MEDIA_LISTED).map((c) => ({
        label: path.basename(c.file),
        kind: c.status === "A" ? ("added" as const) : c.status === "D" ? ("removed" as const) : ("changed" as const),
      }));
      const rest = media.length - named.length;
      files.push({ area: "Dateien", changes: rest ? [...named, { label: `und ${rest} weitere`, kind: "changed" }] : named });
    }
    return { first: false, files };
  }

  /** Label of a file that can be restored on its own. Immich owns the galleries. */
  private restorable(file: string): string | null {
    if (file === DOCS.galleries.file) return null;
    if (isManagedMedia(file)) return `Datei ${path.basename(file)}`;
    return areaLabel(file);
  }

  /** One page of the Verlauf: entries, the area each could bring back, and deleted news ("bin"). */
  private async historyPage(skip: number) {
    const PAGE = 60;
    const log = await this.history.log(PAGE + 1, skip);
    const latest = new Map<string, string>();
    const entries = [];
    for (const e of log.slice(0, PAGE)) {
      const content = e.files.filter((f) => !f.file.startsWith("media/"));
      const only = content.length === 1 && content[0]!.status !== "D" ? content[0]!.file : null;
      const label = only ? this.restorable(only) : null;
      let area: { file: string; label: string } | null = null;
      if (only && label) {
        if (!latest.has(only)) latest.set(only, await this.history.latestOf(only));
        // The newest change of a file is what it looks like now: nothing to bring back.
        if (latest.get(only) !== e.hash) area = { file: only, label };
      }
      entries.push({ hash: e.hash, date: e.date, message: friendly(e.message), area });
    }
    return { entries, more: log.length > PAGE, deleted: skip ? [] : await this.deletedNews(), deletedFiles: skip ? [] : await this.deletedFiles() };
  }

  /** Files deleted under «Medien» and not brought back since. Not what a sync or a restore removed. */
  private async deletedFiles() {
    const seen = new Set<string>();
    const out = [];
    for (const d of await this.history.deletions("media", 30, `^${FILE_DELETED}`)) {
      if (seen.has(d.file) || !isManagedMedia(d.file)) continue;
      seen.add(d.file);
      if (await stat(path.join(this.store.dir, d.file)).then(() => true, () => false)) continue;
      out.push({ hash: d.hash, date: d.date, file: d.file, title: path.basename(d.file) });
    }
    return out;
  }

  /** News that were deleted and not brought back since. */
  private async deletedNews() {
    const seen = new Set<string>();
    const out = [];
    for (const d of await this.history.deletions("news")) {
      if (seen.has(d.file)) continue;
      seen.add(d.file);
      if (!areaLabel(d.file)) continue;
      const exists = await stat(path.join(this.store.dir, d.file)).then(() => true, () => false);
      if (exists) continue;
      const text = await this.history.fileAt(`${d.hash}^`, d.file);
      if (text === null) continue;
      const { data } = parseFrontmatter(text);
      out.push({ hash: d.hash, date: d.date, file: d.file, title: String((data as { title?: string }).title ?? d.file) });
    }
    return out;
  }

  private async state() {
    const docs: Record<string, unknown> = {};
    for (const name of Object.keys(DOCS) as DocName[]) docs[name] = await this.store.getDoc(name);
    const pages: Record<string, unknown> = {};
    for (const name of PAGES) pages[name] = await this.store.getPage(name);
    const news = await this.store.listNews();
    const impressum = await this.store.getPage("impressum");
    const checks = siteChecks({
      site: (docs.site as { data: unknown }).data,
      anzapfer: (docs.anzapfer as { data: unknown }).data,
      news,
      impressum,
      immichError: this.immich.status.enabled ? this.immich.status.lastError : undefined,
      today: swissToday(),
    });
    return { docs, news, pages, publicUrl: this.publicUrl, build: await readStatus(), immich: this.immich.status, checks };
  }

  /** Small WebP preview of an uploaded image (originals can be several MB). */
  private async thumb(url: URL, res: http.ServerResponse): Promise<void> {
    const src = url.searchParams.get("src") ?? "";
    // Fixed sizes only, so the cache in /tmp stays small.
    const asked = Number(url.searchParams.get("w")) || 320;
    const w = [160, 320, 800].find((x) => x >= asked) ?? 800;
    if (!MediaPath.safeParse(src).success) throw new HttpError(400, "Ungültiger Pfad");
    const file = path.join(this.store.dir, src);
    let s;
    try {
      s = await stat(file);
    } catch {
      throw new HttpError(404, "Datei fehlt");
    }
    const key = createHash("sha1").update(`${src}|${s.mtimeMs}|${s.size}|${w}`).digest("hex");
    const cached = path.join(this.thumbDir, `${key}.webp`);
    let data: Buffer;
    try {
      data = await readFile(cached);
    } catch {
      try {
        // Same queue as uploads: a huge original (e.g. 27 MP AVIF) can take ~700 MB to decode.
        data = await this.oneAtATime(() => sharp(file, { density: 150 }).rotate().resize({ width: w, height: w, fit: "inside", withoutEnlargement: true }).webp({ quality: 75 }).toBuffer());
      } catch {
        throw new HttpError(415, "Keine Vorschau möglich");
      }
      await mkdir(this.thumbDir, { recursive: true });
      await writeFile(cached, data);
    }
    res.writeHead(200, { "Content-Type": "image/webp", "Cache-Control": "private, max-age=86400", "Content-Length": data.length });
    res.end(data);
  }
}
