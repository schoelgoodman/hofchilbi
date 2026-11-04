import { createHash } from "node:crypto";
import { copyFile, link, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { html, type Raw } from "./html.ts";

sharp.cache(false);

/**
 * Turns uploaded files (content/media/...) into web assets:
 *   raster images → WebP variants in /_img/ (hashed names, cached across builds)
 *   SVG / PDF / other → copied unchanged to their media path (/media/...)
 *
 * The cache lives in SITE_DIR/.cache so a rebuild only encodes new or changed images.
 */
export interface ImageOpts {
  alt: string;
  /** CSS sizes attribute; drives which variant the browser picks. */
  sizes: string;
  /** Candidate widths; capped at the original width. */
  widths?: number[];
  cls?: string;
  eager?: boolean;
  /** Crop to this aspect ratio (w/h), centred. */
  aspect?: number;
}

interface Meta {
  width: number;
  height: number;
}

const DEFAULT_WIDTHS = [480, 800, 1200, 1600, 2000];
const RASTER = /\.(jpe?g|png|webp|avif|gif|tiff?)$/i;

export class Images {
  private meta = new Map<string, Promise<Meta>>();
  private jobs = new Map<string, Promise<void>>();
  private used = new Set<string>();
  private running = 0;
  private waiting: (() => void)[] = [];

  private contentDir: string;
  private outDir: string;
  private cacheDir: string;

  constructor(contentDir: string, outDir: string, cacheDir: string) {
    this.contentDir = contentDir;
    this.outDir = outDir;
    this.cacheDir = cacheDir;
  }

  private src(rel: string): string {
    return path.join(this.contentDir, rel);
  }

  private async limit<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= 4) await new Promise<void>((r) => this.waiting.push(r));
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      this.waiting.shift()?.();
    }
  }

  private async key(rel: string, extra: string): Promise<string> {
    const s = await stat(this.src(rel));
    return createHash("sha1").update(`${rel}|${s.size}|${s.mtimeMs}|${extra}`).digest("hex").slice(0, 10);
  }

  private dimensions(rel: string): Promise<Meta> {
    let m = this.meta.get(rel);
    if (!m) {
      m = sharp(this.src(rel))
        .metadata()
        .then((md) => {
          const rotated = (md.orientation ?? 1) >= 5;
          const w = md.width ?? 0;
          const h = md.height ?? 0;
          return rotated ? { width: h, height: w } : { width: w, height: h };
        });
      this.meta.set(rel, m);
    }
    return m;
  }

  /** Encodes one variant into the cache (once) and links it into the build. */
  private async variant(rel: string, width: number, aspect: number | undefined, format: "webp" | "jpeg"): Promise<string> {
    const base = path.basename(rel).replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9-]+/g, "-").slice(0, 40);
    const name = `${base}-${await this.key(rel, `${width}|${aspect ?? ""}|${format}|q2`)}-${width}.${format === "jpeg" ? "jpg" : format}`;
    const cached = path.join(this.cacheDir, name);
    let job = this.jobs.get(name);
    if (!job) {
      job = (async () => {
        try {
          await stat(cached);
        } catch {
          await this.limit(async () => {
            await mkdir(this.cacheDir, { recursive: true });
            let img = sharp(this.src(rel), { failOn: "error" }).rotate();
            img = aspect
              ? img.resize({ width, height: Math.round(width / aspect), fit: "cover", position: "attention" })
              : img.resize({ width, withoutEnlargement: true });
            img = format === "webp" ? img.webp({ quality: 78, effort: 4 }) : img.jpeg({ quality: 82, mozjpeg: true });
            const tmp = `${cached}.${process.pid}.tmp`;
            await img.toFile(tmp);
            await rename(tmp, cached);
          });
        }
        const out = path.join(this.outDir, "_img", name);
        await mkdir(path.dirname(out), { recursive: true });
        await link(cached, out).catch(() => copyFile(cached, out));
      })();
      this.jobs.set(name, job);
    }
    await job;
    this.used.add(name);
    return `/_img/${name}`;
  }

  /** Copies a non-raster file (SVG, PDF) to its public URL /media/... and returns that URL. */
  async file(rel: string): Promise<string> {
    const out = path.join(this.outDir, rel);
    let job = this.jobs.get(rel);
    if (!job) {
      job = mkdir(path.dirname(out), { recursive: true }).then(() => copyFile(this.src(rel), out));
      this.jobs.set(rel, job);
    }
    await job;
    return "/" + rel.split("/").map(encodeURIComponent).join("/");
  }

  /** URL of a link target: external URLs unchanged, media files copied. */
  async href(link: string): Promise<string> {
    if (link.startsWith("media/")) return RASTER.test(link) ? this.single(link, 2000) : this.file(link);
    return link;
  }

  /** One variant at a fixed width (e.g. lightbox, og:image). */
  async single(rel: string, width: number, aspect?: number, format: "webp" | "jpeg" = "webp"): Promise<string> {
    const { width: w } = await this.dimensions(rel);
    return this.variant(rel, aspect ? width : Math.min(width, w), aspect, format);
  }

  /** <img> with srcset, intrinsic size (no layout shift) and lazy loading. */
  async img(rel: string, o: ImageOpts): Promise<Raw> {
    const loading = o.eager ? "eager" : "lazy";
    const fetchpriority = o.eager ? "high" : undefined;
    if (!RASTER.test(rel)) {
      const src = await this.file(rel);
      return html`<img src="${src}" alt="${o.alt}" class="${o.cls}" loading="${loading}" decoding="async">`;
    }
    const meta = await this.dimensions(rel);
    const ratio = o.aspect ?? meta.width / meta.height;
    const candidates = (o.widths ?? DEFAULT_WIDTHS).filter((w) => w <= meta.width);
    if (candidates.length === 0 || candidates.at(-1)! < Math.min(meta.width, Math.max(...(o.widths ?? DEFAULT_WIDTHS)))) {
      candidates.push(Math.min(meta.width, Math.max(...(o.widths ?? DEFAULT_WIDTHS))));
    }
    const widths = [...new Set(candidates)].sort((a, b) => a - b);
    const urls = await Promise.all(widths.map((w) => this.variant(rel, w, o.aspect, "webp")));
    const srcset = urls.map((u, i) => `${u} ${widths[i]}w`).join(", ");
    const fallback = urls[Math.min(1, urls.length - 1)]!;
    const w = widths.at(-1)!;
    return html`<img src="${fallback}" srcset="${srcset}" sizes="${o.sizes}" width="${w}" height="${Math.round(w / ratio)}" alt="${o.alt}" class="${o.cls}" loading="${loading}" decoding="async"${fetchpriority ? html` fetchpriority="high"` : ""}>`;
  }

  /** Removes cached variants not used by this build (after deletes/replacements). */
  async pruneCache(): Promise<void> {
    let names: string[];
    try {
      names = await readdir(this.cacheDir);
    } catch {
      return;
    }
    await Promise.all(names.filter((n) => !this.used.has(n)).map((n) => rm(path.join(this.cacheDir, n), { force: true })));
  }
}
