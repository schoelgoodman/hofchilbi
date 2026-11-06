import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import { History } from "./git.ts";
import { areaLabel, HttpError, siteChange, Store, version } from "./store.ts";
import { assertDeletable, listMedia } from "./media.ts";
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
  for (const bad of ["galerie", "galerie/2027", "../x", "logos/../../x", "media", ""]) assert.throws(() => uploadDir(bad));
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
  const up2 = await processUpload(dir, "bilder", "IMG 1234.JPG", jpg);
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
  assert.match((await h.log())[0]!.message, /^Ganze Website zurückgeholt/);
  await assert.rejects(h.restore("--help"));
});

async function historyRepo(): Promise<{ dir: string; h: History }> {
  const dir = await tmp();
  const h = new History(dir);
  await h.init();
  return { dir, h };
}

test("history: uploads are not listed, entries know their files", async () => {
  const { dir, h } = await historyRepo();
  await writeFile(path.join(dir, "team.yaml"), "members: []\n");
  await h.commit("Team gespeichert");
  await mkdir(path.join(dir, "media"));
  await writeFile(path.join(dir, "media/a.jpg"), "x");
  await h.commit("Datei hochgeladen: media/a.jpg");
  const log = await h.log();
  assert.deepEqual(log.map((e) => e.message), ["Team gespeichert", "Stand beim Start der Redaktion"]);
  assert.deepEqual(log[0]!.files, [{ status: "A", file: "team.yaml" }]);
});

test("restoreFile: only that file changes, referenced uploads come back too", async () => {
  const { dir, h } = await historyRepo();
  await mkdir(path.join(dir, "media"));
  await writeFile(path.join(dir, "media/a.jpg"), "x");
  await writeFile(path.join(dir, "team.yaml"), "groupPhoto: media/a.jpg\n");
  await writeFile(path.join(dir, "timeline.yaml"), "entries: []\n");
  const old = await h.commit("Stand A");
  await writeFile(path.join(dir, "team.yaml"), "members: []\n");
  await writeFile(path.join(dir, "timeline.yaml"), "entries: [neu]\n");
  await rm(path.join(dir, "media/a.jpg"));
  await h.commit("Stand B");

  await h.restoreFile(old, "team.yaml", "Team");
  assert.equal(await readFile(path.join(dir, "team.yaml"), "utf8"), "groupPhoto: media/a.jpg\n");
  assert.equal(await readFile(path.join(dir, "timeline.yaml"), "utf8"), "entries: [neu]\n");
  assert.equal(await readFile(path.join(dir, "media/a.jpg"), "utf8"), "x");
  assert.match((await h.log())[0]!.message, /^Zurückgeholt: Team \(Stand vom /);
  await assert.rejects(h.restoreFile(old, "gibt-es-nicht.yaml", "x"));
  await assert.rejects(h.restoreFile("not-a-hash", "team.yaml", "Team"));
});

test("restoreFile: a commit that deleted the file brings back the version before it", async () => {
  const { dir, h } = await historyRepo();
  await mkdir(path.join(dir, "news"));
  await writeFile(path.join(dir, "news/a.md"), "---\ntitle: A\n---\nText");
  await h.commit("News angelegt");
  await rm(path.join(dir, "news/a.md"));
  const del = await h.commit("News gelöscht: A");
  assert.deepEqual((await h.deletions("news")).map((d) => [d.hash, d.file]), [[del, "news/a.md"]]);
  await h.restoreFile(del, "news/a.md", "diese News");
  assert.equal(await readFile(path.join(dir, "news/a.md"), "utf8"), "---\ntitle: A\n---\nText");
});

test("areaLabel: only content files that make sense on their own", () => {
  assert.equal(areaLabel("team.yaml"), "Team");
  assert.equal(areaLabel("pages/geschichte.md"), "Geschichte");
  assert.equal(areaLabel("news/2027-01-01-fest.md"), "diese News");
  for (const bad of [".gitignore", "media/a.jpg", "pages/geheim.md", "../team.yaml", "news/../site.yaml"]) assert.equal(areaLabel(bad), null);
});

test("siteChange: names the screens a change of site.yaml belongs to", () => {
  const base = { event: { days: ["2027-07-23"] }, hero: { image: "a" }, pageImages: { geschichte: "g", kontakt: "k" } };
  assert.equal(siteChange(base, structuredClone(base)), "Allgemein gespeichert");
  assert.equal(siteChange(base, { ...base, hero: { image: "b" } }), "Start geändert");
  assert.equal(siteChange(base, { ...base, event: { days: [] }, pageImages: { geschichte: "x", kontakt: "k" } }), "Allgemein, Titelbild Geschichte geändert");
});

const SITE = { event: { days: ["2027-07-23"] }, hero: { image: "media/bilder/a.jpg" }, links: { goenner: "media/dokumente/g.pdf", helfer: "https://example.ch" }, helperCta: { title: "T", image: "media/bilder/a.jpg" }, contact: { email: "a@b.ch", datenschutz: "https://example.ch", ktv: "https://example.ch" }, social: {}, pageImages: { geschichte: "media/bilder/b.jpg", impressionen: "media/bilder/a.jpg", kontakt: "media/bilder/a.jpg" }, seo: { description: "x" } };

async function mediaStore(): Promise<{ dir: string; s: Store }> {
  const dir = await tmp();
  const s = new Store(dir);
  for (const f of ["bilder/a.jpg", "bilder/b.jpg", "bilder/frei.jpg", "dokumente/g.pdf", "dokumente/news.pdf", "immich/2027/x.jpg", "galerie/2025/alt.jpg"]) {
    await mkdir(path.dirname(path.join(dir, "media", f)), { recursive: true });
    await writeFile(path.join(dir, "media", f), "x");
  }
  await s.putDoc("site", SITE, "");
  return { dir, s };
}

test("media: knows where files are used, leaves gallery photos out", async () => {
  const { s } = await mediaStore();
  const slug = await s.createNews("Fest");
  const [n] = await s.listNews();
  await s.putNews(slug, { title: "Fest", date: "2027-01-02", ctaLabel: "PDF", ctaUrl: "media/dokumente/news.pdf" }, "Text", n!.version);
  const files = new Map((await listMedia(s)).map((f) => [f.path, f]));
  assert.ok(!files.has("media/immich/2027/x.jpg"));
  assert.ok(!files.has("media/galerie/2025/alt.jpg"));
  assert.deepEqual(files.get("media/bilder/b.jpg")!.used, [{ label: "Geschichte", route: "geschichte" }]);
  assert.deepEqual(files.get("media/bilder/a.jpg")!.used.map((u) => u.label).sort(), ["Impressionen", "Kontakt", "Start"]);
  assert.deepEqual(files.get("media/dokumente/g.pdf")!.used, [{ label: "Start", route: "start" }]);
  assert.deepEqual(files.get("media/dokumente/news.pdf")!.used, [{ label: "News: Fest", route: `news/${slug}` }]);
  assert.deepEqual(files.get("media/bilder/frei.jpg")!.used, []);
  assert.equal(files.get("media/dokumente/g.pdf")!.kind, "pdf");
});

test("media: only unused files of our own can be deleted", async () => {
  const { s } = await mediaStore();
  await assertDeletable(s, "media/bilder/frei.jpg");
  await assert.rejects(assertDeletable(s, "media/bilder/a.jpg"), (e: HttpError) => e.status === 409 && e.message.includes("Start"));
  await assert.rejects(assertDeletable(s, "media/immich/2027/x.jpg"), (e: HttpError) => e.status === 400);
  await assert.rejects(assertDeletable(s, "media/galerie/2025/alt.jpg"), (e: HttpError) => e.status === 400);
  await assert.rejects(assertDeletable(s, "media/../site.yaml"), (e: HttpError) => e.status === 400);
  await assert.rejects(assertDeletable(s, "media/bilder/fehlt.jpg"), (e: HttpError) => e.status === 404);
});

test("restoreFile: brings back an upload deleted on its own, also a large one", async () => {
  const { dir, h } = await historyRepo();
  await mkdir(path.join(dir, "media"));
  // Larger than the output limit of the git calls.
  await writeFile(path.join(dir, "media/gross.pdf"), Buffer.alloc(11 * 1024 * 1024, 1));
  await h.commit("Datei hochgeladen: media/gross.pdf");
  await rm(path.join(dir, "media/gross.pdf"));
  const del = await h.commit("Datei gelöscht: gross.pdf");
  assert.deepEqual((await h.deletions("media", 30, "^Datei gelöscht: ")).map((d) => d.hash), [del]);
  await h.restoreFile(del, "media/gross.pdf", "Datei gross.pdf");
  assert.equal((await stat(path.join(dir, "media/gross.pdf"))).size, 11 * 1024 * 1024);
});

test("putNews: validation errors name the field of the editor form (meta.*)", async () => {
  const { s } = await mediaStore();
  const slug = await s.createNews("Fest");
  const [n] = await s.listNews();
  await assert.rejects(
    s.putNews(slug, { title: "Fest", date: "2027-01-02", ctaLabel: "Hier" }, "", n!.version),
    (e: HttpError) => e.status === 422 && (e.details as Record<string, string>)["meta.ctaUrl"] === "Wohin soll der Button führen?",
  );
});

test("putNews: a news button may lead to an uploaded PDF", async () => {
  const { s } = await mediaStore();
  const slug = await s.createNews("Fest");
  const [n] = await s.listNews();
  await s.putNews(slug, { title: "Fest", date: "2027-01-02", ctaLabel: "PDF", ctaUrl: "media/dokumente/g.pdf" }, "", n!.version);
});
