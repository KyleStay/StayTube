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

test("collapsed playlist watch-state rows are removed from layout", () => {
  assert.match(css, /\.staytube-playlist-collapsed\s*\{[^}]*display:\s*none\s*!important/s);
});

test("playlist collapse controls stay visible and readable in dark mode", () => {
  assert.match(css, /\.staytube-playlist-collapse-controls\s*\{[^}]*position:\s*fixed[^}]*z-index:\s*2202/s);
  assert.match(css, /\.staytube-playlist-collapse-controls\s*\{[^}]*background:\s*var\(--yt-spec-base-background, #fff\)/s);
  assert.match(css, /\.staytube-playlist-collapse-slider\s*\{[^}]*accent-color:\s*var\(--yt-spec-call-to-action, #065fd4\)/s);
  assert.match(css, /html\[dark\] \.staytube-playlist-collapse-controls\s*\{[^}]*background:\s*var\(--yt-spec-base-background, #212121\)[^}]*color:\s*var\(--yt-spec-text-primary, #fff\)/s);
  assert.match(css, /html\[dark\] \.staytube-playlist-collapse-slider\s*\{[^}]*accent-color:\s*var\(--yt-spec-call-to-action, #3ea6ff\)/s);
  assert.match(css, /html\[dark\] \.staytube-playlist-collapse-reset\s*\{[^}]*background:\s*var\(--yt-spec-badge-chip-background, #3f3f3f\)[^}]*color:\s*var\(--yt-spec-text-primary, #fff\)/s);
});
