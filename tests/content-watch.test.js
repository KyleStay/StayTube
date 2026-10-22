"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Core = require("../src/core.js");
const source = fs.readFileSync(path.join(__dirname, "../src/content.js"), "utf8");

function element(textContent = "", attributes = {}) {
  const classes = new Set();
  return {
    textContent, dataset: {}, isConnected: true, children: [],
    classList: { contains: (name) => classes.has(name), add: (name) => classes.add(name) },
    getAttribute: (name) => attributes[name] ?? null,
    setAttribute: (name, value) => { attributes[name] = value; },
    append(child) { child.parentElement = this; this.children.push(child); },
    remove() { this.parentElement.children = this.parentElement.children.filter(child => child !== this); }
  };
}

function watchContext(host, selector) {
  const published = () => host.children.filter(child => child.classList.contains("staytube-watch-published"));
  const context = vm.createContext({
    Core, location: { href: "https://www.youtube.com/watch?v=j3p21rZpe5I" },
    document: {
      querySelector: () => published().find(child => child.dataset.videoId === "j3p21rZpe5I") ?? null,
      querySelectorAll(query) {
        if (query === ".staytube-watch-published") return published();
        return query.split(",").includes(selector) ? [host] : [];
      }
    },
    metadataFor: async () => ({ publishedAt: "2026-09-07T12:00:00Z" }),
    metadataCache: new Map(),
    makePublishedTime: () => element("Sep 07 8:00 AM")
  });
  vm.runInContext(source.slice(source.indexOf("  const WATCH_DATE_SELECTOR"), source.indexOf("  const NATIVE_TRANSCRIPT_BUTTON_SELECTOR")), context);
  vm.runInContext(source.slice(source.indexOf("  function currentWatchVideoId()"), source.indexOf("  function findTranscriptButtonPlacement()")), context);
  return context;
}

test("animated watch dates use the accessible age and keep native content intact", async () => {
  // Rolling characters contain every animation frame in textContent. The
  // supplied YouTube layout exposes the actual age only through aria-label.
  const host = element("12345678901234567890 hours ago", { "aria-label": "21 hours ago  " });
  const context = watchContext(host, "ytd-watch-info-text #date-text");
  assert.equal(context.findWatchDateHost(), host);
  await context.ensureWatchPublishedTime();
  await context.ensureWatchPublishedTime();
  assert.equal(host.children.length, 1);
  assert.equal(host.textContent, "12345678901234567890 hours ago");
  assert.match(host.getAttribute("aria-label"), /21 hours ago.*Published Sep 07 8:00 AM/);
  assert.equal(host.children[0].dataset.videoId, "j3p21rZpe5I");
});

test("a date container populated after the initial scan gains one timestamp", async () => {
  const host = element();
  const context = watchContext(host, "ytd-watch-info-text #date-text");
  await context.ensureWatchPublishedTime();
  assert.equal(host.children.length, 0);
  host.textContent = "21 hours ago";
  host.setAttribute("aria-label", "21 hours ago");
  await Promise.all([context.ensureWatchPublishedTime(), context.ensureWatchPublishedTime()]);
  assert.equal(host.children.length, 1);
});

test("legacy watch dates still receive their timestamp inside the visible age span", async () => {
  const host = element("21 hours ago");
  const context = watchContext(host, "ytd-watch-metadata #description-inline-expander #info span");
  await context.ensureWatchPublishedTime();
  assert.equal(host.children.length, 1);
  assert.equal(host.textContent, "21 hours ago");
  assert.equal(host.children[0].parentElement, host);
});

test("native age-label refreshes retain exactly one accessible publication detail", async () => {
  const host = element("21 hours ago", { "aria-label": "21 hours ago" });
  const context = watchContext(host, "ytd-watch-info-text #date-text");
  await context.ensureWatchPublishedTime();
  host.setAttribute("aria-label", "22 hours ago");
  await context.ensureWatchPublishedTime();
  await context.ensureWatchPublishedTime();
  assert.equal(host.children.length, 1);
  assert.match(host.getAttribute("aria-label"), /^22 hours ago.*Published Sep 07 8:00 AM/);
  assert.equal(host.getAttribute("aria-label").match(/Published/g).length, 1);
});

test("stale watch timestamps disappear before the next video's metadata resolves", async () => {
  const host = element("21 hours ago", { "aria-label": "21 hours ago" });
  const context = watchContext(host, "ytd-watch-info-text #date-text");
  await context.ensureWatchPublishedTime();
  host.children[0].dataset.videoId = "oldVideo123";
  let finish;
  context.metadataFor = () => new Promise(resolve => { finish = resolve; });
  const pending = context.ensureWatchPublishedTime();
  assert.equal(host.children.length, 0);
  assert.equal(host.getAttribute("aria-label"), "21 hours ago");
  finish({ publishedAt: "2026-09-07T12:00:00Z" });
  await pending;
  assert.equal(host.children.length, 1);
});

test("date observers cover empty, appended, and aria-only hydrated hosts once", () => {
  const hosts = [element()];
  const observed = [];
  const scheduled = [];
  let notify;
  const context = vm.createContext({
    WATCH_DATE_SELECTOR: "dates", WATCH_DATE_FALLBACK_SELECTOR: "fallbacks",
    document: { querySelectorAll: () => hosts },
    scheduleScan: host => scheduled.push(host),
    MutationObserver: class {
      constructor(callback) { notify = callback; }
      observe(host, options) { observed.push({ host, options }); }
    }
  });
  vm.runInContext(source.slice(source.indexOf("  const observedWatchDates"),
    source.indexOf("  function currentWatchVideoId()")), context);
  context.observeWatchDates();
  hosts.push(element());
  context.observeWatchDates();
  context.observeWatchDates();
  assert.equal(observed.length, 2);
  assert.deepEqual(Array.from(observed[0].options.attributeFilter), ["aria-label"]);
  hosts[0].setAttribute("aria-label", "21 hours ago");
  notify([{ target: hosts[0] }]);
  assert.deepEqual(scheduled, [hosts[0]]);
});

test("native removal of watch controls schedules recovery without an added node", () => {
  const scheduled = [];
  const context = vm.createContext({
    Node: { ELEMENT_NODE: 1 }, isStayTubeMutationTarget: () => false,
    scheduleScan: host => scheduled.push(host), schedulePlaylistActionReconciliation() {}
  });
  vm.runInContext(source.slice(source.indexOf("  function handlePageMutations("),
    source.indexOf("  const mutationObserver =")), context);
  for (const control of [".staytube-watch-published", ".staytube-copy-transcript"]) {
    const host = {};
    context.handlePageMutations([{ target: host, type: "childList", addedNodes: [],
      removedNodes: [{ nodeType: 1, matches: selector => selector.includes(control) }] }]);
    assert.equal(scheduled.at(-1), host);
  }
  assert.equal(scheduled.length, 2);
});
