import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { currentSiteDir } from "../paths.ts";
import { buildSite } from "../render/build.ts";
import { isForeignWrite, keyMatches } from "./access.ts";
import { serveStatic } from "./static.ts";

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
/** Shared secret nginx sends after TinyAuth. Delivered via a secrets file on Neo, never the Nix store. */
const KEY = process.env.HOFCHILBI_KEY ?? "";

function baseHeaders(res: http.ServerResponse): void {
  // Neo strips CSP/X-Frame-Options from containers; nginx sets the real CSP. These help locally.
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
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
  // Trailing slash → canonical URL without it.
  if (p.length > 1 && p.endsWith("/")) {
    res.writeHead(301, { Location: p.replace(/\/+$/, "") || "/" });
    return void res.end();
  }
  if (await serveStatic(req, res, currentSiteDir())) return;
  try {
    const html = await readFile(path.join(currentSiteDir(), "404.html"), "utf8");
    send(res, 404, html, "text/html; charset=utf-8");
  } catch {
    send(res, 404, "Not Found");
  }
}

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
  if (p.startsWith("/api/")) return send(res, 404, '{"error":"not found"}', "application/json");
  // Phase 3: the real editor bundle.
  send(
    res,
    200,
    `<!doctype html><html lang="de-CH"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Hofchilbi Redaktion</title></head><body><h1>Hofchilbi Redaktion</h1><p>Der Editor kommt in Phase 3. Die Anmeldung funktioniert.</p></body></html>`,
    "text/html; charset=utf-8",
  );
}

function serve(role: Role, port: number): void {
  const handler = role === "site" ? handleSite : handleEditor;
  http
    .createServer((req, res) => {
      baseHeaders(res);
      handler(req, res).catch((err) => {
        console.error(`${role}: ${req.method} ${req.url}:`, err);
        if (!res.headersSent) send(res, 500, "Internal Server Error");
        else res.destroy();
      });
    })
    .listen(port, () => console.log(`${role}: listening on :${port}`));
}

if (ROLE !== "editor") {
  await buildSite();
  serve("site", PORT);
}
if (ROLE !== "site") serve("editor", ROLE === "editor" ? PORT : EDITOR_PORT);
