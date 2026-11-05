import { createHash } from "node:crypto";
import { copyFile, link, mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { ContentError } from "../content/load.ts";
import { html, type Raw } from "./html.ts";

sharp.cache(false);
// Memory: the container has 1 GB. Few parallel encodes with few threads each keep the peak low;
// a full re-encode of all galleries is a rare event, so speed matters less than not crashing.
const PARALLEL = Number(process.env.IMG_PARALLEL ?? 2);
sharp.concurrency(Number(process.env.IMG_THREADS ?? 2));

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
  hasAlpha?: boolean;
  format?: string;
}

const DEFAULT_WIDTHS = [480, 720, 960, 1280, 1600, 2000];
const RASTER = /\.(jpe?g|png|webp|avif|gif|tiff?)$/i;

const hashMemo = new Map<string, Promise<string>>();

async function contentHash(file: string): Promise<string> {
  const s = await stat(file);
  const memoKey = `${file}|${s.size}|${s.mtimeMs}`;
  let h = hashMemo.get(memoKey);
  if (!h) {
    h = readFile(file).then((buf) => createHash("sha1").update(buf).digest("hex"));
    hashMemo.set(memoKey, h);
  }
  return h;
}

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

  /**
   * Weighted slots: a normal encode takes 1 of PARALLEL slots; decoding a huge non-JPEG original
   * (AVIF/PNG/WebP can't shrink while decoding: a 27 MP AVIF needs ~700 MB) takes all of them.
   */
  private async limit<T>(fn: () => Promise<T>, weight = 1): Promise<T> {
    const need = Math.min(weight, PARALLEL);
    while (this.running + need > PARALLEL) await new Promise<void>((r) => this.waiting.push(r));
    this.running += need;
    try {
      return await fn();
    } finally {
      this.running -= need;
      for (const wake of this.waiting.splice(0)) wake();
    }
  }

  /**
   * Cache key from the file's CONTENT, not its mtime: copying or restoring content (push-content,
   * «Verlauf») changes mtimes and must not trigger a full re-encode. Hashes are remembered per
   * size+mtime for the life of the process, so warm rebuilds don't re-read the files.
   */
  private async key(rel: string, extra: string): Promise<string> {
    return createHash("sha1").update(`${await contentHash(this.src(rel))}|${extra}`).digest("hex").slice(0, 10);
  }

  private dimensions(rel: string): Promise<Meta> {
    let m = this.meta.get(rel);
    if (!m) {
      m = sharp(this.src(rel))
        .metadata()
        .catch(() => {
          throw new ContentError(`${rel}: Datei fehlt oder ist kein lesbares Bild.`);
        })
        .then((md) => {
          const rotated = (md.orientation ?? 1) >= 5;
          const w = md.width ?? 0;
          const h = md.height ?? 0;
          const extra = { hasAlpha: md.hasAlpha, format: md.format };
          return rotated ? { width: h, height: w, ...extra } : { width: w, height: h, ...extra };
        });
      this.meta.set(rel, m);
    }
    return m;
  }

  private masters = new Map<string, Promise<string>>();

  /**
   * Each original is decoded ONCE into a master of at most 2000 px (rotated, cached on disk);
   * all sizes are made from that. Decoding a 24-megapixel original six times in parallel took
   * ~3 GB and got the container killed (1 GB limit); from masters the peak stays far below.
   */
  private master(rel: string): Promise<string> {
    let m = this.masters.get(rel);
    if (!m) {
      m = (async () => {
        const { hasAlpha, width, height, format } = await this.dimensions(rel);
        const heavy = width * height > 12e6 && format !== "jpeg";
        const name = `master-${await this.key(rel, "m1")}.${hasAlpha ? "png" : "jpg"}`;
        const file = path.join(this.cacheDir, name);
        try {
          await stat(file);
        } catch {
          await this.limit(async () => {
            await mkdir(this.cacheDir, { recursive: true });
            const img = sharp(this.src(rel), { failOn: "error", sequentialRead: true })
              .rotate()
              .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true });
            const tmp = `${file}.${process.pid}.tmp`;
            await (hasAlpha ? img.png({ compressionLevel: 3 }) : img.jpeg({ quality: 92, chromaSubsampling: "4:4:4" })).toFile(tmp);
            await rename(tmp, file);
          }, heavy ? PARALLEL : 1);
        }
        this.used.add(name);
        return file;
      })();
      this.masters.set(rel, m);
    }
    return m;
  }

  /** Encodes one variant into the cache (once) and links it into the build. */
  private async variant(rel: string, width: number, aspect: number | undefined, format: "webp" | "jpeg"): Promise<string> {
    const base = path.basename(rel).replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9-]+/g, "-").slice(0, 40);
    const name = `${base}-${await this.key(rel, `${width}|${aspect ?? ""}|${format}|q3`)}-${width}.${format === "jpeg" ? "jpg" : format}`;
    const cached = path.join(this.cacheDir, name);
    let job = this.jobs.get(name);
    if (!job) {
      job = (async () => {
        try {
          await stat(cached);
        } catch {
          // Master first, outside the slot: a job holding a slot must never wait for another slot.
          const master = await this.master(rel);
          await this.limit(async () => {
            await mkdir(this.cacheDir, { recursive: true });
            let img = sharp(master, { failOn: "error", sequentialRead: true });
            img = aspect
              ? img.resize({ width, height: Math.round(width / aspect), fit: "cover", position: "attention" })
              : img.resize({ width, withoutEnlargement: true });
            img = format === "webp" ? img.webp({ quality: 72, effort: 5, smartSubsample: true }) : img.jpeg({ quality: 82, mozjpeg: true });
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

  /**
   * Non-raster files. SVG → /_img/<name>-<hash>.svg (immutable, cached a year). Other files (PDF)
   * keep a stable, readable URL /media/... so links to them can be shared.
   */
  async file(rel: string): Promise<string> {
    const isSvg = /\.svg$/i.test(rel);
    const pub = isSvg ? `_img/${path.basename(rel, ".svg").replace(/[^A-Za-z0-9-]+/g, "-").slice(0, 40)}-${await this.key(rel, "svg")}.svg` : rel;
    const out = path.join(this.outDir, pub);
    let job = this.jobs.get(pub);
    if (!job) {
      job = mkdir(path.dirname(out), { recursive: true }).then(() => copyFile(this.src(rel), out));
      this.jobs.set(pub, job);
    }
    await job;
    return "/" + pub.split("/").map(encodeURIComponent).join("/");
  }

  /** Width/height of an SVG from its attributes or viewBox (for layout-shift-free <img>). */
  private async svgSize(rel: string): Promise<Meta | null> {
    try {
      const head = (await readFile(this.src(rel), "utf8")).slice(0, 4000);
      const tag = /<svg\b[^>]*>/i.exec(head)?.[0] ?? "";
      const num = (name: string) => Number(new RegExp(`\\s${name}="([\\d.]+)(px)?"`, "i").exec(tag)?.[1]);
      const vb = /viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/i.exec(tag);
      const width = num("width") || Number(vb?.[1]);
      const height = num("height") || Number(vb?.[2]);
      return width > 0 && height > 0 ? { width: Math.round(width), height: Math.round(height) } : null;
    } catch {
      return null;
    }
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
      const size = await this.svgSize(rel);
      return html`<img src="${src}"${size ? html` width="${size.width}" height="${size.height}"` : ""} alt="${o.alt}" class="${o.cls}" loading="${loading}" decoding="async"${fetchpriority ? html` fetchpriority="high"` : ""}>`;
    }
    const r = await this.responsive(rel, o);
    return html`<img src="${r.src}" srcset="${r.srcset}" sizes="${o.sizes}" width="${r.width}" height="${r.height}" alt="${o.alt}" class="${o.cls}" loading="${loading}" decoding="async"${fetchpriority ? html` fetchpriority="high"` : ""}>`;
  }

  /** The variants of a raster image (also used to preload the hero image in <head>). */
  async responsive(rel: string, o: Pick<ImageOpts, "widths" | "aspect">): Promise<{ src: string; srcset: string; width: number; height: number }> {
    const meta = await this.dimensions(rel);
    const ratio = o.aspect ?? meta.width / meta.height;
    const wanted = o.widths ?? DEFAULT_WIDTHS;
    const top = Math.min(meta.width, Math.max(...wanted));
    const widths = [...new Set([...wanted.filter((w) => w < top), top])].sort((a, b) => a - b);
    const urls = await Promise.all(widths.map((w) => this.variant(rel, w, o.aspect, "webp")));
    const w = widths.at(-1)!;
    return {
      src: urls[Math.min(1, urls.length - 1)]!,
      srcset: urls.map((u, i) => `${u} ${widths[i]}w`).join(", "),
      width: w,
      height: Math.round(w / ratio),
    };
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
