import path from "node:path";
import { fileURLToPath } from "node:url";

/** Repo root. Content never lives in here, only the code that renders it. */
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * YAML, Markdown, uploads and the content git history.
 * Locally the gitignored `dev-content/`; on Neo the appdata volume via CONTENT_DIR.
 */
export function contentDir(): string {
  return path.resolve(process.env.CONTENT_DIR ?? path.join(repoRoot, "dev-content"));
}

/**
 * Generated site. Holds one folder per build plus the symlink `current`,
 * which is swapped atomically after each build.
 */
export function siteDir(): string {
  return path.resolve(process.env.SITE_DIR ?? path.join(repoRoot, "site"));
}

/** The build that is currently served. */
export function currentSiteDir(): string {
  return path.join(siteDir(), "current");
}
