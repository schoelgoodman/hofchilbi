import assert from "node:assert/strict";
import { test } from "node:test";
import { initials, logoSize, newsLayout, splitGoenner } from "./pages.ts";

test("newsLayout: two news are equals, otherwise the newest is big", () => {
  assert.deepEqual(newsLayout([]), { big: undefined, cards: [], list: "0" });
  assert.deepEqual(newsLayout(["a"]), { big: "a", cards: [], list: "0" });
  assert.deepEqual(newsLayout(["a", "b"]), { big: undefined, cards: ["a", "b"], list: "pair" });
  assert.deepEqual(newsLayout(["a", "b", "c"]), { big: "a", cards: ["b", "c"], list: "2" });
  assert.deepEqual(newsLayout(["a", "b", "c", "d", "e", "f"]), { big: "a", cards: ["b", "c", "d", "e", "f"], list: "5" });
});

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

test("initials: first letters of the first two words", () => {
  assert.equal(initials("Pascale Keller"), "PK");
  assert.equal(initials('Hans "Fox" Mäder'), "HM");
  assert.equal(initials("Deborah Dürlewanger"), "DD");
});
