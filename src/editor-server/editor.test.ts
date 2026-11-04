import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import { History } from "./git.ts";
import { HttpError, Store, version } from "./store.ts";
import { processUpload, sniff, uploadDir } from "./upload.ts";

async function tmp(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "hofchilbi-ed-"));
}

const TEAM = { members: [{ name: "Erika Muster", role: "Präsidium" }] };

test("putDoc: needs the current version (no silent overwrite)", async () => {
  const s = new Store(await tmp());
  const v1 = await s.putDoc("team", TEAM, "");
  await assert.rejects(s.putDoc("team", TEAM, ""), (e: HttpError) => e.status === 409);
  await assert.rejects(s.putDoc("team", TEAM, "stale"), (e: HttpError) => e.status === 409);
  const v2 = await s.putDoc("team", { members: [...TEAM.members, { name: "Max Muster", role: "Finanzen" }] }, v1);
  assert.notEqual(v1, v2);
  assert.equal((await s.getDoc("team")).version, v2);
});

test("putDoc: invalid data is rejected per field, file untouched", async () => {
  const dir = await tmp();
  const s = new Store(dir);
  const v1 = await s.putDoc("team", TEAM, "");
  await assert.rejects(
    s.putDoc("team", { members: [{ name: "", role: "x", photo: "../../etc/passwd" }] }, v1),
    (e: HttpError) => e.status === 422 && "members.0.name" in (e.details as object) && "members.0.photo" in (e.details as object),
  );
  assert.equal(version(await readFile(path.join(dir, "team.yaml"))), v1);
});

test("news: create as draft, rename-safe slug, edit, delete", async () => {
  const s = new Store(await tmp());
  const slug = await s.createNews("Grosses Fäscht 2027!");
  assert.match(slug, /^\d{4}-\d{2}-\d{2}-grosses-faescht-2027$/);
  const [n] = await s.listNews();
  assert.equal((n!.meta as { draft: boolean }).draft, true);
  const v = await s.putNews(slug, { title: "Grosses Fäscht", date: "2027-01-02", draft: false }, "Hallo **Wil**", n!.version);
  await assert.rejects(s.deleteNews(slug, n!.version), (e: HttpError) => e.status === 409);
  assert.equal(await s.deleteNews(slug, v), "Grosses Fäscht");
  await assert.rejects(s.putNews("../site", {}, "", ""), (e: HttpError) => e.status === 400);
});

test("sniff: by content, not by name", async () => {
  const png = await sharp({ create: { width: 4, height: 4, channels: 4, background: "#f00" } }).png().toBuffer();
  assert.equal(sniff(png), "png");
  assert.equal(sniff(Buffer.from("%PDF-1.7 ......")), "pdf");
  assert.equal(sniff(Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>')), "svg");
  assert.equal(sniff(Buffer.from("<html><script>alert(1)</script></html>")), null);
});

test("uploadDir: whitelist only", () => {
  assert.equal(uploadDir("logos"), "logos");
  assert.equal(uploadDir("galerie/2027"), "galerie/2027");
  for (const bad of ["galerie", "../x", "galerie/../../x", "media", ""]) assert.throws(() => uploadDir(bad));
});

test("upload: SVG with script becomes a PNG, metadata stripped, PDF only for documents", async () => {
  const dir = await tmp();
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40"><script>alert(1)</script><rect width="100" height="40" fill="red"/></svg>');
  const up = await processUpload(dir, "logos", "logo.svg", svg);
  assert.match(up.path, /^media\/logos\/logo-[0-9a-f]{6}\.png$/);
  assert.equal(sniff(await readFile(path.join(dir, up.path))), "png");

  const jpg = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#08f" } })
    .jpeg()
    .withExif({ IFD0: { Copyright: "secret-gps-like-data" } })
    .toBuffer();
  const up2 = await processUpload(dir, "galerie/2027", "IMG 1234.JPG", jpg);
  const out = await readFile(path.join(dir, up2.path));
  assert.equal(up2.width, 2560);
  assert.ok(!out.includes("secret-gps-like-data"));

  await assert.rejects(processUpload(dir, "logos", "x.pdf", Buffer.from("%PDF-1.7 hello world")), (e: HttpError) => e.status === 415);
  const pdf = await processUpload(dir, "dokumente", "Gönner Brief 2027.pdf", Buffer.from("%PDF-1.7 hello world"));
  assert.match(pdf.path, /^media\/dokumente\/goenner-brief-2027-[0-9a-f]{6}\.pdf$/);
  await assert.rejects(processUpload(dir, "logos", "evil.png", Buffer.from("<html>not an image</html>")), (e: HttpError) => e.status === 415);
});

test("references: missing files and PDFs in image fields are rejected", async () => {
  const dir = await tmp();
  const s = new Store(dir);
  await writeFile(path.join(dir, "x.txt"), "");
  await processUpload(dir, "dokumente", "brief.pdf", Buffer.from("%PDF-1.7 hello world"));
  const pdf = (await import("node:fs/promises")).readdir(path.join(dir, "media/dokumente"));
  const pdfPath = `media/dokumente/${(await pdf)[0]}`;
  await assert.rejects(
    s.putDoc("team", { groupPhoto: pdfPath, members: [{ name: "A", role: "B", photo: "media/team/gibts-nicht.jpg" }] }, ""),
    (e: HttpError) => e.status === 422 && /Bild/.test((e.details as Record<string, string>).groupPhoto!) && /gibt es nicht/.test((e.details as Record<string, string>)["members.0.photo"]!),
  );
  // A PDF is fine where a link is expected.
  await s.checkRefs({ links: { goenner: pdfPath } });
});

test("history: commit, log and restore an older state as a new commit", async () => {
  const dir = await tmp();
  const h = new History(dir);
  await writeFile(path.join(dir, "site.yaml"), "a: 1\n");
  await h.init();
  await writeFile(path.join(dir, "site.yaml"), "a: 2\n");
  await writeFile(path.join(dir, "extra.yaml"), "b: 1\n");
  await h.commit("zwei");
  const log = await h.log();
  assert.deepEqual(log.map((l) => l.message), ["zwei", "Stand beim Start der Redaktion"]);
  await h.restore(log[1]!.hash);
  assert.equal(await readFile(path.join(dir, "site.yaml"), "utf8"), "a: 1\n");
  await assert.rejects(stat(path.join(dir, "extra.yaml")));
  assert.match((await h.log())[0]!.message, /^Wiederhergestellt/);
  await assert.rejects(h.restore("--help"));
});
