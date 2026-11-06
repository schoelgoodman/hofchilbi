import assert from "node:assert/strict";
import { test } from "node:test";
import { NewsFrontmatter } from "./schema.ts";

const base = { title: "T", date: "2026-07-01" };

test("news CTA: label and link belong together", () => {
  assert.ok(NewsFrontmatter.safeParse(base).success);
  assert.ok(NewsFrontmatter.safeParse({ ...base, ctaLabel: "Los", ctaUrl: "https://example.ch" }).success);
  assert.ok(NewsFrontmatter.safeParse({ ...base, ctaLabel: "Los", ctaUrl: "/geschichte" }).success);
  assert.ok(NewsFrontmatter.safeParse({ ...base, ctaLabel: "Los", ctaUrl: "media/dokumente/a.pdf" }).success);
  assert.ok(!NewsFrontmatter.safeParse({ ...base, ctaLabel: "Los" }).success);
  assert.ok(!NewsFrontmatter.safeParse({ ...base, ctaUrl: "/geschichte" }).success);
});

test("news CTA: no scripts or other schemes", () => {
  for (const ctaUrl of ["javascript:alert(1)", "//evil.example", "//evil", "data:text/html,x", "/ geschichte"]) {
    assert.ok(!NewsFrontmatter.safeParse({ ...base, ctaLabel: "Los", ctaUrl }).success, ctaUrl);
  }
});

test("news CTA: a site-wide button needs no label or link of its own", () => {
  assert.ok(NewsFrontmatter.safeParse({ ...base, ctaTarget: "helfer" }).success);
  assert.ok(NewsFrontmatter.safeParse({ ...base, ctaTarget: "goenner" }).success);
  assert.ok(!NewsFrontmatter.safeParse({ ...base, ctaTarget: "startseite" }).success);
  assert.ok(!NewsFrontmatter.safeParse({ ...base, ctaTarget: "helfer", ctaLabel: "Los", ctaUrl: "/geschichte" }).success);
});
