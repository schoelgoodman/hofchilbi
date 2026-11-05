import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import YAML from "yaml";
import { albumYear, ImmichSync } from "./immich.ts";
import { Store } from "./store.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("albumYear: only «Hofchilbi <year>»", () => {
  assert.equal(albumYear("Hofchilbi 2025"), 2025);
  assert.equal(albumYear("  hofchilbi 2019 "), 2019);
  assert.equal(albumYear("Hofchilbi 2025 Backstage"), null);
  assert.equal(albumYear("Ferien 2025"), null);
});

test("ImmichSync: downloads albums, writes galleries.yaml, removes vanished and old images", async () => {
  const jpeg = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#c33" } }).jpeg().toBuffer();
  let album25 = [id(1), id(2)];
  const seenKeys = new Set<string>();
  const server = http.createServer(async (req, res) => {
    seenKeys.add(String(req.headers["x-api-key"]));
    const url = new URL(req.url!, "http://x");
    if (url.pathname === "/api/albums") {
      res.end(JSON.stringify([
        { id: id(100), albumName: "Hofchilbi 2025" },
        { id: id(101), albumName: "Hofchilbi 2024" },
        { id: id(102), albumName: "Privat" },
      ]));
      return;
    }
    if (url.pathname === "/api/search/metadata") {
      let body = "";
      for await (const c of req) body += c;
      const albumId = JSON.parse(body).filter.albumIds.any[0];
      const ids = albumId === id(100) ? album25 : albumId === id(101) ? [id(3)] : [id(99)];
      res.end(JSON.stringify({ assets: { items: ids.map((x, i) => ({ id: x, localDateTime: `2025-07-2${i}T20:00:00` })), nextCursor: null } }));
      return;
    }
    if (/^\/api\/assets\/[0-9a-f-]+\/thumbnail$/.test(url.pathname) && url.searchParams.get("size") === "preview") {
      res.setHeader("Content-Type", "image/jpeg");
      res.end(jpeg);
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;

  const dir = await mkdtemp(path.join(os.tmpdir(), "immich-"));
  try {
    // A former hand-made gallery that Immich replaces.
    await mkdir(path.join(dir, "media/galerie/2024"), { recursive: true });
    await writeFile(path.join(dir, "media/galerie/2024/alt.jpg"), jpeg);
    await writeFile(path.join(dir, "galleries.yaml"), YAML.stringify({ galleries: [{ year: 2024, images: [{ src: "media/galerie/2024/alt.jpg" }] }] }));

    const messages: string[] = [];
    const sync = new ImmichSync({ url: `http://127.0.0.1:${port}`, apiKey: "k3y", intervalMinutes: 0 }, new Store(dir), async (m) => {
      messages.push(m);
    });
    await sync.sync();

    const g = YAML.parse(await readFile(path.join(dir, "galleries.yaml"), "utf8"));
    assert.deepEqual(g.galleries.map((x: { year: number }) => x.year), [2025, 2024]);
    assert.deepEqual(g.galleries[0].images.map((i: { src: string }) => i.src), [`media/immich/2025/${id(1)}.jpg`, `media/immich/2025/${id(2)}.jpg`]);
    assert.equal(messages.length, 1);
    assert.deepEqual([...seenKeys], ["k3y"]);
    await assert.rejects(stat(path.join(dir, "media/galerie/2024/alt.jpg")));
    // Re-encoded: still a JPEG, no metadata from Immich.
    const meta = await sharp(path.join(dir, `media/immich/2025/${id(1)}.jpg`)).metadata();
    assert.equal(meta.format, "jpeg");
    assert.equal(meta.exif, undefined);
    assert.equal(sync.status.albums.length, 2);

    // Nothing changed: no new history entry.
    await sync.sync();
    assert.equal(messages.length, 1);

    // An image removed from the album disappears from disk and galleries.yaml.
    album25 = [id(2)];
    await sync.sync();
    assert.deepEqual(await readdir(path.join(dir, "media/immich/2025")), [`${id(2)}.jpg`]);
    const g2 = YAML.parse(await readFile(path.join(dir, "galleries.yaml"), "utf8"));
    assert.equal(g2.galleries[0].images.length, 1);
    assert.equal(messages.length, 2);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("ImmichSync: no matching albums keeps the current galleries", async () => {
  const server = http.createServer((_req, res) => res.end("[]"));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const dir = await mkdtemp(path.join(os.tmpdir(), "immich-"));
  try {
    await writeFile(path.join(dir, "galleries.yaml"), "galleries: []\n");
    const sync = new ImmichSync({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, apiKey: "k", intervalMinutes: 0 }, new Store(dir), async () => {});
    await assert.rejects(sync.sync(), /Keine Alben/);
    assert.match(sync.status.lastError ?? "", /Keine Alben/);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
