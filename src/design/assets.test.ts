import assert from "node:assert/strict";
import { test } from "node:test";
import { minifyCss } from "./assets.ts";

test("minifyCss keeps selector semantics", () => {
  assert.equal(minifyCss("/* x */\n.a :focus-visible {\n  color: red;\n}\n.b > .c,\n.d { margin: 0 auto; }"), ".a :focus-visible{color:red}.b>.c,.d{margin:0 auto}");
  assert.equal(minifyCss("@media (min-width: 768px) { .x { width: calc(100% - 2px); } }"), "@media (min-width:768px){.x{width:calc(100% - 2px)}}");
});
