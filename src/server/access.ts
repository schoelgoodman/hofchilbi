import { timingSafeEqual } from "node:crypto";
import type http from "node:http";

/**
 * Who may reach the editor. Stateless so it can be unit tested (access.test.ts).
 */

/**
 * Set by nginx after TinyAuth (modules/services/hofchilbi-redaktion/swag.nix). A browser cannot
 * forge it: nginx overwrites it. Without it, any container on the Docker network `internal`
 * could call the editor API directly and skip the login.
 */
export const KEY_HEADER = "x-hofchilbi-key";

export function keyMatches(req: http.IncomingMessage, key: string): boolean {
  const value = req.headers[KEY_HEADER];
  if (typeof value !== "string" || !key) return false;
  const a = Buffer.from(value);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Header the editor's own fetch() calls send on every write. A cross-site form or <img> cannot
 * set custom headers, and a cross-site fetch with one triggers a CORS preflight we never answer.
 */
export const WRITE_HEADER = "x-hofchilbi-editor";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF guard for writes. The TinyAuth cookie is valid on every subdomain, so a request from
 * another service in the editor's browser would carry it. Writes must (1) send WRITE_HEADER and
 * (2) if the browser sends Origin, it must match our host. Unlike advocat-heft, a missing
 * Origin is never enough on its own.
 */
export function isForeignWrite(req: http.IncomingMessage): boolean {
  if (SAFE_METHODS.has(req.method ?? "GET")) return false;
  if (req.headers[WRITE_HEADER] !== "1") return true;
  if (req.headers["sec-fetch-site"] === "cross-site") return true;
  const origin = req.headers.origin;
  if (!origin) return false;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return true;
  }
  const own = [req.headers.host, req.headers["x-forwarded-host"]]
    .flatMap((v) => String(v ?? "").split(","))
    .map((v) => v.trim())
    .filter(Boolean);
  return !own.includes(host);
}
