import { execFile } from "node:child_process";
import { stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

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

  private git(args: string[]): Promise<string> {
    return run(
      "git",
      ["-c", "safe.directory=*", "-c", "user.name=Hofchilbi Redaktion", "-c", "user.email=redaktion@hofchilbi.local", "-c", "commit.gpgsign=false", ...args],
      { cwd: this.dir, maxBuffer: 10 * 1024 * 1024, env: { PATH: process.env.PATH ?? "/bin", HOME: process.env.HOME ?? "/tmp" } },
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
      await this.git(["add", "-A"]);
      const pending = await this.git(["status", "--porcelain"]);
      if (pending.trim()) await this.git(["commit", "-q", "-m", "Stand beim Start der Redaktion"]);
    });
  }

  /** Commits everything that changed (all edits go through the editor, one at a time). */
  commit(message: string): Promise<void> {
    return this.serial(async () => {
      await this.git(["add", "-A"]);
      const pending = await this.git(["status", "--porcelain"]);
      if (pending.trim()) await this.git(["commit", "-q", "-m", message]);
    });
  }

  log(limit = 60): Promise<{ hash: string; date: string; message: string }[]> {
    return this.serial(async () => {
      const out = await this.git(["log", `-n${limit}`, "--format=%H%x09%cI%x09%s"]).catch(() => "");
      return out
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [hash, date, ...msg] = line.split("\t");
          return { hash: hash!, date: date!, message: msg.join("\t") };
        });
    });
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
      if (pending.trim()) await this.git(["commit", "-q", "-m", `Wiederhergestellt: Stand vom ${date.slice(0, 16).replace("T", " ")}`]);
      return date;
    });
  }
}
