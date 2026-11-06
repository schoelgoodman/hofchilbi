import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalRedirect, withoutTrailingSlash } from "./urls.ts";

const SITE = "https://www.hofchilbi.ch";

test("canonicalRedirect: only the bare domain goes to www, path and query stay", () => {
  assert.equal(canonicalRedirect("hofchilbi.ch", SITE, "/kontakt?a=1"), "https://www.hofchilbi.ch/kontakt?a=1");
  assert.equal(canonicalRedirect("HOFCHILBI.ch", SITE, "/"), "https://www.hofchilbi.ch/");
  assert.equal(canonicalRedirect("www.hofchilbi.ch", SITE, "/"), null);
  assert.equal(canonicalRedirect("hofchilbi.example.org", SITE, "/"), null);
  assert.equal(canonicalRedirect("evil-hofchilbi.ch", SITE, "/"), null);
});

test("canonicalRedirect: a canonical address without www redirects nothing", () => {
  assert.equal(canonicalRedirect("hofchilbi.ch", "https://hofchilbi.ch", "/"), null);
});

test("withoutTrailingSlash: keeps the query, never leads to another host", () => {
  assert.equal(withoutTrailingSlash("/kontakt/", "?utm_source=flyer"), "/kontakt?utm_source=flyer");
  assert.equal(withoutTrailingSlash("/kontakt/", ""), "/kontakt");
  assert.equal(withoutTrailingSlash("//evil.com/", ""), "/evil.com");
  assert.equal(withoutTrailingSlash("/kontakt", ""), null);
  assert.equal(withoutTrailingSlash("/", ""), null);
});
