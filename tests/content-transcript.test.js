"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "../src/content.js"), "utf8");

// Exercise selector priority: querySelector with a comma list chooses document
// order, which used to place the button outside #actions-inner.
const vm = require("node:vm");
const placementSource = source.slice(
  source.indexOf("  function findTranscriptButtonPlacement()"),
  source.indexOf("  async function copyTranscript(")
);

test("transcript placement prefers the inner action row over its ancestor", () => {
  const inner = {};
  const outer = {};
  const context = vm.createContext({ document: {
    querySelector(selector) {
      return selector === "ytd-watch-metadata #actions-inner" ? inner : outer;
    }
  } });
  vm.runInContext(placementSource, context);
  assert.equal(context.findTranscriptButtonPlacement().host, inner);
});

test("transcript placement supports partially hydrated and mobile actions", () => {
  const hosts = new Map();
  const context = vm.createContext({ document: {
    querySelector: (selector) => hosts.get(selector) ?? null
  } });
  vm.runInContext(placementSource, context);
  assert.equal(context.findTranscriptButtonPlacement(), null);
  const mobile = {};
  hosts.set("ytm-slim-video-metadata-section-renderer .slim-video-metadata-actions", mobile);
  assert.equal(context.findTranscriptButtonPlacement().host, mobile);
  const outer = {};
  hosts.set("ytd-watch-metadata #actions", outer);
  assert.equal(context.findTranscriptButtonPlacement().host, outer);
  const inner = {};
  hosts.set("ytd-watch-metadata #actions-inner", inner);
  assert.equal(context.findTranscriptButtonPlacement().host, inner);
});

test("hydrating the inner row moves the existing button without resetting its state or listener", () => {
  const buttons = [];
  const makeHost = () => ({ querySelectorAll: () => [], append(button) { button.parentElement = this; } });
  const outer = makeHost();
  let inner = null;
  const context = vm.createContext({
    EXTENSION_VERSION: "test", currentWatchVideoId: () => "j3p21rZpe5I",
    copyTranscript: () => {},
    document: {
      querySelector(selector) {
        if (selector === "ytd-watch-metadata #actions-inner") return inner;
        if (selector === "ytd-watch-metadata #actions") return outer;
        if (selector === ".staytube-copy-transcript") return buttons[0] ?? null;
        return null;
      },
      querySelectorAll: () => buttons,
      createElement() {
        const button = {
          dataset: {}, listeners: [], setAttribute() {},
          addEventListener(event, callback) { this.listeners.push({ event, callback }); }
        };
        buttons.push(button);
        return button;
      }
    }
  });
  vm.runInContext(placementSource + source.slice(
    source.indexOf("  function syncTranscriptButtonStyle("),
    source.indexOf("  function scanRoot(")
  ), context);
  context.ensureTranscriptButton();
  const button = buttons[0];
  assert.equal(button.parentElement, outer);
  button.disabled = true;
  inner = makeHost();
  context.ensureTranscriptButton();
  context.ensureTranscriptButton();
  assert.equal(buttons.length, 1);
  assert.equal(button.parentElement, inner);
  assert.equal(button.disabled, true);
  assert.equal(button.listeners.length, 1);
});

test("native button styling hydrates once without copying action state or duplicating light layers", () => {
  const decorations = new Map();
  let copies = 0;
  const makeDecoration = (tag) => ({
    cloneNode() {
      copies += 1;
      return { tag, attributes: { id: "native-id" }, style: { setProperty() {} },
        removeAttribute(name) { delete this.attributes[name]; },
        setAttribute(name, value) { this.attributes[name] = value; },
        querySelectorAll: () => [] };
    }
  });
  const nativeClasses = new Set([
    "ytSpecButtonShapeNextHost", "ytSpecButtonShapeNextTonal", "ytSpecButtonShapeNextMono",
    "ytSpecButtonShapeNextSizeM", "ytSpecButtonShapeNextIconButton",
    "ytSpecButtonShapeNextEnableBackdropFilterExperiment", "ytSpecButtonShapeNextMainstagePadding"
  ]);
  nativeClasses.contains = nativeClasses.has.bind(nativeClasses);
  const native = { className: [...nativeClasses].join(" "), classList: nativeClasses,
    querySelector: (selector) => makeDecoration(selector.replace(":scope > ", "")) };
  const button = { className: "staytube-copy-transcript", disabled: true, textContent: "Copying…",
    querySelector: (selector) => decorations.get(selector.replace(":scope > ", "")),
    append: (copy) => decorations.set(copy.tag, copy) };
  let ready = false;
  const host = { querySelectorAll: () => ready ? [native] : [] };
  const context = vm.createContext({});
  vm.runInContext(source.slice(source.indexOf("  function syncTranscriptButtonStyle("),
    source.indexOf("  function ensureTranscriptButton()")), context);
  context.syncTranscriptButtonStyle(button, host);
  assert.equal(button.className, "staytube-copy-transcript");
  ready = true;
  context.syncTranscriptButtonStyle(button, host);
  context.syncTranscriptButtonStyle(button, host);
  assert.match(button.className, /staytube-native-button/);
  assert.match(button.className, /ytSpecButtonShapeNextIconLeading/);
  assert.doesNotMatch(button.className, /IconButton/);
  assert.equal(copies, 2);
  assert.equal(decorations.get("yt-light-shape").attributes.id, undefined);
  assert.equal(decorations.get("yt-light-shape").attributes["aria-hidden"], "true");
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, "Copying…");
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

const Core = require("../src/core.js");
const copySource = source.slice(source.indexOf("  async function copyTranscript("),
  source.indexOf("  async function fetchCaptionSegments("));

for (const outcome of ["captions", "caption failure", "native panel", "metadata failure"]) {
  test(`navigation during ${outcome} never copies or opens a transcript for the wrong video`, async () => {
    let videoId = "j3p21rZpe5I";
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const writes = [];
    let nativeCalls = 0;
    const label = { textContent: "Copy transcript" };
    const button = { disabled: false, isConnected: true, querySelector: () => label };
    const context = vm.createContext({
      Core, URL, AbortSignal, EXTENSION_VERSION: "test",
      transcriptButtonResetTimer: null, clearTimeout() {}, setTimeout() {},
      currentWatchVideoId: () => videoId,
      location: { origin: "https://www.youtube.com" },
      document: { scripts: outcome === "metadata failure" ? [] : [{
        textContent: `ytInitialPlayerResponse = ${JSON.stringify({
          videoDetails: { videoId },
          captions: { playerCaptionsTracklistRenderer: { captionTracks: [{
            baseUrl: "https://www.youtube.com/api/timedtext"
          }] } }
        })}`
      }] },
      fetch: async () => { await pending; throw new Error("Request failed"); },
      fetchCaptionSegments: async () => {
        if (outcome === "native panel") throw new Error("No timed text");
        await pending;
        if (outcome === "caption failure") throw new Error("No timed text");
        return [{ startMs: 0, text: "Old video transcript." }];
      },
      transcriptSegmentsFromNativePanel: async () => {
        nativeCalls += 1;
        await pending;
        return [{ startMs: 0, text: "New video transcript." }];
      },
      writeClipboardText: async text => writes.push(text),
      console: { error() {} }
    });
    vm.runInContext(copySource, context);
    const copying = context.copyTranscript(button);
    await new Promise(resolve => setImmediate(resolve));
    videoId = "dQw4w9WgXcQ";
    release();
    await copying;
    assert.deepEqual(writes, []);
    assert.equal(nativeCalls, outcome === "native panel" ? 1 : 0);
    assert.equal(button.disabled, false);
    assert.equal(label.textContent, "Copy transcript");
  });
}

test("native transcript polling never stamps a new video's panel with the old video ID", () => {
  let queried = false;
  const context = vm.createContext({
    currentWatchVideoId: () => "dQw4w9WgXcQ",
    nativeTranscriptPanels: () => { queried = true; return []; }
  });
  vm.runInContext(source.slice(source.indexOf("  function readCurrentNativeTranscript("),
    source.indexOf("  function waitForNativeTranscript(")), context);
  assert.equal(context.readCurrentNativeTranscript("j3p21rZpe5I").length, 0);
  assert.equal(queried, false);
});
