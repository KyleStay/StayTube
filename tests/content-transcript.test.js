"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "../src/content.js"), "utf8");
const styles = fs.readFileSync(path.join(__dirname, "../src/content.css"), "utf8");

test("copy transcript matches native action spacing and feedback", () => {
  assert.match(styles, /\.staytube-copy-transcript \{[^}]*margin-inline-start: 8px !important;/s);
  assert.match(styles, /\.staytube-copy-transcript \.ytSpecButtonShapeNextTextContent \{[^}]*margin-inline-start: 6px !important;/s);
  assert.match(styles, /\.staytube-copy-transcript \.ytSpecTouchFeedbackShapeFill \{[^}]*background-color: currentColor !important;/s);
});

test("caption responses are validated before JSON parsing", () => {
  assert.match(source, /const body = await response\.text\(\)/);
  assert.match(source, /if \(!response\.ok \|\| !trimmed\) continue/);
  assert.doesNotMatch(source, /captionResponse\.json\(\)/);
});

test("invalid timed-text responses fall back to the native transcript panel", () => {
  assert.match(source, /segments = await transcriptSegmentsFromNativePanel\(videoId\)/);
  assert.match(source, /button\[aria-label=\\?"Show transcript\\?"\]/);
  assert.match(source, /yt-navigate-finish/);
  assert.match(source, /description-inline-expander/);
  assert.match(source, /captionSegmentsFromVtt/);
  assert.match(source, /captionSegmentsFromXml/);
  assert.match(source, /resetStaleNativeTranscriptPanels/);
  assert.match(source, /nativeTranscriptBaseline/);
  assert.match(source, /panel\.dataset\.staytubeTranscriptVideoId === videoId/);
  assert.match(source, /event\.isTrusted/);
  assert.match(source, /waitForNativeTranscript\(videoId, baseline\)\.catch/);
  assert.match(source, /#visibility-button button/);
  assert.match(source, /characterData: true/);
  assert.match(source, /childList: true/);
  assert.match(source, /subtree: true/);
  assert.match(source, /const visibleButtons = allButtons\.filter/);
});
