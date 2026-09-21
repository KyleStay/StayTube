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
