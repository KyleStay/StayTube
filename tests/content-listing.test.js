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

test("playlist rows get an idempotent clean-video link for a new tab", () => {
  assert.match(source, /function ensurePlaylistCleanLink\(card\)/);
  assert.match(source, /Core\.cleanVideoUrl\(videoLink\?\.href, location\.origin\)/);
  assert.match(source, /menu\.querySelector\(":scope > \.staytube-playlist-open-clean"\)/);
  assert.match(source, /link\.target = "_blank"/);
  assert.match(source, /link\.rel = "noopener noreferrer"/);
  assert.match(source, /ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer/);
  assert.match(source, /ensurePlaylistCleanLink\(row\)/);
});

test("playlist row action buttons keep a deterministic order across re-renders", () => {
  assert.match(source, /cleanLink\.after\(button\)/);
  assert.match(source, /removeButton\.before\(link\)/);
  assert.match(source, /link\.compareDocumentPosition\(removeButton\) & Node\.DOCUMENT_POSITION_PRECEDING/);
});

test("playlist remove buttons recognize current editable-row data", () => {
  assert.match(source, /function playlistRowIsEditable\(card\)/);
  assert.match(source, /listData\?\.isEditable === true/);
  assert.match(source, /rowData\?\.menu\?\.menuRenderer\?\.items/);
  assert.match(source, /Core\.isRemoveFromPlaylistLabel\(label\)/);
  assert.match(source, /if \(!playlistRowIsEditable\(card\)\) return/);
  assert.match(source, /let button = menu\.querySelector\(":scope > \.staytube-playlist-remove"\)/);
  assert.match(source, /button\.setAttribute\("aria-label", title/);
  assert.match(source, /editablePlaylistIds\.has\(playlistId\)/);
  assert.match(source, /editablePlaylistIds\.add\(playlistId\)/);
  assert.match(source, /function currentPlaylistId\(\)/);
  assert.match(source, /function schedulePlaylistActionReconciliation\(\)/);
  assert.match(source, /if \(playlistReconciliationPending\) return/);
  assert.match(source, /\[0, 100, 300, 750\]/);
  assert.match(source, /record\.removedNodes/);
  assert.match(source, /if \(removedPlaylistAction\) schedulePlaylistActionReconciliation\(\)/);
});

test("playlist progress gate classifies and rescans dynamic rows", () => {
  assert.match(source, /function ensurePlaylistCollapseControls\(\)/);
  assert.match(source, /function playlistWatchProgress\(card\)/);
  assert.match(source, /Core\.watchProgressFromOverlays\(overlays\)/);
  assert.match(source, /WatchedProgressBarSegment/);
  assert.ok(
    source.indexOf("const progressIndicators") < source.indexOf("const statusIndicators"),
    "numeric progress indicators should be checked before generic watched badges"
  );
  assert.match(source, /function resolvePlaylistWatchProgress\(card, preferCached = false\)/);
  assert.match(source, /card\.dataset\.staytubeWatchProgress/);
  assert.match(source, /Absence of a DOM progress indicator is not proof of 0%/);
  assert.match(source, /function updatePlaylistRowsCollapse\(cards, preferCached = false\)/);
  assert.match(source, /progress < playlistProgressGate\.min \|\| progress > playlistProgressGate\.max/);
  assert.match(source, /updatePlaylistRowsCollapse\(playlistRows\)/);
  assert.match(source, /ensurePlaylistCollapseControls\(\)/);
  assert.match(source, /updatePlaylistCollapseControls\(\)/);
  assert.match(source, /document\.body\.append\(controls\)/);
  assert.match(source, /location\.pathname === "\/playlist"/);
});

test("playlist gate sliders clamp each other instead of conflicting", () => {
  assert.match(source, /slider\.type = "range"/);
  assert.match(source, /"at least"/);
  assert.match(source, /"at most"/);
  assert.match(source, /playlistProgressGate\.max = Math\.max\(playlistProgressGate\.max, playlistProgressGate\.min\)/);
  assert.match(source, /playlistProgressGate\.min = Math\.min\(playlistProgressGate\.min, playlistProgressGate\.max\)/);
  assert.match(source, /reset\.textContent = "Show all"/);
});

test("unavailable-only mode overrides the gate without conflicting with it", () => {
  assert.match(source, /function playlistRowIsUnavailable\(card\)/);
  assert.match(source, /Core\.isUnavailableListingTitle\(title\)/);
  assert.match(source, /no_thumbnail/);
  assert.match(source, /if \(playlistUnavailableOnly\) \{/);
  assert.match(source, /card\.classList\.toggle\("staytube-playlist-collapsed", !availability\[index\]\)/);
  assert.match(source, /slider\.disabled = playlistUnavailableOnly/);
  assert.match(source, /unavailable\.textContent = "Unavailable only"/);
  assert.match(source, /playlistUnavailableOnly = false;\s*\n\s*applyPlaylistCollapseFilters\(\)/);
});

test("playlist progress attributes are observed only inside playlist containers", () => {
  assert.match(source, /const playlistProgressObserver = new MutationObserver/);
  assert.match(source, /function observePlaylistProgress\(root\)/);
  assert.match(source, /ytd-playlist-video-list-renderer/);
  assert.match(source, /playlistProgressObserver\.observe\(container, Core\.PLAYLIST_PROGRESS_OBSERVER_OPTIONS\)/);
  assert.match(source, /function schedulePlaylistCollapseUpdate\(\)/);
  assert.doesNotMatch(source, /mutationObserver\.observe\(document\.documentElement, Core\.PLAYLIST_PROGRESS_OBSERVER_OPTIONS\)/);
});

test("playlist filtering preserves cached geometry and coalesces slider work", () => {
  assert.match(source, /if \(progressIndicators\.length\) return null/);
  assert.match(source, /function resolvePlaylistWatchProgress\(card, preferCached = false\)/);
  assert.match(source, /if \(preferCached && cacheIsCurrent\) return cached/);
  assert.match(source, /if \(collapseFilterScheduled\) return/);
  assert.match(source, /applyPlaylistCollapseFilters\(playlistUnavailableOnly\)/);
  assert.doesNotMatch(source, /settledUnwatchedVideoIds/);
  assert.doesNotMatch(source, /pendingUnwatchedVideoIds/);
  assert.match(source, /staytubeWatchProgressVideoId/);
});

test("playlist clean links are removed while recycled rows rehydrate", () => {
  assert.match(source, /if \(!cleanUrl \|\| !menu\) \{\s*link\?\.remove\(\);\s*return;/);
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
