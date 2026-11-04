import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import type http from "node:http";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { MediaPath } from "../content/schema.ts";
import { serveStatic } from "../server/static.ts";
import { History } from "./git.ts";
import { DOCS, HttpError, PAGES, Store, type DocName } from "./store.ts";
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

export class EditorApi {
  readonly store: Store;
  readonly history: History;
  private thumbDir = path.join(os.tmpdir(), "hofchilbi-thumbs");
  private publicUrl: string;

  constructor(contentDir: string, publicUrl: string) {
    this.store = new Store(contentDir);
    this.history = new History(contentDir);
    this.publicUrl = publicUrl;
  }

  async init(): Promise<void> {
    await mkdir(this.store.dir, { recursive: true });
    await this.history.init();
  }

  /** Commit + tell the site to rebuild. */
  private async saved(message: string): Promise<void> {
    await this.history.commit(message);
    await this.store.touch();
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
        const body = await readJson(req);
        const v = await this.store.putDoc(name, body.data, body.base);
        await this.saved(`${DOCS[name].label} gespeichert`);
        return json(res, 200, { version: v });
      }

      if (p === "/api/news" && m === "POST") {
        const body = await readJson(req);
        const slug = await this.store.createNews(body.title);
        await this.saved(`News angelegt: ${String(body.title).slice(0, 80)}`);
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
        await this.saved(`News gelöscht: ${title.slice(0, 80)}`);
        return json(res, 200, {});
      }

      r = /^\/api\/page\/([a-z]+)$/.exec(p);
      if (r && m === "PUT") {
        const body = await readJson(req);
        const v = await this.store.putPage(r[1]!, body.meta, body.body, body.base);
        await this.saved(`Seite gespeichert: ${r[1]}`);
        return json(res, 200, { version: v });
      }

      if (p === "/api/upload" && m === "POST") {
        const name = decodeURIComponent(String(req.headers["x-filename"] ?? "datei"));
        const buf = await readBody(req, MAX_UPLOAD);
        const up = await processUpload(this.store.dir, url.searchParams.get("dir"), name, buf);
        await this.history.commit(`Datei hochgeladen: ${up.path}`);
        return json(res, 201, up);
      }

      if (p === "/api/thumb" && m === "GET") {
        await this.thumb(url, res);
        return true;
      }

      if (p === "/api/history" && m === "GET") return json(res, 200, await this.history.log());
      if (p === "/api/restore" && m === "POST") {
        const body = await readJson(req);
        const date = await this.history.restore(String(body.hash ?? ""));
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

  private async state() {
    const docs: Record<string, unknown> = {};
    for (const name of Object.keys(DOCS) as DocName[]) docs[name] = await this.store.getDoc(name);
    const pages: Record<string, unknown> = {};
    for (const name of PAGES) pages[name] = await this.store.getPage(name);
    return { docs, news: await this.store.listNews(), pages, publicUrl: this.publicUrl };
  }

  /** Small WebP preview of an uploaded image (originals can be several MB). */
  private async thumb(url: URL, res: http.ServerResponse): Promise<void> {
    const src = url.searchParams.get("src") ?? "";
    const w = Math.min(800, Math.max(40, Number(url.searchParams.get("w")) || 320));
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
        data = await sharp(file, { density: 150 }).rotate().resize({ width: w, height: w, fit: "inside", withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();
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
