import assert from "node:assert/strict";
import { test } from "node:test";
import { siteChecks, swissToday, type CheckInput } from "./check.ts";

const OK: CheckInput = {
  site: { event: { days: ["2027-07-23", "2027-07-24"] } },
  anzapfer: { list: [{ year: 2026, name: "Maurice" }] },
  news: [{ slug: "danke", meta: { title: "Danke", image: "media/a.jpg", imageAlt: "Die Bar" } }],
  impressum: { meta: {}, body: "KTV Wil" },
  immichError: undefined,
  today: "2026-11-06",
};
const ids = (over: Partial<CheckInput>) => siteChecks({ ...OK, ...over }).map((f) => f.id);

test("nothing to do", () => {
  assert.deepEqual(ids({}), []);
});

test("no content yet: no findings", () => {
  assert.deepEqual(ids({ site: null, anzapfer: null, impressum: undefined }), []);
});

test("festival date: on the last day it still counts, the day after it is over", () => {
  const list = { list: [{ year: 2026 }, { year: 2027 }] };
  assert.deepEqual(ids({ anzapfer: list, today: "2027-07-24" }), []);
  assert.deepEqual(ids({ anzapfer: list, today: "2027-07-25" }), ["event-over"]);
  const site = { event: { days: ["2027-07-23", "2027-07-24"], label: "Juli 2028 – Datum folgt" } };
  assert.deepEqual(ids({ site, anzapfer: list, today: "2027-07-25" }), []);
});

test("Anzapfer: last year's before the festival, this year's after it", () => {
  assert.deepEqual(ids({ anzapfer: { list: [] } }), ["anzapfer-missing"]);
  const after = siteChecks({ ...OK, today: "2027-08-01" }).find((f) => f.id === "anzapfer-missing")!;
  assert.equal(after.title, "Anzapfer 2027 fehlt");
});

test("Impressum: text or a redirect are both fine", () => {
  assert.deepEqual(ids({ impressum: undefined }), ["impressum-missing"]);
  assert.deepEqual(ids({ impressum: { meta: {}, body: "  " } }), ["impressum-missing"]);
  assert.deepEqual(ids({ impressum: { meta: { redirect: "https://ktv.ch" }, body: "" } }), []);
});

test("news image without description: published only, leads to that news", () => {
  const meta = { title: "Neu", image: "media/a.jpg" };
  const [f] = siteChecks({ ...OK, news: [{ slug: "neu", meta }] });
  assert.equal(f!.route, "news/neu");
  assert.deepEqual(ids({ news: [{ slug: "neu", meta: { ...meta, draft: true } }] }), []);
  assert.deepEqual(ids({ news: [{ slug: "neu", meta: { title: "Ohne Bild" } }] }), []);
  assert.deepEqual(ids({ news: [{ slug: "neu", meta: { ...meta, imageAlt: "  " } }] }), ["news-alt-neu"]);
});

test("Immich error is passed on", () => {
  assert.equal(siteChecks({ ...OK, immichError: "Immich lehnt den Schlüssel ab" })[0]!.id, "immich-error");
});

test("swissToday: the Swiss date, not the server's", () => {
  assert.equal(swissToday(new Date("2027-07-24T22:30:00Z")), "2027-07-25");
});
