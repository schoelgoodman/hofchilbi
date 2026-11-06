import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { resolveInside, serveStatic } from "./static.ts";

const root = path.resolve("/srv/site");

test("resolveInside: normal paths stay inside", () => {
  assert.equal(resolveInside(root, "/"), root);
  assert.equal(resolveInside(root, "/geschichte"), path.join(root, "geschichte"));
  assert.equal(resolveInside(root, "/media/a%20b.jpg"), path.join(root, "media/a b.jpg"));
});

test("resolveInside: traversal and junk are rejected", () => {
  assert.equal(resolveInside(root, "/../etc/passwd"), null);
  assert.equal(resolveInside(root, "/media/%2e%2e/%2e%2e/etc/passwd"), null);
  assert.equal(resolveInside(root, "/a%00.html"), null);
  assert.equal(resolveInside(root, "/%E0%A4%A"), null);
  assert.equal(resolveInside(root, "/..%5c..%5cetc"), null);
});

test("serveStatic: a file that cannot be read ends the response, not the process", { skip: process.getuid?.() === 0 }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "hofchilbi-static-"));
  const file = path.join(dir, "foto.jpg");
  await writeFile(file, "x");
  // stat still works, opening fails: the same case as a file vanishing right after stat.
  await chmod(file, 0o000);
  const server = http.createServer((req, res) => void serveStatic(req, res, dir));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  await assert.rejects(fetch(`http://127.0.0.1:${port}/foto.jpg`).then((r) => r.text()));
  // Still alive: without a handler the read error would have been an uncaught exception.
  await chmod(file, 0o644);
  assert.equal(await (await fetch(`http://127.0.0.1:${port}/foto.jpg`)).text(), "x");
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await rm(dir, { recursive: true });
});
