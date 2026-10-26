(function restoreClassicWatchLayout() {
  "use strict";

  // Run in MAIN at document_start, before YouTube reads its experiment flags.
  // Let YouTube build its own classic watch page: moving comment/description
  // nodes afterwards breaks their panel ownership and lazy-loading behavior.
  const layoutFlags = [
    "kevlar_watch_fixie",
    "kevlar_watch_grid",
    "web_watch_eligible_to_switch_to_grid",
    "web_watch_enable_single_column_grid_view",
    "enable_web_side_rail",
    "web_side_rail_dismissible_panels",
    "web_watch_fixed_default_panels",
    "web_watch_provide_undefined_comments",
    // The side-rail rollout can disable the native size button and T shortcut
    // even after the classic watch page is restored.
    "disable_theater_mode",
    "web_watch_hide_theater_mode_button_in_single_column"
  ];
  const wrappedConfigs = new WeakSet();

  function restoreFlags(flags) {
    if (!flags || typeof flags !== "object") return;
    for (const flag of layoutFlags) flags[flag] = false;
  }

  function restoreConfig(config) {
    if (!config || typeof config !== "object") return;
    restoreFlags(config.EXPERIMENT_FLAGS);
    restoreFlags(config.EXPERIMENTS_FORCED_FLAGS);
  }

  function prepareConfig(config) {
    if (!config || typeof config !== "object") return config;
    restoreConfig(config.data_);
    restoreConfig(globalThis.yt?.config_);
    if (typeof config.set !== "function" || wrappedConfigs.has(config)) return config;

    const originalSet = config.set;
    config.set = function (...args) {
      if (args.length > 1) {
        if (args[0] === "EXPERIMENT_FLAGS" || args[0] === "EXPERIMENTS_FORCED_FLAGS") {
          restoreFlags(args[1]);
        }
      } else {
        restoreConfig(args[0]);
      }
      return Reflect.apply(originalSet, this, args);
    };
    wrappedConfigs.add(config);
    return config;
  }

  // YouTube assigns `var ytcfg = {...}` in its first inline script, then calls
  // set() for bootstrap and subsequent navigation config. Intercept assignment
  // without creating a truthy placeholder that could suppress initialization.
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "ytcfg");
  if (descriptor && !descriptor.configurable) {
    prepareConfig(globalThis.ytcfg);
  } else {
    let currentConfig = prepareConfig(globalThis.ytcfg);
    Object.defineProperty(globalThis, "ytcfg", {
      configurable: true,
      enumerable: true,
      get: () => currentConfig,
      set: (value) => { currentConfig = prepareConfig(value); }
    });
  }

  // Some responses supply a side menu even with the experiment disabled.
  // Reset its native reactive properties so description expansion and comment
  // continuations retain their normal inline ownership after SPA navigation.
  let observedWatchPage;
  const observer = new MutationObserver(restoreWatchPage);
  function restoreWatchPage() {
    restoreConfig(globalThis.ytcfg?.data_);
    restoreConfig(globalThis.yt?.config_);
    const page = document.querySelector("ytd-watch-flexy");
    if (page !== observedWatchPage) {
      observer.disconnect();
      observedWatchPage = page;
      if (page) observer.observe(page, {
        attributes: true,
        attributeFilter: ["side-rail-dismissible-panels", "fixed-default-panels", "show-fixed-side-menu"]
      });
    }
    if (!page) return;
    if (page.sideRailDismissiblePanels) page.sideRailDismissiblePanels = false;
    if (page.fixedDefaultPanels) page.fixedDefaultPanels = false;
    if (page.fixedSideMenu) page.fixedSideMenu = null;
  }
  document.addEventListener("DOMContentLoaded", restoreWatchPage, { once: true });
  document.addEventListener("yt-navigate-finish", restoreWatchPage);
  document.addEventListener("yt-page-data-updated", restoreWatchPage);
  restoreWatchPage();
})();
