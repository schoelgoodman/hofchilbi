import assert from "node:assert/strict";
import type http from "node:http";
import { test } from "node:test";
import { isForeignWrite, KEY_HEADER, keyMatches, WRITE_HEADER } from "./access.ts";

function req(method: string, headers: Record<string, string> = {}): http.IncomingMessage {
  return { method, headers } as unknown as http.IncomingMessage;
}

test("keyMatches: exact key only", () => {
  assert.equal(keyMatches(req("GET", { [KEY_HEADER]: "abc123" }), "abc123"), true);
  assert.equal(keyMatches(req("GET", { [KEY_HEADER]: "abc12" }), "abc123"), false);
  assert.equal(keyMatches(req("GET", { [KEY_HEADER]: "abc1234" }), "abc123"), false);
  assert.equal(keyMatches(req("GET"), "abc123"), false);
});

test("keyMatches: empty configured key never matches", () => {
  assert.equal(keyMatches(req("GET", { [KEY_HEADER]: "" }), ""), false);
});

test("isForeignWrite: reads are always allowed", () => {
  assert.equal(isForeignWrite(req("GET")), false);
  assert.equal(isForeignWrite(req("HEAD", { "sec-fetch-site": "cross-site" })), false);
});

test("isForeignWrite: writes need the editor header", () => {
  assert.equal(isForeignWrite(req("POST", { host: "x.example" })), true);
  assert.equal(isForeignWrite(req("PUT", { host: "x.example", [WRITE_HEADER]: "1" })), false);
});

test("isForeignWrite: origin must match host or forwarded host", () => {
  const h = { [WRITE_HEADER]: "1", host: "hofchilbi-redaktion:4330", "x-forwarded-host": "chilbiredaktion.example.ch" };
  assert.equal(isForeignWrite(req("POST", { ...h, origin: "https://chilbiredaktion.example.ch" })), false);
  assert.equal(isForeignWrite(req("POST", { ...h, origin: "https://evil.example.ch" })), true);
  assert.equal(isForeignWrite(req("POST", { ...h, origin: "not a url" })), true);
});

test("isForeignWrite: cross-site fetch metadata is rejected even with header", () => {
  assert.equal(isForeignWrite(req("DELETE", { [WRITE_HEADER]: "1", "sec-fetch-site": "cross-site" })), true);
});
