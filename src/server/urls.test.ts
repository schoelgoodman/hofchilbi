import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalRedirect, requestHost, withoutTrailingSlash } from "./urls.ts";

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

test("requestHost: the custom domain survives the second nginx hop", () => {
  // What the app receives for www.hofchilbi.ch on Neo: both hops rewrote Host and X-Forwarded-Host.
  const viaCustomDomain = { host: "hofchilbi:4330", "x-forwarded-host": "hofchilbi.example.org", "x-original-host": "www.hofchilbi.ch" };
  assert.equal(requestHost(viaCustomDomain), "www.hofchilbi.ch");
  assert.equal(requestHost({ host: "hofchilbi:4330", "x-forwarded-host": "hofchilbi.example.org" }), "hofchilbi.example.org");
  assert.equal(requestHost({ host: "WWW.hofchilbi.ch" }), "www.hofchilbi.ch");
  assert.equal(requestHost({ "x-forwarded-host": "a.example, b.example" }), "a.example");
  assert.equal(requestHost({}), "");
});
