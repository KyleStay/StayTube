"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "../src/content.js"), "utf8");

test("caption responses are validated before JSON parsing", () => {
  assert.match(source, /const body = await response\.text\(\)/);
  assert.match(source, /if \(!response\.ok \|\| !trimmed\) continue/);
  assert.doesNotMatch(source, /captionResponse\.json\(\)/);
});

test("invalid timed-text responses fall back to the native transcript panel", () => {
  assert.match(source, /segments = await transcriptSegmentsFromNativePanel\(\)/);
  assert.match(source, /button\[aria-label=\\?"Show transcript\\?"\]/);
  assert.match(source, /yt-navigate-finish/);
  assert.match(source, /description-inline-expander/);
  assert.match(source, /captionSegmentsFromVtt/);
  assert.match(source, /captionSegmentsFromXml/);
});
