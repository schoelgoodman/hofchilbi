import { mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { Galleries } from "../content/schema.ts";
import type { Store } from "./store.ts";

/**
 * Impressionen from Immich. The editor (never the public site) reads every album named
 * "Hofchilbi <year>" through the Immich API, downloads Immich's preview images (≈1440 px, not
 * the originals), re-encodes them without metadata into content/media/immich/<year>/ and writes
 * galleries.yaml. The site then builds as after any save. Immich stays internal; if it is down,
 * the site keeps the last synced photos.
 *
 * Immich ≥ 3.2 API: GET /api/albums, POST /api/search/metadata (filter + cursor),
 * GET /api/assets/{id}/thumbnail?size=preview. API key permissions: album.read, asset.read, asset.view.
 */

export interface ImmichConfig {
  /** e.g. http://immich-server:2283 (no trailing /api) */
  url: string;
  apiKey: string;
  /** Automatic sync interval; 0 = only on request. */
  intervalMinutes: number;
}

export interface ImmichStatus {
  enabled: boolean;
  /** Automatic sync interval in minutes (0 = off). */
  interval: number;
  running: boolean;
  lastRun?: string;
  lastError?: string;
  albums: { year: number; name: string; images: number }[];
}

const ALBUM_NAME = /^\s*hofchilbi\s+(\d{4})\s*$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const IMMICH_DIR = "media/immich";
/** Last sync result, so the editor shows it after a restart (not in the history). */
export const STATUS_FILE = ".immich-status.json";
const MAX_PREVIEW_BYTES = 30 * 1024 * 1024;

/** Year from an album name like "Hofchilbi 2025"; null for other albums. */
export function albumYear(name: string): number | null {
  const m = ALBUM_NAME.exec(name);
  const y = m ? Number(m[1]) : NaN;
  return y >= 1900 && y <= 2200 ? y : null;
}

interface Asset {
  id: string;
  takenAt: string;
}

export class ImmichSync {
  private cfg: ImmichConfig | null;
  private store: Store;
  private onChange: (message: string) => Promise<void>;
  private current: Promise<void> | null = null;
  private timer?: NodeJS.Timeout;
  readonly status: ImmichStatus;

  constructor(cfg: ImmichConfig | null, store: Store, onChange: (message: string) => Promise<void>) {
    this.cfg = cfg;
    this.store = store;
    this.onChange = onChange;
    this.status = { enabled: Boolean(cfg), interval: cfg?.intervalMinutes ?? 0, running: false, albums: [] };
  }

  /** First sync shortly after start, then every intervalMinutes. */
  start(): void {
    if (!this.cfg) return;
    void readFile(path.join(this.store.dir, STATUS_FILE), "utf8")
      .then((t) => {
        const s = JSON.parse(t) as Partial<ImmichStatus>;
        if (!this.status.lastRun && typeof s.lastRun === "string") {
          this.status.lastRun = s.lastRun;
          this.status.lastError = typeof s.lastError === "string" ? s.lastError : undefined;
          if (Array.isArray(s.albums)) this.status.albums = s.albums;
        }
      })
      .catch(() => undefined);
    const run = () => void this.sync().catch(() => undefined);
    setTimeout(run, 15_000).unref();
    if (this.cfg.intervalMinutes > 0) this.timer = setInterval(run, this.cfg.intervalMinutes * 60_000).unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Runs a sync (or joins the one already running). */
  sync(): Promise<void> {
    if (!this.cfg) return Promise.reject(new Error("Immich ist nicht eingerichtet."));
    if (!this.current) {
      this.status.running = true;
      this.current = this.run(this.cfg)
        .then(() => {
          this.status.lastError = undefined;
        })
        .catch((err: unknown) => {
          this.status.lastError = err instanceof Error ? err.message : String(err);
          console.error("Immich sync:", this.status.lastError);
          throw err;
        })
        .finally(() => {
          this.status.running = false;
          this.status.lastRun = new Date().toISOString();
          this.current = null;
          const { lastRun, lastError, albums } = this.status;
          void writeFile(path.join(this.store.dir, STATUS_FILE), JSON.stringify({ lastRun, lastError, albums })).catch(() => undefined);
        });
    }
    return this.current;
  }

  private async api<T>(cfg: ImmichConfig, p: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${cfg.url.replace(/\/+$/, "")}/api${p}`, {
      ...init,
      headers: { "x-api-key": cfg.apiKey, Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}) },
      signal: AbortSignal.timeout(60_000),
    });
    if (res.status === 401 || res.status === 403) throw new Error("Immich lehnt den API-Schlüssel ab (Berechtigungen album.read, asset.read, asset.view nötig).");
    if (!res.ok) throw new Error(`Immich antwortet mit ${res.status} auf ${p.split("?")[0]}.`);
    return (await res.json()) as T;
  }

  private async albumAssets(cfg: ImmichConfig, albumId: string): Promise<Asset[]> {
    const out: Asset[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 100; page++) {
      const r = await this.api<{ assets: { items: { id: string; localDateTime?: string; fileCreatedAt?: string; isTrashed?: boolean }[]; nextCursor?: string | null } }>(
        cfg,
        "/search/metadata",
        {
          method: "POST",
          body: JSON.stringify({
            filter: { albumIds: { any: [albumId] }, type: { eq: "IMAGE" }, visibility: { in: ["timeline", "archive"] } },
            orderBy: { field: "localDateTime", direction: "asc" },
            size: 1000,
            ...(cursor ? { cursor } : {}),
          }),
        },
      );
      for (const a of r.assets.items) {
        if (!a.isTrashed && UUID.test(a.id)) out.push({ id: a.id.toLowerCase(), takenAt: a.localDateTime ?? a.fileCreatedAt ?? "" });
      }
      cursor = r.assets.nextCursor ?? undefined;
      if (!cursor) break;
    }
    return out.sort((a, b) => a.takenAt.localeCompare(b.takenAt));
  }

  /** Downloads one preview and stores it as a clean JPEG (no metadata, at most 2000 px). */
  private async download(cfg: ImmichConfig, id: string, file: string): Promise<void> {
    const res = await fetch(`${cfg.url.replace(/\/+$/, "")}/api/assets/${id}/thumbnail?size=preview`, {
      headers: { "x-api-key": cfg.apiKey },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`Bild ${id} konnte nicht geladen werden (${res.status}).`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_PREVIEW_BYTES) throw new Error(`Bild ${id} ist zu gross.`);
    const tmp = `${file}.${process.pid}.tmp`;
    await sharp(buf, { failOn: "error", limitInputPixels: 50e6 })
      .rotate()
      .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 86, mozjpeg: true })
      .toFile(tmp);
    await rename(tmp, file);
  }

  private async run(cfg: ImmichConfig): Promise<void> {
    const albums = (await this.api<{ id: string; albumName: string }[]>(cfg, "/albums"))
      .map((a) => ({ id: a.id, name: a.albumName, year: albumYear(a.albumName) }))
      .filter((a): a is { id: string; name: string; year: number } => a.year !== null && UUID.test(a.id));
    // Nothing found is more likely a wrong key or album name than "delete all photos".
    if (!albums.length) throw new Error("Keine Alben «Hofchilbi <Jahr>» in Immich gefunden. Die bisherigen Bilder bleiben.");

    const byYear = new Map<number, Asset[]>();
    for (const a of albums) {
      const assets = await this.albumAssets(cfg, a.id);
      const seen = new Set((byYear.get(a.year) ?? []).map((x) => x.id));
      byYear.set(a.year, [...(byYear.get(a.year) ?? []), ...assets.filter((x) => !seen.has(x.id))].sort((x, y) => x.takenAt.localeCompare(y.takenAt)));
    }

    const root = path.join(this.store.dir, IMMICH_DIR);
    let added = 0;
    let failed = 0;
    for (const [year, assets] of byYear) {
      const dir = path.join(root, String(year));
      await mkdir(dir, { recursive: true });
      for (const a of assets) {
        const file = path.join(dir, `${a.id}.jpg`);
        try {
          await stat(file);
        } catch {
          try {
            await this.download(cfg, a.id, file);
            added++;
          } catch (err) {
            failed++;
            console.error("Immich sync:", err instanceof Error ? err.message : err);
          }
        }
      }
    }

    // Keep only images that are still in an album (and were downloaded).
    const keep = new Map<number, string[]>();
    for (const [year, assets] of byYear) {
      const present: string[] = [];
      for (const a of assets) {
        try {
          await stat(path.join(root, String(year), `${a.id}.jpg`));
          present.push(a.id);
        } catch {
          // download failed this time: try again next run
        }
      }
      keep.set(year, present);
    }
    let removed = 0;
    for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
      const year = Number(entry.name);
      const wanted = new Set(keep.get(year) ?? []);
      const dir = path.join(root, entry.name);
      if (!entry.isDirectory() || !keep.has(year)) {
        await rm(dir, { recursive: true, force: true });
        continue;
      }
      for (const f of await readdir(dir)) {
        if (!wanted.has(f.replace(/\.jpg$/, ""))) {
          await rm(path.join(dir, f), { force: true });
          if (f.endsWith(".jpg")) removed++;
        }
      }
    }

    const data: Galleries = {
      galleries: [...keep]
        .filter(([, ids]) => ids.length)
        .sort(([a], [b]) => b - a)
        .map(([year, ids]) => ({ year, images: ids.map((id) => ({ src: `${IMMICH_DIR}/${year}/${id}.jpg` })) })),
    };
    this.status.albums = albums
      .sort((a, b) => b.year - a.year)
      .map((a) => ({ year: a.year, name: a.name, images: keep.get(a.year)?.length ?? 0 }));

    const before = await this.store.getDoc("galleries");
    const oldSrcs = new Set(((before.data as Galleries | null)?.galleries ?? []).flatMap((g) => g.images.map((i) => i.src)));
    const changed = JSON.stringify(before.data) !== JSON.stringify(data);
    if (changed) await this.store.putDoc("galleries", data, before.version);

    // Former hand-uploaded gallery images are replaced by Immich (they stay in the history).
    const newSrcs = new Set(data.galleries.flatMap((g) => g.images.map((i) => i.src)));
    let cleaned = 0;
    for (const src of oldSrcs) {
      if (src.startsWith("media/galerie/") && !newSrcs.has(src)) {
        await rm(path.join(this.store.dir, src), { force: true });
        cleaned++;
      }
    }
    // Empty year folders of the old galleries.
    const old = path.join(this.store.dir, "media/galerie");
    for (const d of await readdir(old).catch(() => [])) await rmdir(path.join(old, d)).catch(() => undefined);
    await rmdir(old).catch(() => undefined);

    if (changed || cleaned) {
      const parts = [added && `${added} neu`, removed && `${removed} entfernt`, failed && `${failed} fehlgeschlagen`].filter(Boolean);
      await this.onChange(`Galerien aus Immich aktualisiert${parts.length ? ` (${parts.join(", ")})` : ""}`);
    }
    if (failed) throw new Error(`${failed} Bilder konnten nicht geladen werden; sie werden beim nächsten Abgleich erneut versucht.`);
  }
}

/** Reads IMMICH_URL / IMMICH_API_KEY / IMMICH_SYNC_MINUTES; null if not configured. */
export function immichConfigFromEnv(env = process.env): ImmichConfig | null {
  const url = env.IMMICH_URL?.trim();
  const apiKey = env.IMMICH_API_KEY?.trim();
  if (!url || !apiKey) return null;
  if (!/^https?:\/\/[^\s/]+/.test(url)) throw new Error("IMMICH_URL must be http(s)://host[:port]");
  const minutes = Number(env.IMMICH_SYNC_MINUTES ?? 30);
  return { url, apiKey, intervalMinutes: Number.isFinite(minutes) && minutes >= 0 ? minutes : 30 };
}
