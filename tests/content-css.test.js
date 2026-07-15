const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const css = fs.readFileSync(path.join(__dirname, "../src/content.css"), "utf8");

test("thumbnail action overlays do not intercept video-link clicks", () => {
  assert.match(css, /yt-thumbnail-hover-overlay-toggle-actions-view-model\s*\{[^}]*pointer-events:\s*none\s*!important/s);
  assert.match(css, /yt-thumbnail-hover-overlay-toggle-actions-view-model\s+:is\(button, a, \[role="button"\]\)\s*\{[^}]*pointer-events:\s*auto\s*!important/s);
  assert.match(css, /#hover-overlays\s*\{[^}]*pointer-events:\s*none\s*!important/s);
  assert.match(css, /ytd-thumbnail-overlay-toggle-button-renderer:first-of-type\s*\{[^}]*pointer-events:\s*auto\s*!important/s);
});
