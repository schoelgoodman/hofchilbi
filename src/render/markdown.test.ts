import assert from "node:assert/strict";
import { test } from "node:test";
import { html } from "./html.ts";
import { markdown, markdownText } from "./markdown.ts";

test("markdown escapes raw HTML and drops script links", () => {
  const out = markdown('<script>alert(1)</script> [x](javascript:alert(1)) <img src=x onerror=alert(1)>').value;
  assert.ok(!out.includes("<script"));
  assert.ok(!out.includes("<img"));
  assert.ok(!out.includes('href="javascript:'));
});

test("markdown: external links open in new tab, headings shift to h3", () => {
  const out = markdown("# Titel\n\n[KTV](https://ktvwil-handball.ch)").value;
  assert.match(out, /<h3>Titel<\/h3>/);
  assert.match(out, /target="_blank" rel="noopener"|rel="noopener" target="_blank"/);
});

test("markdownText strips tags", () => {
  assert.equal(markdownText("Wir freuen uns – **23. & 24. Juli**!"), "Wir freuen uns – 23. & 24. Juli!");
});

test("html escapes values but not nested html", () => {
  const inner = html`<b>${"<i>"}</b>`;
  assert.equal(html`<p title="${'"x"'}">${inner}${null}${["a", "&"]}</p>`.value, '<p title="&quot;x&quot;"><b>&lt;i&gt;</b>a&amp;</p>');
});
