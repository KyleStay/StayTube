"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../src/watch-layout.js"), "utf8");

// This is YouTube's public bootstrap shape, including its global var assignment
// and both supported set() signatures. Exercise it after document_start.
const bootstrap = `var ytcfg = {
  d() { return window.yt && yt.config_ || ytcfg.data_ || (ytcfg.data_ = {}); },
  get(k, fallback) { return k in ytcfg.d() ? ytcfg.d()[k] : fallback; },
  set() {
    if (arguments.length > 1) ytcfg.d()[arguments[0]] = arguments[1];
    else for (const k in arguments[0]) ytcfg.d()[k] = arguments[0][k];
    return 'native result';
  }
};`;

function layoutContext() {
  let page = null;
  const events = new Map();
  const observations = [];
  let notify;
  const context = vm.createContext({
    document: {
      querySelector: () => page,
      addEventListener: (name, callback) => events.set(name, callback)
    },
    MutationObserver: class {
      constructor(callback) { notify = callback; }
      disconnect() { observations.length = 0; }
      observe(target, options) { observations.push({ target, options }); }
    }
  });
  context.window = context;
  return { context, events, observations, setPage(value) { page = value; }, notify: () => notify() };
}

test("document-start hook preserves bootstrap and selects the native classic layout", () => {
  const { context } = layoutContext();
  vm.runInContext(source, context);
  assert.equal(context.ytcfg, undefined);
  vm.runInContext(bootstrap, context);
  const result = vm.runInContext(`ytcfg.set({
    EXPERIMENT_FLAGS: {kevlar_watch_grid: true, web_side_rail_dismissible_panels: true, unrelated: true},
    CLIENT_NAME: 'WEB'
  })`, context);
  const flags = context.ytcfg.get("EXPERIMENT_FLAGS");
  assert.equal(result, "native result");
  assert.equal(context.ytcfg.get("CLIENT_NAME"), "WEB");
  assert.equal(flags.unrelated, true);
  assert.equal(flags.kevlar_watch_fixie, false);
  assert.equal(flags.kevlar_watch_grid, false);
  assert.equal(flags.web_watch_eligible_to_switch_to_grid, false);
  assert.equal(flags.web_watch_enable_single_column_grid_view, false);
  assert.equal(flags.enable_web_side_rail, false);
  assert.equal(flags.web_side_rail_dismissible_panels, false);
  assert.equal(flags.web_watch_fixed_default_panels, false);
  assert.equal(flags.web_watch_provide_undefined_comments, false);
});

test("navigation config and forced experiments cannot re-enable the side layout", () => {
  const { context } = layoutContext();
  vm.runInContext(source, context);
  vm.runInContext(bootstrap, context);
  vm.runInContext(`ytcfg.set('EXPERIMENT_FLAGS', {kevlar_watch_grid: true});
    ytcfg.set('EXPERIMENTS_FORCED_FLAGS', {enable_web_side_rail: true});`, context);
  assert.equal(context.ytcfg.get("EXPERIMENT_FLAGS").kevlar_watch_grid, false);
  assert.equal(context.ytcfg.get("EXPERIMENTS_FORCED_FLAGS").enable_web_side_rail, false);
  vm.runInContext(bootstrap, context);
  vm.runInContext(`ytcfg.set({EXPERIMENT_FLAGS: {kevlar_watch_grid: true}})`, context);
  assert.equal(context.ytcfg.get("EXPERIMENT_FLAGS").kevlar_watch_grid, false);
});

test("existing and nonconfigurable config objects keep native method semantics", () => {
  const { context } = layoutContext();
  vm.runInContext(bootstrap, context);
  vm.runInContext(`yt = {config_: {EXPERIMENT_FLAGS: {kevlar_watch_grid: true}}};
    Object.defineProperty(window, 'ytcfg', {value: ytcfg, configurable: false, writable: true});`, context);
  vm.runInContext(source, context);
  assert.equal(context.yt.config_.EXPERIMENT_FLAGS.kevlar_watch_grid, false);
  assert.equal(context.ytcfg.set("client", "WEB"), "native result");
  assert.equal(context.yt.config_.client, "WEB");
});

test("theater remains available when the rollout disables it, including on navigation", () => {
  const harness = layoutContext();
  vm.runInContext(source, harness.context);
  vm.runInContext(bootstrap, harness.context);
  const page = { theater: false };
  harness.setPage(page);
  for (const key of ["EXPERIMENT_FLAGS", "EXPERIMENTS_FORCED_FLAGS"]) {
    harness.context.ytcfg.set(key, {
      disable_theater_mode: true,
      web_watch_hide_theater_mode_button_in_single_column: true,
      web_watch_force_start_in_theater_mode: false
    });
    const flags = harness.context.ytcfg.get(key);
    assert.equal(flags.disable_theater_mode, false);
    assert.equal(flags.web_watch_hide_theater_mode_button_in_single_column, false);
    assert.equal(flags.web_watch_force_start_in_theater_mode, false);
  }
  harness.events.get("yt-navigate-finish")();
  assert.equal(page.theater, false, "restoration must preserve the user's selected size");
  page.theater = true;
  harness.events.get("yt-page-data-updated")();
  harness.notify();
  assert.equal(page.theater, true, "rescans must not turn theater mode off");
});

test("server-supplied side menus reset through native properties on hydration and navigation", () => {
  const harness = layoutContext();
  vm.runInContext(source, harness.context);
  const page = { sideRailDismissiblePanels: true, fixedDefaultPanels: true, fixedSideMenu: {} };
  harness.setPage(page);
  harness.events.get("DOMContentLoaded")();
  assert.equal(page.sideRailDismissiblePanels, false);
  assert.equal(page.fixedDefaultPanels, false);
  assert.equal(page.fixedSideMenu, null);
  assert.equal(harness.observations.length, 1);
  assert.equal(harness.observations[0].target, page);
  page.fixedSideMenu = {};
  harness.notify();
  assert.equal(page.fixedSideMenu, null);
  const nextPage = { sideRailDismissiblePanels: true, fixedSideMenu: {} };
  harness.setPage(nextPage);
  harness.events.get("yt-navigate-finish")();
  harness.events.get("yt-page-data-updated")();
  assert.equal(nextPage.fixedSideMenu, null);
  assert.equal(harness.observations.length, 1);
  assert.equal(harness.observations[0].target, nextPage);
  harness.setPage(null);
  harness.events.get("yt-navigate-finish")();
  assert.equal(harness.observations.length, 0);
});

test("layout script runs early on desktop while feature scripts retain their isolated world", () => {
  const manifest = require("../manifest.json");
  const layout = manifest.content_scripts.find(entry => entry.js.includes("src/watch-layout.js"));
  assert.equal(layout.run_at, "document_start");
  assert.equal(layout.world, "MAIN");
  assert.deepEqual(layout.matches, ["https://www.youtube.com/*"]);
  const features = manifest.content_scripts.find(entry => entry.js.includes("src/content.js"));
  assert.equal(features.world ?? "ISOLATED", "ISOLATED");
  assert.deepEqual(manifest.permissions, ["clipboardWrite"]);
});
