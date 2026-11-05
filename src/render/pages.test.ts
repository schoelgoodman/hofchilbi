import assert from "node:assert/strict";
import { test } from "node:test";
import { anzapferRows, initials, logoSize, splitGoenner } from "./pages.ts";

test("logoSize: steps of √2 in aspect ratio, clamped", () => {
  assert.equal(logoSize(1), 0);
  assert.equal(logoSize(2), 2);
  assert.equal(logoSize(4), 4);
  assert.equal(logoSize(0.1), -2);
  assert.equal(logoSize(30), 6);
});

test("splitGoenner: place after the last comma", () => {
  assert.deepEqual(splitGoenner("Roswita Hug, Arbon"), { name: "Roswita Hug", place: "Arbon" });
  assert.deepEqual(splitGoenner("Dorfmetzg Tanner, Jeannette, Marcel & René Tanner, Henau"), {
    name: "Dorfmetzg Tanner",
    detail: "Jeannette, Marcel & René Tanner",
    place: "Henau",
  });
  assert.deepEqual(splitGoenner("Anonym"), { name: "Anonym" });
});

test("anzapferRows: same note in consecutive years is merged", () => {
  const rows = anzapferRows([
    { year: 2022, name: "A" },
    { year: 2021, note: "Keine Hofchilbi (Corona)" },
    { year: 2020, note: "Keine Hofchilbi (Corona)" },
    { year: 2019, name: "B" },
  ]);
  assert.deepEqual(
    rows.map((r) => [r.from, r.to, r.name ?? r.note]),
    [
      [2022, 2022, "A"],
      [2020, 2021, "Keine Hofchilbi (Corona)"],
      [2019, 2019, "B"],
    ],
  );
});

test("initials: first letters of the first two words", () => {
  assert.equal(initials("Pascale Keller"), "PK");
  assert.equal(initials('Hans "Fox" Mäder'), "HM");
  assert.equal(initials("Deborah Dürlewanger"), "DD");
});
