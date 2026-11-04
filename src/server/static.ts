import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type http from "node:http";
import path from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".pdf": "application/pdf",
  ".webmanifest": "application/manifest+json",
};

export function contentType(file: string): string {
  return TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Maps a URL path to a file inside `root`, or null if it would escape it.
 * Rejects NUL bytes, bad %-encoding and any `..` segment.
 */
export function resolveInside(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return null;
  if (decoded.split("/").some((seg) => seg === "..")) return null;
  const full = path.resolve(root, "." + path.posix.normalize("/" + decoded));
  const rel = path.relative(root, full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return full;
}

async function fileAt(full: string): Promise<{ file: string; size: number; mtime: Date } | null> {
  try {
    let s = await stat(full);
    if (s.isDirectory()) {
      full = path.join(full, "index.html");
      s = await stat(full);
    }
    return s.isFile() ? { file: full, size: s.size, mtime: s.mtime } : null;
  } catch {
    return null;
  }
}

export function cacheControl(file: string): string {
  if (file.endsWith(".html")) return "no-cache";
  if (/\/_assets\//.test(file)) return "public, max-age=31536000, immutable";
  return "public, max-age=604800";
}

/** Serves a file from `root`. Returns false if nothing matched (caller sends 404). */
export async function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, root: string): Promise<boolean> {
  const urlPath = new URL(req.url ?? "/", "http://x").pathname;
  const full = resolveInside(root, urlPath);
  if (!full) return false;
  // `/geschichte` → `/geschichte/index.html` or `/geschichte.html`
  const found = (await fileAt(full)) ?? (path.extname(full) ? null : await fileAt(full + ".html"));
  if (!found) return false;
  res.writeHead(200, {
    "Content-Type": contentType(found.file),
    "Content-Length": found.size,
    "Last-Modified": found.mtime.toUTCString(),
    "Cache-Control": cacheControl(found.file),
  });
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  createReadStream(found.file).pipe(res);
  return true;
}
