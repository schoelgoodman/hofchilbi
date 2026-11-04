import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { ContentError, loadContent } from "../content/load.ts";
import { writeAssets } from "../design/assets.ts";
import { contentDir, siteDir } from "../paths.ts";
import { Images } from "./images.ts";
import { layout, type Ctx, type PageDef } from "./layout.ts";
import { geschichtePage, impressionenPage, kontaktPage, notFoundPage, startPage } from "./pages.ts";
import { publishBuild } from "./publish.ts";

export function siteUrl(): string {
  return (process.env.SITE_URL ?? "https://www.hofchilbi.ch").replace(/\/+$/, "");
}

async function hasContent(dir: string): Promise<boolean> {
  try {
    await stat(path.join(dir, "site.yaml"));
    return true;
  } catch {
    return false;
  }
}

let running: Promise<void> | null = null;
let again = false;

/**
 * Builds the whole site (5 pages, fast) and swaps it in atomically. Calls during a running build
 * are coalesced into one follow-up build. A content error keeps the previous site online.
 */
export function buildSite(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        try {
          await buildOnce();
          await writeStatus({ ok: true });
        } catch (err) {
          // The previous build stays online. The editor shows this message (api /state).
          const message = err instanceof ContentError ? err.message : `${(err as Error).message ?? err}`;
          console.error(`Site: build failed, the previous version stays online.\n${message}`);
          await writeStatus({ ok: false, error: message.slice(0, 2000) });
        }
      } while (again);
    } finally {
      running = null;
    }
  })();
  return running;
}

async function buildOnce(): Promise<void> {
  const started = Date.now();
  const cDir = contentDir();
  const root = siteDir();
  if (!(await hasContent(cDir))) {
    await publishBuild(root, async (dir) => {
      await writeFile(path.join(dir, "index.html"), placeholder());
      await writeFile(path.join(dir, "404.html"), placeholder());
    });
    console.log(`Site: no content in ${cDir} yet, placeholder published`);
    return;
  }
  const content = await loadContent(cDir);

  let images!: Images;
  await publishBuild(root, async (dir) => {
    images = new Images(cDir, dir, path.join(root, ".cache", "img"));
    const assets = await writeAssets(dir);
    const og = content.site.seo.image ?? content.site.hero.image;
    const ctx: Ctx = {
      content,
      assets,
      images,
      siteUrl: siteUrl(),
      ogImage: siteUrl() + (await images.single(og, 1200, 1200 / 630, "jpeg")),
    };
    const pages: [string, PageDef][] = [
      ["index.html", await startPage(ctx)],
      ["geschichte.html", await geschichtePage(ctx)],
      ["impressionen.html", await impressionenPage(ctx)],
      ["kontakt.html", await kontaktPage(ctx)],
      ["404.html", await notFoundPage(ctx)],
    ];
    for (const [file, page] of pages) await writeFile(path.join(dir, file), layout(ctx, page));
    await writeFile(path.join(dir, "sitemap.xml"), sitemap(ctx.siteUrl, pages.filter(([, p]) => !p.noindex).map(([, p]) => p.path)));
  });
  await images.pruneCache();
  console.log(`Site: built in ${Date.now() - started} ms`);
}

export interface BuildStatus {
  ok: boolean;
  at?: string;
  error?: string;
}

/** site/status.json: result of the last build, read by the editor (site/ is mounted read-only there). */
async function writeStatus(st: BuildStatus): Promise<void> {
  try {
    await mkdir(siteDir(), { recursive: true });
    const file = path.join(siteDir(), "status.json");
    await writeFile(`${file}.tmp`, JSON.stringify({ ...st, at: new Date().toISOString() }));
    await rename(`${file}.tmp`, file);
  } catch (err) {
    console.error("Site: could not write status.json:", err);
  }
}

export async function readStatus(): Promise<BuildStatus | null> {
  try {
    return JSON.parse(await readFile(path.join(siteDir(), "status.json"), "utf8")) as BuildStatus;
  } catch {
    return null;
  }
}

function sitemap(base: string, paths: string[]): string {
  const today = new Date().toISOString().slice(0, 10);
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((p) => `  <url><loc>${base}${p}</loc><lastmod>${today}</lastmod></url>`).join("\n")}
</urlset>
`;
}

function placeholder(): string {
  return `<!doctype html>
<html lang="de-CH">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Hofchilbi Wil</title></head>
<body><main><h1>Hofchilbi Wil</h1><p>Neue Website im Aufbau</p></main></body>
</html>
`;
}
