import assert from "node:assert/strict";
import { test } from "node:test";
import YAML from "yaml";
import { fileChanges, wordDiff } from "./diff.ts";

const y = (v: unknown) => YAML.stringify(v);
const SITE = {
  title: "A",
  event: { days: ["2027-07-23"], label: "x", location: "x" },
  hero: { image: "media/a.jpg" },
  links: { goenner: "https://a.ch", helfer: "https://a.ch" },
  helperCta: { title: "x", image: "media/a.jpg" },
  contact: { email: "a@a.ch", datenschutz: "https://a.ch", ktv: "https://a.ch" },
  social: { instagram: "https://a.ch", facebook: "https://a.ch" },
  pageImages: { geschichte: "media/a.jpg", impressionen: "media/a.jpg", kontakt: "media/a.jpg" },
  seo: { description: "x", image: "media/a.jpg" },
  editor: { feedbackEmail: "a@a.ch" },
};

test("site: every field of the form has a German label", () => {
  const other = JSON.parse(JSON.stringify(SITE).replaceAll('"x"', '"y"').replaceAll("a.jpg", "b.jpg").replaceAll("a.ch", "b.ch").replace('"A"', '"B"').replace("2027-07-23", "2027-07-24"));
  const changes = fileChanges("site.yaml", y(SITE), y(other))!.changes;
  assert.equal(changes.length, 20);
  for (const c of changes) assert.doesNotMatch(c.label, /^[a-z]+\.[a-zA-Z]+$/, c.label);
});

test("site: readable values, an unchanged file has no changes", () => {
  assert.equal(fileChanges("site.yaml", y(SITE), y(SITE)), null);
  const c = fileChanges("site.yaml", y(SITE), y({ ...SITE, hero: { image: "media/bilder/neu.jpg" }, event: { ...SITE.event, days: ["2027-07-30"] } }))!;
  assert.equal(c.area, "Allgemein, Start & Titelbilder");
  assert.deepEqual(c.changes.find((x) => x.label === "Startbild"), { label: "Startbild", kind: "changed", before: "a.jpg", after: "neu.jpg" });
  assert.equal(c.changes.find((x) => x.label === "Festtage")!.after, "30.7.2027");
});

const FELD = { name: "Feldschlösschen", logo: "media/logos/f.png", url: "https://f.ch" };
const GALLI = { name: "Galli", logo: "media/logos/g.png" };

test("lists: added, removed, changed field and order, by name", () => {
  const before = { main: [FELD, GALLI], goenner: ["Max, Wil"] };
  const labels = (after: unknown) => fileChanges("sponsors.yaml", y(before), y(after))!.changes.map((c) => `${c.kind} ${c.label}`);
  assert.deepEqual(labels({ main: [{ ...FELD, url: "https://neu.ch" }, GALLI], goenner: ["Max, Wil"] }), ["changed Hauptsponsor Feldschlösschen: Webseite"]);
  assert.deepEqual(labels({ main: [GALLI], goenner: ["Max, Wil", "Eva, Wil"] }), ["removed Hauptsponsor: Feldschlösschen", "added Gönner: Eva, Wil"]);
  assert.deepEqual(labels({ main: [GALLI, FELD], goenner: ["Max, Wil"] }), ["changed Hauptsponsor: Reihenfolge geändert"]);
});

test("lists: a renamed item that keeps its logo is the same item", () => {
  const c = fileChanges("sponsors.yaml", y({ main: [FELD] }), y({ main: [{ ...FELD, name: "Feldschlösschen AG" }] }))!.changes;
  assert.deepEqual(c.map((x) => x.label), ["Hauptsponsor Feldschlösschen AG: Name"]);
});

test("lists: the order of Anzapfer does not count, the website sorts them", () => {
  const a = { year: 2025, name: "A" };
  const b = { year: 2026, name: "B" };
  assert.equal(fileChanges("anzapfer.yaml", y({ list: [a, b] }), y({ list: [b, a] })), null);
});

test("checkbox: unset and false are the same, a change reads Ja/Nein", () => {
  const entry = { year: "1540", text: "Kapelle" };
  assert.equal(fileChanges("timeline.yaml", y({ entries: [entry] }), y({ entries: [{ ...entry, highlight: false }] })), null);
  const c = fileChanges("timeline.yaml", y({ entries: [entry] }), y({ entries: [{ ...entry, highlight: true }] }))!.changes[0]!;
  assert.deepEqual([c.before, c.after], ["Nein", "Ja"]);
});

const news = (title: string, body: string, extra = "") => `---\ntitle: ${title}\ndate: 2026-07-27\n${extra}---\n\n${body}\n`;

test("news: named by title, new and deleted, draft switch", () => {
  assert.deepEqual(fileChanges("news/a.md", null, news("Danke", "x")), { area: "News «Danke»", changes: [{ label: "News neu", kind: "added" }] });
  assert.equal(fileChanges("news/a.md", news("Danke", "x"), null)!.changes[0]!.label, "News gelöscht");
  const c = fileChanges("news/a.md", news("Danke", "x", "draft: true\n"), news("Danke", "x", "draft: false\n"))!.changes;
  assert.deepEqual(c, [{ label: "Entwurf", kind: "changed", before: "Ja", after: "Nein" }]);
});

test("text: shows words without Markdown signs, says so if only the formatting changed", () => {
  const changed = fileChanges("news/a.md", news("D", "Wir **freuen** uns"), news("D", "Wir **hoffen** uns"))!.changes[0]!;
  assert.deepEqual(changed.words, [{ t: "same", text: "Wir" }, { t: "del", text: "freuen" }, { t: "add", text: "hoffen" }, { t: "same", text: "uns" }]);
  assert.equal(fileChanges("news/a.md", news("D", "Wir freuen uns"), news("D", "Wir **freuen** uns"))!.changes[0]!.label, "Text: Formatierung oder Link geändert");
});

test("wordDiff: long unchanged stretches shrink, huge rewrites stay fast", () => {
  const words = (n: number, w: string) => Array.from({ length: n }, (_, i) => `${w}${i}`).join(" ");
  const parts = wordDiff(`${words(50, "a")} alt ${words(50, "b")}`, `${words(50, "a")} neu ${words(50, "b")}`);
  assert.deepEqual(parts.map((p) => p.t), ["gap", "same", "del", "add", "same", "gap"]);
  assert.equal(parts[1]!.text.split(" ").length, 8);
  const big = wordDiff(words(4000, "a"), words(4000, "z"));
  assert.deepEqual(big.map((p) => p.t), ["del", "add"]);
});

test("unknown files and galleries", () => {
  assert.equal(fileChanges(".gitignore", "a", "b"), null);
  const g = (n: number) => y({ galleries: [{ year: 2025, images: Array(n).fill({ src: "media/immich/2025/a.jpg" }) }] });
  assert.deepEqual(fileChanges("galleries.yaml", g(3), g(5))!.changes, [{ label: "Fotos 2025", kind: "changed", before: "3", after: "5" }]);
});
