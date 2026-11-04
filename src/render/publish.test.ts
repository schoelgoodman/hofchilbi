import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { liveBuild, publishBuild } from "./publish.ts";

test("publishBuild swaps current atomically and prunes old builds", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hofchilbi-site-"));
  assert.equal(await liveBuild(root), null);

  for (const n of [1, 2, 3, 4]) {
    await publishBuild(root, (dir) => writeFile(path.join(dir, "index.html"), `v${n}`));
    await new Promise((r) => setTimeout(r, 2));
  }
  assert.equal(await readFile(path.join(root, "current", "index.html"), "utf8"), "v4");
  const builds = (await readdir(root)).filter((n) => n.startsWith("build-"));
  assert.equal(builds.length, 2, "live build plus one previous");
  assert.ok(!(await readdir(root)).some((n) => n.startsWith(".current-")));
});

test("publishBuild keeps the old site when the build throws", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hofchilbi-site-"));
  await publishBuild(root, (dir) => writeFile(path.join(dir, "index.html"), "good"));
  await assert.rejects(publishBuild(root, async () => { throw new Error("boom"); }));
  assert.equal(await readFile(path.join(root, "current", "index.html"), "utf8"), "good");
});
