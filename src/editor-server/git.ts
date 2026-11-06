import { execFile } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Uploads get a commit of their own, but change nothing until a save uses them: not shown in the history. */
const UPLOAD_PREFIX = "Datei hochgeladen: ";

/** How long the Verlauf goes back. The site is quiet most of the year: the newest commits always stay. */
const KEEP_DAYS = 90;
const KEEP_AT_LEAST = 30;

export interface LogEntry {
  hash: string;
  date: string;
  message: string;
  /** Files of this commit: [status letter, path]. */
  files: { status: string; file: string }[];
}

/** "2026-11-06T14:32:10+01:00" → "6.11.2026, 14:32" (time as stored in the commit). */
function readableDate(iso: string): string {
  const [, y, m, d, time] = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(iso) ?? [];
  return y ? `${Number(d)}.${Number(m)}.${y}, ${time}` : iso;
}

/**
 * Version history of the content folder: its own git repository (never pushed anywhere).
 * All git calls run one after another; the identity and safe.directory are passed per call so
 * nothing depends on the container's git config.
 */
export class History {
  readonly dir: string;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(dir: string) {
    this.dir = dir;
  }

  private git(args: string[], env: Record<string, string> = {}): Promise<string> {
    return run(
      "git",
      ["-c", "safe.directory=*", "-c", "user.name=Hofchilbi Redaktion", "-c", "user.email=redaktion@hofchilbi.local", "-c", "commit.gpgsign=false", ...args],
      { cwd: this.dir, maxBuffer: 10 * 1024 * 1024, env: { PATH: process.env.PATH ?? "/bin", HOME: process.env.HOME ?? "/tmp", ...env } },
    ).then((r) => r.stdout);
  }

  /** Runs fn after all previous git work finished. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }

  /** Creates the repository on first start and commits whatever is there. */
  init(): Promise<void> {
    return this.serial(async () => {
      try {
        await stat(path.join(this.dir, ".git"));
      } catch {
        await this.git(["init", "-q", "-b", "main"]);
        await writeFile(path.join(this.dir, ".gitignore"), ".version\n*.tmp\n.DS_Store\n");
      }
      // Photos synced from Immich: Immich is the original, the history would only grow.
      const ignore = await readFile(path.join(this.dir, ".gitignore"), "utf8").catch(() => "");
      if (!ignore.split("\n").includes("media/immich/")) {
        await writeFile(path.join(this.dir, ".gitignore"), `${ignore.replace(/\n?$/, "\n")}media/immich/\n.immich-status.json\n`);
        await this.git(["rm", "-r", "-q", "--cached", "--ignore-unmatch", "media/immich"]);
      }
      await this.git(["add", "-A"]);
      const pending = await this.git(["status", "--porcelain"]);
      if (pending.trim()) await this.git(["commit", "-q", "-m", "Stand beim Start der Redaktion"]);
    });
  }

  /** Commits everything that changed (all edits go through the editor, one at a time). Returns HEAD. */
  commit(message: string): Promise<string> {
    return this.serial(async () => {
      await this.git(["add", "-A"]);
      const pending = await this.git(["status", "--porcelain"]);
      if (pending.trim()) await this.git(["commit", "-q", "-m", message]);
      return (await this.git(["rev-parse", "HEAD"])).trim();
    });
  }

  /**
   * Deletes the history older than `keepDays` for good, including files that only old commits still
   * hold. The newest commit before the cut becomes the new first one, the later ones are written
   * again on top of it with their dates. Their trees stay the same, so no content changes.
   * Returns the number of commits removed.
   */
  prune(keepDays = KEEP_DAYS, keepAtLeast = KEEP_AT_LEAST): Promise<number> {
    return this.serial(async () => {
      const cut = Date.now() - keepDays * 24 * 60 * 60 * 1000;
      const out = await this.git(["log", "--reverse", "--first-parent", "--format=%H%x09%T%x09%aI%x09%cI%x09%s"]);
      const commits = out.split("\n").filter(Boolean).map((l) => {
        const [hash, tree, authored, committed, ...subject] = l.split("\t");
        return { hash: hash!, tree: tree!, authored: authored!, committed: committed!, subject: subject.join("\t") };
      });
      const lastOld = commits.findLastIndex((c) => Date.parse(c.committed) < cut);
      const firstKept = Math.min(lastOld + 1, commits.length - keepAtLeast);
      if (firstKept < 2) return 0; // Index 0 is what the new first commit would be anyway.

      const base = commits[firstKept - 1]!;
      let parent = "";
      for (const c of [{ ...base, subject: "Ältester Stand im Verlauf" }, ...commits.slice(firstKept)]) {
        const args = ["commit-tree", c.tree, "-m", c.subject, ...(parent ? ["-p", parent] : [])];
        parent = (await this.git(args, { GIT_AUTHOR_DATE: c.authored, GIT_COMMITTER_DATE: c.committed })).trim();
      }
      // Moves in one step and only from the state read above; a failure before this changes nothing.
      await this.git(["update-ref", "HEAD", parent, commits.at(-1)!.hash]);
      await this.git(["reflog", "expire", "--expire=now", "--all"]);
      // Within the container's memory limit, also with many large images.
      await this.git(["-c", "pack.threads=1", "-c", "pack.windowMemory=128m", "gc", "-q", "--prune=now"]);
      return firstKept - 1;
    });
  }

  /** Newest first, without pure uploads. `skip` pages through older entries. */
  log(limit = 60, skip = 0): Promise<LogEntry[]> {
    return this.serial(async () => {
      const out = await this.git([
        "log",
        `-n${limit}`,
        `--skip=${skip}`,
        `--grep=^${UPLOAD_PREFIX}`,
        "--invert-grep",
        "--no-renames",
        "--name-status",
        "--format=%x01%H%x09%cI%x09%s",
      ]).catch(() => "");
      return out
        .split("\x01")
        .filter((c) => c.trim())
        .map((chunk) => {
          const [head, ...rest] = chunk.split("\n");
          const [hash, date, ...msg] = head!.split("\t");
          const files = rest.filter(Boolean).map((l) => {
            const [status, file] = l.split("\t");
            return { status: status!, file: file! };
          });
          return { hash: hash!, date: date!, message: msg.join("\t"), files };
        });
    });
  }

  /** The newest commit that touched this file. */
  latestOf(file: string): Promise<string> {
    return this.serial(async () => (await this.git(["log", "-n1", "--format=%H", "--", file]).catch(() => "")).trim());
  }

  /** Files once deleted under `dir`, newest deletion first (may exist again by now: the caller checks). */
  deletions(dir: string, limit = 30, grep?: string): Promise<{ hash: string; date: string; file: string }[]> {
    return this.serial(async () => {
      const filter = grep ? [`--grep=${grep}`] : [];
      const out = await this.git(["log", `-n${limit}`, ...filter, "--diff-filter=D", "--no-renames", "--name-only", "--format=%x01%H%x09%cI", "--", dir]).catch(() => "");
      const found: { hash: string; date: string; file: string }[] = [];
      for (const chunk of out.split("\x01")) {
        const [head, ...files] = chunk.split("\n");
        const [hash, date] = (head ?? "").split("\t");
        if (hash && date) for (const file of files.filter(Boolean)) found.push({ hash, date, file });
      }
      return found;
    });
  }

  /** Contents of a file in a commit, or null if it was not there. */
  fileAt(rev: string, file: string): Promise<string | null> {
    return this.serial(() => this.show(rev, file));
  }

  private show(rev: string, file: string): Promise<string | null> {
    return this.git(["show", `${rev}:${file}`]).catch(() => null);
  }

  /** Brings the whole content back to the state of `hash`, as a new commit (nothing is lost). */
  restore(hash: string): Promise<string> {
    if (!/^[0-9a-f]{7,40}$/.test(hash)) return Promise.reject(new Error("bad hash"));
    return this.serial(async () => {
      await this.git(["cat-file", "-e", `${hash}^{commit}`]);
      const date = (await this.git(["show", "-s", "--format=%cI", hash])).trim();
      await this.git(["restore", "--source", hash, "--staged", "--worktree", "--", "."]);
      await this.git(["add", "-A"]);
      const pending = await this.git(["status", "--porcelain"]);
      if (pending.trim()) await this.git(["commit", "-q", "-m", `Ganze Website zurückgeholt: Stand vom ${readableDate(date)}`]);
      return date;
    });
  }

  /**
   * Brings one file back as it was in `hash`, or just before `hash` if that commit deleted it.
   * Everything else stays as it is. Uploads it refers to are brought back too (a full restore to
   * an older state removes newer files), otherwise the site build would fail on them.
   */
  restoreFile(hash: string, file: string, label: string): Promise<void> {
    if (!/^[0-9a-f]{7,40}$/.test(hash)) return Promise.reject(new Error("bad hash"));
    return this.serial(async () => {
      const has = (rev: string) => this.git(["cat-file", "-e", `${rev}:${file}`]).then(() => true, () => false);
      let source = hash;
      if (!(await has(source))) {
        source = `${hash}^`;
        if (!(await has(source))) throw new Error("not in this commit");
      }
      const date = (await this.git(["show", "-s", "--format=%cI", hash])).trim();
      await this.git(["restore", "--source", source, "--staged", "--worktree", "--", file]);
      // Uploads can be larger than the output limit and refer to nothing.
      const text = file.startsWith("media/") ? "" : ((await this.show(source, file)) ?? "");
      for (const ref of new Set(text.match(/media\/[A-Za-z0-9._/-]+/g) ?? [])) {
        const missing = await stat(path.join(this.dir, ref)).then(() => false, () => true);
        if (missing) await this.git(["restore", "--source", source, "--staged", "--worktree", "--", ref]).catch(() => undefined);
      }
      await this.git(["add", "-A"]);
      const pending = await this.git(["status", "--porcelain"]);
      if (pending.trim()) await this.git(["commit", "-q", "-m", `Zurückgeholt: ${label} (Stand vom ${readableDate(date)})`]);
    });
  }
}
