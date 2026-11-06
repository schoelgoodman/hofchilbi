import { watch } from "node:fs";
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { contentDir, currentSiteDir, repoRoot, siteDir } from "../paths.ts";
import { buildSite, siteUrl } from "../render/build.ts";
import { liveBuild } from "../render/publish.ts";
import { isForeignWrite, keyMatches } from "./access.ts";
import { serveStatic } from "./static.ts";
import { canonicalRedirect, withoutTrailingSlash } from "./urls.ts";
import { EditorApi } from "../editor-server/api.ts";

/**
 * One image, two roles (see modules/services/*):
 *   ROLE=site    public website: builds and serves site/. The only writer of site/.
 *   ROLE=editor  editor UI + API behind TinyAuth. Writes content/ only.
 *   unset        local dev: both, on PORT and EDITOR_PORT.
 */
type Role = "site" | "editor";

const ROLE = process.env.ROLE as Role | undefined;
const PORT = Number(process.env.PORT ?? 4330);
const EDITOR_PORT = Number(process.env.EDITOR_PORT ?? PORT + 1);
const PRODUCTION = process.env.NODE_ENV === "production";
/** Where /redaktion on the site forwards to. Set on Neo; empty: no such address. */
const EDITOR_URL = process.env.EDITOR_URL || (PRODUCTION ? "" : `http://localhost:${EDITOR_PORT}`);
/** Shared secret nginx sends after TinyAuth. Delivered via a secrets file on Neo, never the Nix store. */
const KEY = process.env.HOFCHILBI_KEY ?? "";

/**
 * Same policies as the swag.nix files in modules/services. On Neo nginx strips the app's CSP and sets its
 * own; these apply when the app runs anywhere else (local dev, tests) so CSP problems show early.
 * Dev mode relaxes the editor's script-src for Vite's hot reload client.
 */
const SITE_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";
const EDITOR_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";

function baseHeaders(res: http.ServerResponse, role: Role): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  if (role === "site") res.setHeader("Content-Security-Policy", SITE_CSP);
  else if (PRODUCTION) res.setHeader("Content-Security-Policy", EDITOR_CSP);
}

/** Redirects of the live build (site/current/_redirects.json), cached per build. */
let redirectCache: { build: string | null; map: Record<string, string> } = { build: "", map: {} };
async function redirects(): Promise<Record<string, string>> {
  const build = await liveBuild(siteDir());
  if (build !== redirectCache.build) {
    let map: Record<string, string> = {};
    try {
      map = JSON.parse(await readFile(path.join(currentSiteDir(), "_redirects.json"), "utf8"));
    } catch {
      // no redirects in this build
    }
    redirectCache = { build, map };
  }
  return redirectCache.map;
}

/** Host as the visitor sent it (nginx forwards the original Host). */
function requestHost(req: http.IncomingMessage): string {
  return String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "").split(",")[0]!.trim().toLowerCase();
}

function send(res: http.ServerResponse, status: number, body: string, type = "text/plain; charset=utf-8"): void {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

function pathname(req: http.IncomingMessage): string {
  return new URL(req.url ?? "/", "http://x").pathname;
}

async function handleSite(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const p = pathname(req);
  if (p === "/health") return send(res, 200, "ok");
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method Not Allowed");
  const url = new URL(req.url ?? "/", "http://x");
  const toCanonical = canonicalRedirect(requestHost(req), siteUrl(), url.pathname + url.search);
  if (toCanonical) {
    res.writeHead(301, { Location: toCanonical });
    return void res.end();
  }
  // Only the canonical host may be indexed. On hofchilbi.<domain> (before and after go-live)
  // search engines are told to stay away, so Google never lists a duplicate of www.hofchilbi.ch.
  const canonical = requestHost(req) === new URL(siteUrl()).host;
  if (!canonical) res.setHeader("X-Robots-Tag", "noindex");
  if (p === "/robots.txt") {
    return send(
      res,
      200,
      canonical ? `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl()}/sitemap.xml\n` : "User-agent: *\nDisallow: /\n",
    );
  }
  const noSlash = withoutTrailingSlash(p, url.search);
  if (noSlash) {
    res.writeHead(301, { Location: noSlash });
    return void res.end();
  }
  // Short way to the login. The editor's address stays out of the public files.
  if (p === "/redaktion" && EDITOR_URL) {
    res.writeHead(302, { Location: EDITOR_URL, "Cache-Control": "no-store", "X-Robots-Tag": "noindex" });
    return void res.end();
  }
  const target = (await redirects())[p];
  if (target) {
    res.writeHead(301, { Location: target, "Cache-Control": "no-cache" });
    return void res.end();
  }
  if (p !== "/_redirects.json" && (await serveStatic(req, res, currentSiteDir()))) return;
  try {
    const html = await readFile(path.join(currentSiteDir(), "404.html"), "utf8");
    send(res, 404, html, "text/html; charset=utf-8");
  } catch {
    send(res, 404, "Not Found");
  }
}

let editorApi: EditorApi | undefined;
let editorUi: ((req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>) | undefined;

async function handleEditor(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const p = pathname(req);
  if (p === "/health") return send(res, 200, "ok");
  // Locally without a key the editor is open; in production a missing key locks it.
  if (KEY || PRODUCTION) {
    if (!KEY) return send(res, 503, "Editor key not configured");
    if (!keyMatches(req, KEY)) return send(res, 403, "Forbidden");
  }
  if (isForeignWrite(req)) return send(res, 403, "Forbidden");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  if (await editorApi!.handle(req, res)) return;
  await editorUi!(req, res);
}

/** Production: the Vite build in dist/editor. Dev: Vite middleware with hot reload. */
async function setupEditorUi(): Promise<void> {
  if (PRODUCTION) {
    const root = path.join(repoRoot, "dist/editor");
    editorUi = async (req, res) => {
      if (await serveStatic(req, res, root)) return;
      // Single page app: unknown paths get the app shell.
      req.url = "/index.html";
      if (!(await serveStatic(req, res, root))) send(res, 404, "Not Found");
    };
    return;
  }
  const { createServer } = await import("vite");
  const vite = await createServer({ configFile: path.join(repoRoot, "vite.config.ts"), server: { middlewareMode: true }, appType: "spa" });
  editorUi = (req, res) =>
    new Promise((resolve) => {
      vite.middlewares(req, res, () => {
        send(res, 404, "Not Found");
        resolve();
      });
      res.on("finish", () => resolve());
    });
}

function serve(role: Role, port: number): void {
  const handler = role === "site" ? handleSite : handleEditor;
  http
    .createServer((req, res) => {
      baseHeaders(res, role);
      handler(req, res).catch((err) => {
        console.error(`${role}: ${req.method} ${req.url}:`, err);
        if (!res.headersSent) send(res, 500, "Internal Server Error");
        else res.destroy();
      });
    })
    // Outside production (local dev, editor open without key) only reachable from this machine.
    .listen(port, PRODUCTION ? undefined : "127.0.0.1", () => console.log(`${role}: listening on :${port}`));
}

if (ROLE !== "editor") {
  // With a previous build on disk (every restart after the first), serve it right away and
  // rebuild in the background: no downtime. Only a brand-new install waits for the first build.
  const initial = buildSite().catch((err) => console.error("Site: initial build failed, serving the previous build:", err));
  if (!(await liveBuild(siteDir()))) await initial;
  serve("site", PORT);
  watchVersion();
  if (!PRODUCTION) watchForDev();
}

/**
 * The editor touches content/.version after every save. Polling one file is cheap and works on
 * Neo bind mounts, where inotify events are unreliable. No network call, no shared secret.
 */
function watchVersion(): void {
  const file = path.join(contentDir(), ".version");
  let last = "";
  const check = async () => {
    let v: string;
    try {
      v = await readFile(file, "utf8");
    } catch {
      last = last || "none";
      return;
    }
    if (v === last) return;
    const first = last === "";
    // Remember before building: a failing build is reported once, not retried every 2 s.
    last = v;
    if (!first) {
      console.log("Site: content changed in the Redaktion, rebuilding");
      await buildSite();
    }
  };
  check();
  setInterval(() => check().catch((err) => console.error("Site: rebuild failed:", err)), 2000).unref();
}

/** Local dev only: rebuild when content or design files change. */
function watchForDev(): void {
  let timer: NodeJS.Timeout | undefined;
  const rebuild = (what: string) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      console.log(`Site: ${what} changed, rebuilding`);
      buildSite().catch((err) => console.error("Site: rebuild failed:", err));
    }, 200);
  };
  for (const dir of [contentDir(), path.join(repoRoot, "src/design")]) {
    try {
      // Immich downloads: one rebuild when galleries.yaml is written, not one per photo.
      watch(dir, { recursive: true }, (_e, file) => file && !/(^|\/)\./.test(String(file)) && !String(file).startsWith("media/immich/") && rebuild(String(file)));
    } catch {
      // Directory missing (no content yet): nothing to watch.
    }
  }
}
if (ROLE !== "site") {
  editorApi = new EditorApi(contentDir(), process.env.PUBLIC_URL || (PRODUCTION ? siteUrl() : `http://localhost:${PORT}`));
  await editorApi.init();
  await setupEditorUi();
  serve("editor", ROLE === "editor" ? PORT : EDITOR_PORT);
}
