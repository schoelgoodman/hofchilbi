import assert from "node:assert/strict";
import { test } from "node:test";
import { eventLabel, parseFrontmatter, stringifyFrontmatter } from "./load.ts";
import { MediaPath } from "./schema.ts";

test("eventLabel: two days in one month", () => {
  assert.equal(eventLabel(["2027-07-24", "2027-07-23"]), "23. & 24. Juli 2027");
});

test("eventLabel: across months and single day with weekday", () => {
  assert.equal(eventLabel(["2027-07-31", "2027-08-01"]), "31. Juli & 1. August 2027");
  assert.equal(eventLabel(["2027-07-24"], { weekday: true }), "Samstag, 24. Juli 2027");
});

test("frontmatter round trip", () => {
  const text = stringifyFrontmatter({ title: "Wir sagen DANKE!", date: "2026-07-27", draft: false, image: undefined }, "Hallo **Wil**");
  const { data, body } = parseFrontmatter(text);
  assert.deepEqual(data, { title: "Wir sagen DANKE!", date: "2026-07-27", draft: false });
  assert.equal(body.trim(), "Hallo **Wil**");
});

test("MediaPath rejects traversal and non-media paths", () => {
  assert.ok(MediaPath.safeParse("media/logos/feldschloesschen.webp").success);
  assert.ok(!MediaPath.safeParse("media/../site.yaml").success);
  assert.ok(!MediaPath.safeParse("/etc/passwd").success);
  assert.ok(!MediaPath.safeParse("site.yaml").success);
});
