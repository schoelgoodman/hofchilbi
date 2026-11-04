import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import type http from "node:http";
import path from "node:path";
import { brotliCompressSync, constants as zlibConstants, gzipSync } from "node:zlib";

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
  if (/\/(_assets|_img|assets)\//.test(file)) return "public, max-age=31536000, immutable";
  return "public, max-age=604800";
}

const COMPRESSIBLE = /\.(html|css|js|json|xml|txt|svg|webmanifest)$/;
const MAX_COMPRESS = 4 * 1024 * 1024;

/**
 * Compressed copies of text files, kept in memory. Built files never change in place (a new build
 * is a new folder), so the key file+mtime+size is enough. Bounded to ~40 MB.
 */
const compressed = new Map<string, Buffer>();
let compressedBytes = 0;

async function compressedBody(file: string, mtimeMs: number, size: number, enc: "br" | "gzip"): Promise<Buffer> {
  const key = `${enc}|${file}|${mtimeMs}|${size}`;
  const hit = compressed.get(key);
  if (hit) return hit;
  const raw = await readFile(file);
  const out =
    enc === "br"
      ? brotliCompressSync(raw, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 9, [zlibConstants.BROTLI_PARAM_SIZE_HINT]: raw.length } })
      : gzipSync(raw, { level: 9 });
  if (compressedBytes + out.length > 40 * 1024 * 1024) {
    compressed.clear();
    compressedBytes = 0;
  }
  compressed.set(key, out);
  compressedBytes += out.length;
  return out;
}

function pickEncoding(req: http.IncomingMessage): "br" | "gzip" | null {
  const accept = String(req.headers["accept-encoding"] ?? "");
  if (/\bbr\b/.test(accept)) return "br";
  if (/\bgzip\b/.test(accept)) return "gzip";
  return null;
}

/** Serves a file from `root`. Returns false if nothing matched (caller sends 404). */
export async function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, root: string): Promise<boolean> {
  const urlPath = new URL(req.url ?? "/", "http://x").pathname;
  const full = resolveInside(root, urlPath);
  if (!full) return false;
  // `/geschichte` → `/geschichte/index.html` or `/geschichte.html`
  const found = (await fileAt(full)) ?? (path.extname(full) ? null : await fileAt(full + ".html"));
  if (!found) return false;

  const etag = `"${found.size.toString(36)}-${Math.floor(found.mtime.getTime()).toString(36)}"`;
  const headers: http.OutgoingHttpHeaders = {
    "Content-Type": contentType(found.file),
    "Last-Modified": found.mtime.toUTCString(),
    "Cache-Control": cacheControl(found.file),
    ETag: etag,
  };
  const textual = COMPRESSIBLE.test(found.file);
  if (textual) headers.Vary = "Accept-Encoding";
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, headers);
    res.end();
    return true;
  }

  const enc = textual && found.size > 1024 && found.size < MAX_COMPRESS ? pickEncoding(req) : null;
  if (enc) {
    const body = await compressedBody(found.file, found.mtime.getTime(), found.size, enc);
    res.writeHead(200, { ...headers, "Content-Encoding": enc, "Content-Length": body.length });
    res.end(req.method === "HEAD" ? undefined : body);
    return true;
  }
  res.writeHead(200, { ...headers, "Content-Length": found.size });
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  createReadStream(found.file).pipe(res);
  return true;
}
