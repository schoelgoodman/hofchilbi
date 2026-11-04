import { mkdir, readdir, readlink, rename, rm, symlink } from "node:fs/promises";
import path from "node:path";

/**
 * Builds into a fresh folder next to the live one, then swaps the `current` symlink with a single
 * rename(). Visitors never see a half-written or empty site (advocat-heft emptied site/ in place).
 * Works on a bind-mounted SITE_DIR because only entries inside it are renamed, never the mount.
 */
export async function publishBuild(siteRoot: string, write: (dir: string) => Promise<void>): Promise<string> {
  await mkdir(siteRoot, { recursive: true });
  const name = `build-${Date.now().toString(36)}`;
  const dir = path.join(siteRoot, name);
  await mkdir(dir);
  try {
    await write(dir);
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    throw err;
  }
  const tmpLink = path.join(siteRoot, `.current-${name}`);
  await symlink(name, tmpLink);
  await rename(tmpLink, path.join(siteRoot, "current"));
  await removeOldBuilds(siteRoot, name);
  return dir;
}

/** Keeps the live build and the one before it (a request may still be streaming from it). */
async function removeOldBuilds(siteRoot: string, live: string): Promise<void> {
  const builds = (await readdir(siteRoot)).filter((n) => n.startsWith("build-") && n !== live).sort();
  for (const old of builds.slice(0, -1)) {
    await rm(path.join(siteRoot, old), { recursive: true, force: true });
  }
  for (const n of await readdir(siteRoot)) {
    if (n.startsWith(".current-")) await rm(path.join(siteRoot, n), { force: true });
  }
}

/** Name of the live build, or null before the first build. */
export async function liveBuild(siteRoot: string): Promise<string | null> {
  try {
    return await readlink(path.join(siteRoot, "current"));
  } catch {
    return null;
  }
}
