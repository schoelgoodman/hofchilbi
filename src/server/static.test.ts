import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { resolveInside } from "./static.ts";

const root = path.resolve("/srv/site");

test("resolveInside: normal paths stay inside", () => {
  assert.equal(resolveInside(root, "/"), root);
  assert.equal(resolveInside(root, "/geschichte"), path.join(root, "geschichte"));
  assert.equal(resolveInside(root, "/media/a%20b.jpg"), path.join(root, "media/a b.jpg"));
});

test("resolveInside: traversal and junk are rejected", () => {
  assert.equal(resolveInside(root, "/../etc/passwd"), null);
  assert.equal(resolveInside(root, "/media/%2e%2e/%2e%2e/etc/passwd"), null);
  assert.equal(resolveInside(root, "/a%00.html"), null);
  assert.equal(resolveInside(root, "/%E0%A4%A"), null);
  assert.equal(resolveInside(root, "/..%5c..%5cetc"), null);
});
