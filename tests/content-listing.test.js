"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "../src/content.js"), "utf8");

test("visible native channel text is converted to a channel link", () => {
  assert.match(source, /function ensureExistingChannelLink\(fallback, metadata\)/);
  assert.match(source, /element\.replaceChildren\(link\)/);
  assert.match(source, /const channelIsNative = ensureExistingChannelLink\(fallback, metadata\)/);
});

test("lockup channel text can reuse an adjacent native channel destination", () => {
  assert.match(source, /const channelNavigation = \[\.\.\.links\]\.find\(\(link\) => link\.href\)/);
  assert.match(source, /channelUrl: channelNavigation\?\.href \?\? null/);
});

test("dynamic listing scans still inspect appended and hydrated video links", () => {
  assert.match(source, /root\.querySelectorAll\(VIDEO_LINK_SELECTOR\)\.forEach\(inspectLink\)/);
  assert.match(source, /mutationObserver\.observe\(document\.documentElement, Core\.LISTING_MUTATION_OBSERVER_OPTIONS\)/);
});

test("watch descriptions gain the exact published date and time", () => {
  assert.match(source, /function findWatchDateHost\(\)/);
  assert.match(source, /ytd-watch-metadata #description-inline-expander #info span/);
  assert.match(source, /WATCH_DATE_FALLBACK_SELECTOR/);
  assert.match(source, /async function ensureWatchPublishedTime\(\)/);
  assert.match(source, /published\.classList\.add\("staytube-watch-published"\)/);
  assert.match(source, /host\.append\(published\)/);
  assert.match(source, /exposeWatchPublishedTimeToAssistiveTechnology\(host, published\)/);
  assert.match(source, /replaceAccessibleLabelDetail\(currentLabel, previousDetail, detail\)/);
  assert.doesNotMatch(source, /host\.insertAdjacentElement\("afterend", published\)/);
  assert.match(source, /ensureWatchPublishedTime\(\)/);
});

test("watch timestamps are guarded against stale SPA navigation results", () => {
  assert.match(source, /currentWatchVideoId\(\) !== videoId \|\| !host\.isConnected/);
  assert.match(source, /staytube-watch-published\[data-video-id=/);
});
