(function runStayTube() {
  "use strict";

  const Core = globalThis.StayTubeCore;
  if (!Core || globalThis.__stayTubeListingDetailsLoaded) return;
  globalThis.__stayTubeListingDetailsLoaded = true;
  const EXTENSION_VERSION = globalThis.chrome?.runtime?.getManifest?.().version ?? "development";

  const CARD_SELECTORS = [
    "ytd-rich-item-renderer",
    "ytd-rich-grid-media",
    "ytd-video-renderer",
    "ytd-grid-video-renderer",
    "ytd-compact-video-renderer",
    "ytd-playlist-video-renderer",
    "ytd-playlist-panel-video-renderer",
    "ytd-reel-item-renderer",
    "ytd-reel-video-renderer",
    "ytd-backstage-video-renderer",
    "ytd-structured-description-video-lockup-renderer",
    "yt-lockup-view-model",
    "ytm-video-with-context-renderer",
    "ytm-compact-video-renderer",
    "ytm-shorts-lockup-view-model"
  ].join(",");

  const VIDEO_LINK_SELECTOR = [
    'a[href*="/watch?"]',
    'a[href*="/watch&"]',
    'a[href^="/shorts/"]',
    'a[href*="youtube.com/shorts/"]',
    'a[href^="/live/"]',
    'a[href*="youtube.com/live/"]'
  ].join(",");

  const WATCH_DATE_SELECTOR = [
    "ytd-watch-metadata #description-inline-expander #info span",
    "ytd-watch-metadata #description #info span",
    "ytd-watch-info-text #info span",
    "ytm-slim-video-metadata-section-renderer #description #info span"
  ].join(",");

  const WATCH_DATE_FALLBACK_SELECTOR = [
    "ytd-watch-metadata #description-inline-expander #info",
    "ytd-watch-metadata #description #info",
    "ytd-watch-info-text #info",
    "ytm-slim-video-metadata-section-renderer #description #info"
  ].join(",");

  const NATIVE_TRANSCRIPT_BUTTON_SELECTOR = [
    'ytd-video-description-transcript-section-renderer button[aria-label="Show transcript"]',
    "ytd-video-description-transcript-section-renderer button",
    'ytd-watch-metadata button[aria-label="Show transcript"]',
    'button[aria-label="Transcript"]'
  ].join(",");

  /* Rows outside [min, max] watch progress collapse; 0-100 shows everything.
     Unwatched rows sit at 0 and fully watched rows at 100, so the two slider
     ends govern them without needing separate toggles. */
  const playlistProgressGate = { min: 0, max: 100 };
  /* When set, only unavailable (deleted/private) rows stay visible and the
     progress gate is suspended so the two filters can never conflict. */
  let playlistUnavailableOnly = false;

  const metadataCache = new Map();
  const pendingTasks = [];
  const observedCards = new WeakSet();
  const MAX_CONCURRENT_REQUESTS = 4;
  let activeRequests = 0;
  let scanScheduled = false;
  const pendingScanRoots = new Set();
  const editablePlaylistIds = new Set();
  const observedPlaylistContainers = new WeakSet();
  const pendingCollapseCards = new Set();
  let collapseUpdateScheduled = false;
  let collapseFilterScheduled = false;
  let collapseFilterPreferCached = true;
  let playlistReconciliationPending = false;
  let cachedPlaylistIdSearch;
  let cachedPlaylistId = null;
  let transcriptButtonResetTimer;

  const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
  const dateOnlyFormatter = new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
  const timeOnlyFormatter = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  });
  const monthNameFormatter = new Intl.DateTimeFormat(undefined, {
    month: "short"
  });
  const yearAgeMonthFormatter = new Intl.DateTimeFormat("en-US", {
    month: "short"
  });
  const yearAgeTimeFormatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });

  function formatMonthDayTime(date) {
    return `${monthNameFormatter.format(date)} ${date.getDate()} ${timeOnlyFormatter.format(date)}`;
  }

  function formatYearAgeDateTime(date) {
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()} ${yearAgeMonthFormatter.format(date)} ${day} ${yearAgeTimeFormatter.format(date)}`;
  }

  function withoutCommas(value) {
    return value.replaceAll(",", "");
  }

  const visibilityObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      visibilityObserver.unobserve(entry.target);
      enrichCard(entry.target);
    }
  }, { rootMargin: "800px 0px" });

  function enqueue(task) {
    return new Promise((resolve, reject) => {
      pendingTasks.push({ task, resolve, reject });
      drainQueue();
    });
  }

  function drainQueue() {
    while (activeRequests < MAX_CONCURRENT_REQUESTS && pendingTasks.length > 0) {
      const item = pendingTasks.shift();
      activeRequests += 1;
      Promise.resolve()
        .then(item.task)
        .then(item.resolve, item.reject)
        .finally(() => {
          activeRequests -= 1;
          drainQueue();
        });
    }
  }

  function metadataFor(videoId) {
    if (!metadataCache.has(videoId)) {
      metadataCache.set(videoId, enqueue(() => fetchMetadata(videoId)));
    }
    return metadataCache.get(videoId);
  }

  async function fetchMetadata(videoId) {
    const watchUrl = new URL("/watch", location.origin);
    watchUrl.searchParams.set("v", videoId);
    watchUrl.searchParams.set("hl", "en");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(watchUrl, {
        credentials: "same-origin",
        cache: "force-cache",
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`YouTube returned ${response.status}`);

      const metadata = Core.parseWatchHtml(await response.text(), videoId);
      if (!metadata) throw new Error("YouTube metadata was not present");
      return metadata;
    } finally {
      clearTimeout(timeout);
    }
  }

  function findExistingChannel(card) {
    const links = card.querySelectorAll([
      "#channel-name a[href]",
      "ytd-channel-name a[href]",
      'a[href*="/channel/"]',
      'a[href*="/@"]',
      'a[href*="/user/"]',
      'a[href*="/c/"]'
    ].join(","));

    for (const link of links) {
      const name = link.getAttribute("title")?.trim() || link.textContent?.trim();
      if (name) return { author: name, channelUrl: link.href, element: link };
    }

    // History's modern horizontal lockups render the channel name as text and
    // make the adjacent avatar the navigation control. Treat that visible name
    // as native so the fallback details row does not repeat it.
    const lockupChannel = card.querySelector(
      ".ytLockupMetadataViewModelMetadata .ytContentMetadataViewModelMetadataRow > .ytContentMetadataViewModelMetadataText:first-child"
    );
    const lockupChannelName = lockupChannel?.textContent?.trim();
    if (lockupChannelName) {
      const channelNavigation = [...links].find((link) => link.href);
      return {
        author: lockupChannelName,
        channelUrl: channelNavigation?.href ?? null,
        element: lockupChannel
      };
    }
    return null;
  }

  function findMetadataHost(card) {
    // Appending to yt-lockup-metadata-view-model itself makes StayTube a sibling
    // of the text and menu columns. On History that pushes the date beside or
    // beyond the action menu instead of keeping it with the video's metadata.
    const lockupText = card.querySelector(".ytLockupMetadataViewModelTextContainer");
    if (lockupText) return lockupText;

    const target = card.querySelector([
      "#metadata",
      "#meta",
      "#details",
      ".yt-lockup-metadata-view-model__text-container",
      ".yt-lockup-metadata-view-model__metadata",
      ".shortsLockupViewModelHostMetadataContainer"
    ].join(","));
    if (target) return target;

    const title = card.querySelector("#video-title, #video-title-link, h3, [class*='title']");
    return title?.parentElement ?? card;
  }

  function makeChannelLink(metadata, fallback) {
    const author = metadata?.author ?? fallback?.author;
    const href = metadata?.channelUrl ?? fallback?.channelUrl;
    if (!author || !href) return null;

    let channelUrl;
    try {
      channelUrl = new URL(href, location.origin);
      if (channelUrl.protocol === "http:") channelUrl.protocol = "https:";
      if (channelUrl.protocol !== "https:") return null;
    } catch {
      return null;
    }

    const link = document.createElement("a");
    link.className = "staytube-channel";
    link.textContent = author;
    link.href = channelUrl.href;
    link.title = `Open ${author}'s channel`;
    return link;
  }

  function ensureExistingChannelLink(fallback, metadata) {
    const element = fallback?.element;
    if (!element) return false;
    if (element.matches("a[href]")) return true;

    const existingLink = element.querySelector(":scope > a[href]");
    if (existingLink) return true;

    const link = makeChannelLink(metadata, fallback);
    if (!link) return false;
    link.classList.add("staytube-native-channel");
    element.replaceChildren(link);
    return true;
  }

  function makePublishedTime(value, display = null) {
    if (!value) return null;

    const time = document.createElement("time");
    time.className = "staytube-published";
    time.dateTime = value;

    if (Core.isExactTimestamp(value)) {
      const date = new Date(value);
      const unit = display?.unit;
      const mode = Core.publicationDisplayMode(unit);
      if (mode === "time") {
        time.textContent = timeOnlyFormatter.format(date);
      } else if (mode === "relative-time") {
        time.textContent = `${display.relativeText}\u00a0${timeOnlyFormatter.format(date)}`;
      } else if (mode === "relative-date-time") {
        time.textContent = `${display.relativeText}\u00a0${formatMonthDayTime(date)}`;
      } else if (mode === "year-date-time") {
        const relativeAge = Core.compactYearAge(display.relativeText) || display.relativeText;
        time.textContent = `${relativeAge}\u00a0${formatYearAgeDateTime(date)}`;
      } else {
        time.textContent = withoutCommas(dateTimeFormatter.format(date));
      }
      time.title = `Published ${date.toLocaleString()} (source: ${value})`;
    } else {
      const date = new Date(`${value}T00:00:00`);
      const formatted = Number.isNaN(date.getTime()) ? value : withoutCommas(dateOnlyFormatter.format(date));
      time.textContent = `${formatted}\u00a0exact time unavailable`;
      time.title = "YouTube supplied a date but no exact upload time";
    }

    return time;
  }

  function findNativeDateHost(card) {
    const existing = card.querySelector(":scope .staytube-native-date-host");
    if (existing) return existing;

    const candidates = [...card.querySelectorAll(
      Core.NATIVE_DATE_CANDIDATE_SELECTORS.join(",")
    )].filter((element) => !element.closest(".staytube-listing-details"));

    const relativeDate = candidates.find((element) => Core.looksLikePublishedAge(
      element.getAttribute("aria-label") || element.textContent
    ));
    if (relativeDate) return relativeDate;

    // The classic renderer consistently puts age after views. This also works
    // when YouTube localizes the relative-date text to a non-English language.
    const classicItems = [...card.querySelectorAll(
      Core.CLASSIC_DATE_FALLBACK_SELECTORS.join(",")
    )];
    return classicItems.length >= 2 ? classicItems[classicItems.length - 1] : null;
  }

  function replaceNativeDate(card, value) {
    if (!value) return false;
    const host = findNativeDateHost(card);
    if (!host) return false;

    const ageLabel = host.getAttribute("aria-label") || host.textContent?.trim() || "";
    const relativeText = host.dataset.staytubeRelativeText || host.textContent?.trim() || ageLabel;
    host.dataset.staytubeRelativeText = relativeText;
    const time = makePublishedTime(value, {
      unit: Core.relativeAgeUnit(relativeText),
      relativeText
    });
    if (!time) return false;
    time.classList.add("staytube-native-published");
    host.replaceChildren(time);
    host.classList.add("staytube-native-date-host");
    return true;
  }

  function render(card, videoId, metadata, error = null) {
    if (card.dataset.staytubeVideoId !== videoId) return;

    const fallback = findExistingChannel(card);
    const container = card.querySelector(":scope .staytube-listing-details");
    if (!container) return;
    container.replaceChildren();
    container.classList.remove("staytube-loading", "staytube-error");

    const channelIsNative = ensureExistingChannelLink(fallback, metadata);
    const publishedIsNative = replaceNativeDate(card, metadata?.publishedAt);
    const channel = channelIsNative ? null : makeChannelLink(metadata, fallback);
    const published = publishedIsNative ? null : makePublishedTime(metadata?.publishedAt);

    if (channel) container.append(channel);
    if (channel && published) {
      published.classList.add("staytube-published-after-channel");
    }
    if (published) container.append(published);

    const channelAvailable = channelIsNative || Boolean(channel);
    const publishedAvailable = publishedIsNative || Boolean(published);
    if (!channelAvailable || !publishedAvailable) {
      const unavailable = document.createElement("span");
      unavailable.className = "staytube-unavailable";
      unavailable.textContent = [
        !channelAvailable ? "Channel unavailable" : null,
        !publishedAvailable ? "Upload time unavailable" : null
      ].filter(Boolean).join("\u00a0");
      if (error) unavailable.title = `Could not load listing details: ${error.message}`;
      container.append(unavailable);
      container.classList.add("staytube-error");
    }
  }

  async function enrichCard(card) {
    const videoId = card.dataset.staytubeVideoId;
    if (!videoId) return;

    try {
      render(card, videoId, await metadataFor(videoId));
    } catch (error) {
      render(card, videoId, null, error);
      metadataCache.delete(videoId);
    }
  }

  function findRemovePlaylistCommand() {
    const items = document.querySelectorAll([
      "ytd-menu-service-item-renderer",
      "tp-yt-paper-item",
      "yt-list-item-view-model"
    ].join(","));
    return [...items].find((item) => (
      item.getClientRects().length > 0
      && Core.isRemoveFromPlaylistLabel(item.getAttribute("aria-label") || item.textContent)
    ));
  }

  function runRemovePlaylistCommand(card, button) {
    const menuButton = card.querySelector(":scope #menu ytd-menu-renderer .dropdown-trigger button");
    if (!menuButton || button.disabled) return;

    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    document.documentElement.classList.add("staytube-finding-remove-command");

    let settled = false;
    let attempts = 0;
    let pollTimer;
    const finish = (command = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(pollTimer);
      document.documentElement.classList.remove("staytube-finding-remove-command");
      button.disabled = false;
      button.removeAttribute("aria-busy");
      if (command) {
        command.click();
      } else {
        menuButton.click();
      }
      schedulePlaylistActionReconciliation();
    };
    const pollForCommand = () => {
      const command = findRemovePlaylistCommand();
      if (command) {
        finish(command);
        return;
      }
      attempts += 1;
      if (attempts >= 30) {
        finish();
        return;
      }
      pollTimer = setTimeout(pollForCommand, 50);
    };

    menuButton.click();
    // YouTube reuses its popup container between rows. Waiting one frame avoids
    // selecting the previous row's still-visible command during that handoff.
    pollTimer = setTimeout(pollForCommand, 50);
  }

  function currentPlaylistId() {
    if (cachedPlaylistIdSearch !== location.search) {
      cachedPlaylistIdSearch = location.search;
      cachedPlaylistId = new URLSearchParams(location.search).get("list");
    }
    return cachedPlaylistId;
  }

  function playlistRowIsEditable(card) {
    const playlistId = currentPlaylistId();
    if (playlistId === "WL" || editablePlaylistIds.has(playlistId)) return true;

    if (card.querySelector(":scope .playlist-drag-handle, :scope #reorder, :scope [class*='drag-handle']")) {
      if (playlistId) editablePlaylistIds.add(playlistId);
      return true;
    }

    const list = card.closest("ytd-playlist-video-list-renderer");
    const listData = list?.data ?? list?.__data?.data;
    if (listData?.isEditable === true) {
      if (playlistId) editablePlaylistIds.add(playlistId);
      return true;
    }

    const rowData = card.data ?? card.__data?.data;
    const menuItems = rowData?.menu?.menuRenderer?.items ?? [];
    const hasRemoveCommand = menuItems.some((item) => {
      const renderer = item.menuServiceItemRenderer ?? item.menuServiceItemDownloadRenderer;
      const label = renderer?.text?.simpleText
        ?? renderer?.text?.runs?.map((run) => run.text).join("")
        ?? renderer?.accessibility?.accessibilityData?.label;
      return Core.isRemoveFromPlaylistLabel(label);
    });
    if (hasRemoveCommand && playlistId) editablePlaylistIds.add(playlistId);
    return hasRemoveCommand;
  }

  function ensurePlaylistRemoveButton(card) {
    if (!card.matches("ytd-playlist-video-renderer")) return;
    if (!playlistRowIsEditable(card)) return;
    const menu = card.querySelector(":scope > #menu, :scope #menu");
    if (!menu) return;

    const title = card.querySelector(":scope #video-title")?.textContent?.trim();
    let button = menu.querySelector(":scope > .staytube-playlist-remove");
    if (!button) {
      button = document.createElement("button");
      button.className = "staytube-playlist-remove";
      button.type = "button";
      button.textContent = "×";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        runRemovePlaylistCommand(card, button);
      });
      /* Keep a deterministic [open-clean, remove] order no matter which of the
         pair YouTube's re-renders destroy and we recreate first. */
      const cleanLink = menu.querySelector(":scope > .staytube-playlist-open-clean");
      if (cleanLink) {
        cleanLink.after(button);
      } else {
        menu.prepend(button);
      }
    }
    button.setAttribute("aria-label", title ? `Remove ${title} from playlist` : "Remove video from playlist");
    button.title = "Remove from playlist";
  }

  function ensurePlaylistCleanLink(card) {
    if (!card.matches("ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer")) return;

    let link = card.querySelector(":scope > #menu > .staytube-playlist-open-clean");
    const videoLink = card.querySelector(VIDEO_LINK_SELECTOR);
    const cleanUrl = Core.cleanVideoUrl(videoLink?.href, location.origin);
    const menu = card.querySelector(":scope > #menu");
    if (!cleanUrl || !menu) {
      link?.remove();
      return;
    }

    const title = card.querySelector(":scope #video-title, :scope #video-title-link")
      ?.textContent?.trim();
    link = menu.querySelector(":scope > .staytube-playlist-open-clean");
    if (!link) {
      link = document.createElement("a");
      link.className = "staytube-playlist-open-clean";
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "↗";
      link.addEventListener("click", (event) => event.stopPropagation());
      menu.prepend(link);
    }

    /* Self-heal a flipped pair; only move the link when actually misordered so
       the reorder cannot retrigger the mutation observer every pass. */
    const removeButton = menu.querySelector(":scope > .staytube-playlist-remove");
    if (removeButton && (link.compareDocumentPosition(removeButton) & Node.DOCUMENT_POSITION_PRECEDING)) {
      removeButton.before(link);
    }

    link.href = cleanUrl;
    link.setAttribute(
      "aria-label",
      title ? `Open ${title} without playlist in a new tab` : "Open video without playlist in a new tab"
    );
    link.title = "Open video without playlist in a new tab";
  }

  function reconcilePlaylistRowActions() {
    document.querySelectorAll(
      "ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer"
    ).forEach((card) => {
      ensurePlaylistRemoveButton(card);
      ensurePlaylistCleanLink(card);
    });
  }

  function schedulePlaylistActionReconciliation() {
    if (playlistReconciliationPending) return;
    playlistReconciliationPending = true;
    const delays = [0, 100, 300, 750];
    delays.forEach((delay, index) => setTimeout(() => {
      if (index === delays.length - 1) playlistReconciliationPending = false;
      reconcilePlaylistRowActions();
    }, delay));
  }

  function clampWatchProgress(value) {
    return Math.max(0, Math.min(100, value));
  }

  /* Returns a 0-100 progress value, or null when the row offers no evidence yet
     (e.g. still hydrating) so callers can avoid misclassifying it. */
  function playlistWatchProgress(card) {
    const rowData = card.data ?? card.__data?.data;
    const overlays = rowData?.thumbnailOverlays;
    if (Array.isArray(overlays)) {
      const progress = clampWatchProgress(Core.watchProgressFromOverlays(overlays));
      return progress;
    }

    const progressIndicators = card.querySelectorAll([
      "ytd-thumbnail-overlay-resume-playback-renderer #progress",
      "yt-thumbnail-overlay-progress-bar-view-model #progress",
      "yt-thumbnail-overlay-progress-bar-view-model [role='progressbar']",
      "yt-thumbnail-overlay-progress-bar-view-model [class*='WatchedProgressBarSegment']"
    ].join(","));

    for (const indicator of progressIndicators) {
      const candidates = [
        indicator.getAttribute("aria-valuenow"),
        indicator.getAttribute("aria-label"),
        indicator.getAttribute("title"),
        indicator.getAttribute("style"),
        indicator.textContent
      ];
      for (const candidate of candidates) {
        const progress = Core.parseWatchProgress(candidate);
        if (progress !== null) {
          return clampWatchProgress(progress);
        }
      }

      /* Rect measurement forces layout, so it stays the last resort. Hidden
         rows measure 0 wide and fail the trackWidth guard into the null path. */
      const trackWidth = indicator.parentElement?.getBoundingClientRect?.().width;
      const progressWidth = indicator.getBoundingClientRect?.().width;
      if (trackWidth > 0 && progressWidth >= 0) {
        return clampWatchProgress((progressWidth / trackWidth) * 100);
      }
    }

    const statusIndicators = card.querySelectorAll([
      "[aria-label*='watched' i]",
      "[title*='watched' i]",
      "ytd-thumbnail-overlay-playback-status-renderer"
    ].join(","));
    for (const indicator of statusIndicators) {
      const candidates = [
        indicator.getAttribute("aria-valuenow"),
        indicator.getAttribute("aria-label"),
        indicator.getAttribute("title"),
        indicator.textContent
      ];
      for (const candidate of candidates) {
        const progress = Core.parseWatchProgress(candidate);
        if (progress !== null) {
          return clampWatchProgress(progress);
        }
      }
    }

    /* Absence of a DOM progress indicator is not proof of 0%: YouTube may hydrate
       the link well before an intersection-driven progress overlay. Keep such a
       row visible until explicit renderer or DOM evidence arrives. */
    if (progressIndicators.length) return null;
    return null;
  }

  function resolvePlaylistWatchProgress(card, preferCached = false) {
    const videoId = Core.extractVideoId(card.querySelector(VIDEO_LINK_SELECTOR)?.href, location.origin);
    const cached = Number.parseFloat(card.dataset.staytubeWatchProgress);
    const cachedVideoId = card.dataset.staytubeWatchProgressVideoId;
    const cacheIsCurrent = Boolean(videoId && cachedVideoId === videoId && Number.isFinite(cached));
    if (preferCached && cacheIsCurrent) return cached;
    const progress = playlistWatchProgress(card);
    if (progress !== null) return progress;
    return cacheIsCurrent ? cached : null;
  }

  function playlistRowIsUnavailable(card) {
    const title = card.querySelector(":scope #video-title")?.textContent;
    if (Core.isUnavailableListingTitle(title)) return true;
    const thumbnail = card.querySelector(":scope ytd-thumbnail img, :scope yt-image img");
    return Boolean(thumbnail?.src?.includes("no_thumbnail"));
  }

  /* Read/write separation: classification may measure layout and collapsing
     invalidates it, so resolve every row's progress before touching any class. */
  function updatePlaylistRowsCollapse(cards, preferCached = false) {
    const rows = [...cards].filter((card) => card.matches("ytd-playlist-video-renderer"));
    if (playlistUnavailableOnly) {
      const availability = rows.map(playlistRowIsUnavailable);
      rows.forEach((card, index) => {
        card.classList.toggle("staytube-playlist-collapsed", !availability[index]);
      });
      return;
    }
    const progresses = rows.map((card) => resolvePlaylistWatchProgress(card, preferCached));
    rows.forEach((card, index) => {
      const progress = progresses[index];
      if (progress !== null) {
        card.dataset.staytubeWatchProgress = String(progress);
        const videoId = Core.extractVideoId(
          card.querySelector(VIDEO_LINK_SELECTOR)?.href,
          location.origin
        );
        if (videoId) card.dataset.staytubeWatchProgressVideoId = videoId;
      }
      card.classList.toggle(
        "staytube-playlist-collapsed",
        progress !== null
          && (progress < playlistProgressGate.min || progress > playlistProgressGate.max)
      );
    });
  }

  const playlistProgressObserver = new MutationObserver((records) => {
    for (const record of records) {
      if (isStayTubeMutationTarget(record.target)) continue;
      const card = record.target.closest?.("ytd-playlist-video-renderer");
      if (card) pendingCollapseCards.add(card);
    }
    schedulePlaylistCollapseUpdate();
  });

  function schedulePlaylistCollapseUpdate() {
    if (collapseUpdateScheduled || !pendingCollapseCards.size) return;
    collapseUpdateScheduled = true;
    requestAnimationFrame(() => {
      collapseUpdateScheduled = false;
      const cards = [...pendingCollapseCards].filter((card) => card.isConnected);
      pendingCollapseCards.clear();
      updatePlaylistRowsCollapse(cards);
    });
  }

  function observePlaylistProgress(root) {
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
    const containers = [...root.querySelectorAll("ytd-playlist-video-list-renderer")];
    const enclosing = root.closest?.("ytd-playlist-video-list-renderer");
    if (enclosing) containers.push(enclosing);
    for (const container of containers) {
      if (observedPlaylistContainers.has(container)) continue;
      observedPlaylistContainers.add(container);
      playlistProgressObserver.observe(container, Core.PLAYLIST_PROGRESS_OBSERVER_OPTIONS);
    }
  }

  function updatePlaylistCollapseControls() {
    const controls = document.querySelector("body > .staytube-playlist-collapse-controls");
    if (!controls) return;
    const bounds = [
      { selector: ".staytube-playlist-collapse-min", value: playlistProgressGate.min },
      { selector: ".staytube-playlist-collapse-max", value: playlistProgressGate.max }
    ];
    for (const { selector, value } of bounds) {
      const slider = controls.querySelector(selector);
      if (!slider) continue;
      slider.value = String(value);
      slider.disabled = playlistUnavailableOnly;
      const readout = slider.closest("label")?.querySelector(".staytube-playlist-collapse-gate-value");
      if (readout) readout.textContent = `${value}%`;
    }
    controls.querySelector(".staytube-playlist-collapse-unavailable")
      ?.setAttribute("aria-pressed", String(playlistUnavailableOnly));
  }

  function applyPlaylistCollapseFilters(preferCached = true) {
    collapseFilterPreferCached &&= preferCached;
    if (collapseFilterScheduled) return;
    collapseFilterScheduled = true;
    requestAnimationFrame(() => {
      collapseFilterScheduled = false;
      const useCached = collapseFilterPreferCached;
      collapseFilterPreferCached = true;
      updatePlaylistRowsCollapse(
        document.querySelectorAll("ytd-playlist-video-renderer"),
        useCached
      );
      updatePlaylistCollapseControls();
    });
  }

  function ensurePlaylistCollapseControls() {
    const existing = document.querySelector("body > .staytube-playlist-collapse-controls");
    const isPlaylistPage = location.pathname === "/playlist" && Boolean(
      document.querySelector("ytd-playlist-video-list-renderer, ytd-playlist-video-renderer")
    );
    if (!isPlaylistPage) {
      existing?.remove();
      return;
    }
    if (existing) {
      updatePlaylistCollapseControls();
      return;
    }

    const controls = document.createElement("div");
    controls.className = "staytube-playlist-collapse-controls";
    controls.setAttribute("role", "group");
    controls.setAttribute("aria-label", "Show playlist videos by watch progress");

    const heading = document.createElement("span");
    heading.className = "staytube-playlist-collapse-heading";
    heading.textContent = "Show videos watched:";
    controls.append(heading);

    const createGateControl = (kind, prefix, ariaLabel, title) => {
      const wrapper = document.createElement("label");
      wrapper.className = "staytube-playlist-collapse-gate";
      wrapper.title = title;
      const text = document.createElement("span");
      text.textContent = prefix;
      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = "0";
      slider.max = "100";
      slider.step = "1";
      slider.className = `staytube-playlist-collapse-slider staytube-playlist-collapse-${kind}`;
      slider.setAttribute("aria-label", ariaLabel);
      const value = document.createElement("span");
      value.className = "staytube-playlist-collapse-gate-value";
      wrapper.append(text, slider, value);
      controls.append(wrapper);
      return slider;
    };

    const minSlider = createGateControl(
      "min",
      "at least",
      "Minimum percent watched to keep visible",
      "Raise to hide less-watched videos; 0% keeps unwatched videos visible"
    );
    const maxSlider = createGateControl(
      "max",
      "at most",
      "Maximum percent watched to keep visible",
      "Lower to hide more-watched videos; 100% keeps fully watched videos visible"
    );

    /* The bounds clamp each other so the gate can never invert: dragging one
       slider past the other pushes it along instead of undoing its setting. */
    minSlider.addEventListener("input", () => {
      playlistProgressGate.min = Number(minSlider.value);
      playlistProgressGate.max = Math.max(playlistProgressGate.max, playlistProgressGate.min);
      applyPlaylistCollapseFilters();
    });
    maxSlider.addEventListener("input", () => {
      playlistProgressGate.max = Number(maxSlider.value);
      playlistProgressGate.min = Math.min(playlistProgressGate.min, playlistProgressGate.max);
      applyPlaylistCollapseFilters();
    });

    const unavailable = document.createElement("button");
    unavailable.className = "staytube-playlist-collapse-unavailable";
    unavailable.type = "button";
    unavailable.textContent = "Unavailable only";
    unavailable.title = "Show only deleted or private videos; suspends the watch-progress gate";
    unavailable.addEventListener("click", () => {
      playlistUnavailableOnly = !playlistUnavailableOnly;
      applyPlaylistCollapseFilters(playlistUnavailableOnly);
    });
    controls.append(unavailable);

    const reset = document.createElement("button");
    reset.className = "staytube-playlist-collapse-reset";
    reset.type = "button";
    reset.textContent = "Show all";
    reset.title = "Reset the filters to show every video";
    reset.addEventListener("click", () => {
      playlistProgressGate.min = 0;
      playlistProgressGate.max = 100;
      playlistUnavailableOnly = false;
      applyPlaylistCollapseFilters();
    });
    controls.append(reset);

    document.body.append(controls);
    updatePlaylistCollapseControls();
  }

  function prepareCard(card, videoId) {
    ensurePlaylistRemoveButton(card);
    ensurePlaylistCleanLink(card);
    updatePlaylistRowsCollapse([card]);
    const existingContainer = card.querySelector(":scope .staytube-listing-details");
    if (card.dataset.staytubeVideoId === videoId && existingContainer) {
      const dateCanMoveToNativeSlot = Boolean(
        existingContainer.querySelector(":scope > .staytube-published") && findNativeDateHost(card)
      );
      const channelCanMoveToNativeSlot = Boolean(
        existingContainer.querySelector(":scope > .staytube-channel") && findExistingChannel(card)?.element
      );
      if (dateCanMoveToNativeSlot || channelCanMoveToNativeSlot) enrichCard(card);
      return;
    }

    card.querySelectorAll(":scope .staytube-listing-details").forEach((element) => element.remove());
    card.querySelectorAll(":scope .staytube-native-date-host").forEach((element) => {
      element.replaceChildren();
      element.classList.remove("staytube-native-date-host");
      delete element.dataset.staytubeRelativeText;
    });
    card.dataset.staytubeVideoId = videoId;

    const container = document.createElement("div");
    container.className = "staytube-listing-details";
    container.setAttribute("data-staytube", "listing-details");
    container.setAttribute("aria-live", "polite");
    findMetadataHost(card).append(container);

    if (!observedCards.has(card)) {
      observedCards.add(card);
      visibilityObserver.observe(card);
    } else {
      enrichCard(card);
    }
  }

  function inspectLink(link) {
    const videoId = Core.extractVideoId(link.href, location.href);
    if (!videoId) return;

    const card = link.closest(CARD_SELECTORS);
    if (!card) return;
    prepareCard(card, videoId);
  }

  function currentWatchVideoId() {
    return Core.extractVideoId(location.href, location.href);
  }

  function findWatchDateHost() {
    const isPublishedAge = (element) => (
      !element.classList.contains("staytube-watch-published")
      && Core.looksLikePublishedAge(element.getAttribute("aria-label") || element.textContent)
    );
    const nestedAge = [...document.querySelectorAll(WATCH_DATE_SELECTOR)].find(isPublishedAge);
    if (nestedAge) return nestedAge;
    return [...document.querySelectorAll(WATCH_DATE_FALLBACK_SELECTOR)].find(isPublishedAge) ?? null;
  }

  function removeWatchPublishedTimes() {
    document.querySelectorAll(".staytube-watch-published").forEach((element) => {
      const host = element.parentElement;
      const previousDetail = host?.dataset.staytubeWatchAccessibleDetail;
      const currentLabel = host?.getAttribute("aria-label");
      if (host && previousDetail && currentLabel) {
        const restoredLabel = Core.replaceAccessibleLabelDetail(currentLabel, previousDetail, null);
        if (restoredLabel) host.setAttribute("aria-label", restoredLabel);
        delete host.dataset.staytubeWatchAccessibleDetail;
      }
      element.remove();
    });
  }

  function exposeWatchPublishedTimeToAssistiveTechnology(host, published) {
    const currentLabel = host.getAttribute("aria-label");
    if (!currentLabel) return;
    const previousDetail = host.dataset.staytubeWatchAccessibleDetail;
    const detail = `Published ${published.textContent.trim()}`;
    host.setAttribute(
      "aria-label",
      Core.replaceAccessibleLabelDetail(currentLabel, previousDetail, detail)
    );
    host.dataset.staytubeWatchAccessibleDetail = detail;
  }

  async function ensureWatchPublishedTime() {
    const videoId = currentWatchVideoId();
    if (!videoId) {
      removeWatchPublishedTimes();
      return;
    }

    const current = document.querySelector(`.staytube-watch-published[data-video-id="${videoId}"]`);
    if (current) return;

    const host = findWatchDateHost();
    if (!host || host.dataset.staytubeWatchPending === videoId) return;
    host.dataset.staytubeWatchPending = videoId;

    try {
      const metadata = await metadataFor(videoId);
      if (currentWatchVideoId() !== videoId || !host.isConnected) return;
      if (!Core.looksLikePublishedAge(host.getAttribute("aria-label") || host.textContent)) return;
      if (document.querySelector(`.staytube-watch-published[data-video-id="${videoId}"]`)) return;

      removeWatchPublishedTimes();
      const published = makePublishedTime(metadata?.publishedAt);
      if (!published) return;
      published.classList.add("staytube-watch-published");
      published.dataset.videoId = videoId;
      // Keep the time inside YouTube's visible relative-age span. The collapsed
      // description hides extra siblings in #info even though they remain in the DOM.
      host.append(published);
      exposeWatchPublishedTimeToAssistiveTechnology(host, published);
    } catch {
      metadataCache.delete(videoId);
    } finally {
      delete host.dataset.staytubeWatchPending;
    }
  }

  function findTranscriptButtonPlacement() {
    const actions = document.querySelector([
      "ytd-watch-metadata #actions-inner",
      "ytd-watch-metadata #actions",
      "ytm-slim-video-metadata-section-renderer .slim-video-metadata-actions"
    ].join(","));
    if (!actions) return null;

    const share = actions.querySelector([
      "#share-button",
      "button[aria-label^='Share']",
      "button[title^='Share']",
      "[role='button'][aria-label^='Share']"
    ].join(","));
    if (!share) return { host: actions, after: null };

    const buttonRow = share.closest("#top-level-buttons-computed") ?? share.parentElement;
    let shareItem = share;
    while (shareItem.parentElement && shareItem.parentElement !== buttonRow) {
      shareItem = shareItem.parentElement;
    }
    return { host: buttonRow, after: shareItem };
  }

  async function copyTranscript(button) {
    const videoId = currentWatchVideoId();
    if (!videoId || button.disabled) return;
    clearTimeout(transcriptButtonResetTimer);
    button.disabled = true;
    button.querySelector(".staytube-copy-transcript-label").textContent = "Copying…";

    try {
      let transcript = null;
      for (const script of document.scripts) {
        if (!script.textContent.includes("ytInitialPlayerResponse")) continue;
        transcript = Core.parseTranscriptMetadata(script.textContent, videoId);
        if (transcript) break;
      }
      if (!transcript) {
        const watchUrl = new URL("/watch", location.origin);
        watchUrl.searchParams.set("v", videoId);
        watchUrl.searchParams.set("hl", "en");
        const watchResponse = await fetch(watchUrl, { credentials: "same-origin", cache: "no-cache" });
        if (!watchResponse.ok) throw new Error(`YouTube returned ${watchResponse.status}`);
        transcript = Core.parseTranscriptMetadata(await watchResponse.text(), videoId);
      }
      if (!transcript) throw new Error("No transcript is available for this video");

      let segments;
      let captionError;
      try {
        segments = await fetchCaptionSegments(transcript.captionUrl);
      } catch (error) {
        captionError = error;
        try {
          segments = await transcriptSegmentsFromNativePanel(videoId);
        } catch (panelError) {
          panelError.staytubeDiagnostics = {
            captionAttempts: captionError.staytubeDiagnostics?.captionAttempts ?? [],
            nativePanel: nativeTranscriptDiagnostics()
          };
          throw panelError;
        }
      }
      const markdown = Core.formatTranscriptMarkdown(segments, transcript.chapters);
      if (!markdown) throw captionError ?? new Error("The transcript is empty");
      await writeClipboardText(markdown);
      button.querySelector(".staytube-copy-transcript-label").textContent = "Copied!";
      button.title = "Transcript copied as Markdown";
    } catch (error) {
      console.error("StayTube could not copy the transcript", error);
      const prompt = Core.buildTranscriptDebugPrompt({
        error: error?.message ?? String(error),
        videoUrl: new URL(`/watch?v=${videoId}`, location.origin).href,
        version: EXTENSION_VERSION,
        diagnostics: error?.staytubeDiagnostics ?? null
      });
      try {
        await writeClipboardText(prompt);
        button.querySelector(".staytube-copy-transcript-label").textContent = "Debug prompt copied";
        button.title = `Transcript failed: ${error?.message ?? error}. A troubleshooting prompt was copied.`;
      } catch (clipboardError) {
        button.querySelector(".staytube-copy-transcript-label").textContent = "Copy failed";
        button.title = `${error?.message ?? error}; ${clipboardError.message}`;
      }
    } finally {
      button.disabled = false;
      transcriptButtonResetTimer = setTimeout(() => {
        if (button.isConnected) {
          button.querySelector(".staytube-copy-transcript-label").textContent = "Copy transcript";
          button.title = `Copy transcript with chapter headings as Markdown · StayTube ${EXTENSION_VERSION}`;
        }
      }, 2500);
    }
  }

  async function fetchCaptionSegments(baseUrl) {
    const attempts = [];
    for (const format of ["json3", "vtt", "xml"]) {
      const captionUrl = new URL(baseUrl);
      if (format === "xml") captionUrl.searchParams.delete("fmt");
      else captionUrl.searchParams.set("fmt", format);

      try {
        const response = await fetch(captionUrl, { credentials: "same-origin" });
        const body = await response.text();
        const trimmed = body.trim();
        const contentType = response.headers.get("content-type")?.split(";", 1)[0] ?? "unknown";
        const detectedFormat = trimmed.startsWith("{") ? "json"
          : trimmed.startsWith("<") ? "xml"
            : /^WEBVTT/m.test(trimmed) ? "vtt" : trimmed ? "other" : "empty";
        attempts.push({ format, status: response.status, contentType, bodyLength: body.length, detectedFormat });
        if (!response.ok || !trimmed) continue;

        const segments = detectedFormat === "json"
          ? Core.captionSegmentsFromJson(JSON.parse(body))
          : detectedFormat === "xml"
            ? Core.captionSegmentsFromXml(body)
            : detectedFormat === "vtt" ? Core.captionSegmentsFromVtt(body) : [];
        if (segments.length) return segments;
      } catch (error) {
        attempts.push({ format, error: error?.name ?? "Error" });
      }
    }
    const error = new Error("YouTube returned no usable timed-text transcript");
    error.staytubeDiagnostics = { captionAttempts: attempts };
    throw error;
  }

  function readNativeTranscriptSegments(root = document) {
    const renderers = root.querySelectorAll([
      "ytd-transcript-segment-renderer",
      "transcript-segment-view-model",
      "yt-formatted-string.ytd-transcript-segment-renderer"
    ].join(","));
    const segments = [];
    for (const renderer of renderers) {
      const timestampElement = renderer.querySelector([
        ".segment-timestamp",
        '[class*="timestamp" i]'
      ].join(","));
      const textElement = renderer.querySelector([
        ".segment-text",
        '[class*="segment-text" i]',
        '[class*="segmentviewmodeltext" i]'
      ].join(","));
      const segment = Core.nativeTranscriptSegment(
        timestampElement?.textContent,
        textElement?.textContent,
        renderer.textContent
      );
      if (segment) segments.push(segment);
    }
    return segments.filter((segment, index) => (
      index === 0
      || segment.startMs !== segments[index - 1].startMs
      || segment.text !== segments[index - 1].text
    ));
  }

  function nativeTranscriptSignature(segments) {
    return JSON.stringify(segments.map(({ startMs, text }) => [startMs, text]));
  }

  function nativeTranscriptBaseline() {
    return new Map(nativeTranscriptPanels().map((panel) => [
      panel,
      nativeTranscriptSignature(readNativeTranscriptSegments(panel))
    ]));
  }

  function readCurrentNativeTranscript(videoId, baseline = null) {
    for (const panel of nativeTranscriptPanels()) {
      const segments = readNativeTranscriptSegments(panel);
      if (!segments.length) continue;
      const belongsToCurrentVideo = panel.dataset.staytubeTranscriptVideoId === videoId;
      const changedSinceBaseline = baseline
        && (!baseline.has(panel)
          || baseline.get(panel) !== nativeTranscriptSignature(segments));
      if (!Core.canTrustNativeTranscriptPanel({
        belongsToCurrentVideo,
        changedSinceBaseline
      })) continue;
      panel.dataset.staytubeTranscriptVideoId = videoId;
      return segments;
    }
    return [];
  }

  function waitForNativeTranscript(videoId, baseline, timeoutMs = 6000) {
    const existing = readCurrentNativeTranscript(videoId, baseline);
    if (existing.length) return Promise.resolve(existing);

    return new Promise((resolve, reject) => {
      const finishIfReady = () => {
        const segments = readCurrentNativeTranscript(videoId, baseline);
        if (!segments.length) return false;
        clearTimeout(timeout);
        clearInterval(poll);
        observer.disconnect();
        resolve(segments);
        return true;
      };
      const observer = new MutationObserver(finishIfReady);
      const poll = setInterval(finishIfReady, 100);
      const timeout = setTimeout(() => {
        clearInterval(poll);
        observer.disconnect();
        reject(new Error("YouTube's transcript panel did not load"));
      }, timeoutMs);
      observer.observe(document.documentElement, {
        characterData: true,
        childList: true,
        subtree: true
      });
    });
  }

  function nativeTranscriptPanels() {
    return [...document.querySelectorAll(
      'ytd-engagement-panel-section-list-renderer[target-id*="transcript"]'
    )];
  }

  async function resetStaleNativeTranscriptPanels(videoId) {
    let reset = false;
    for (const panel of nativeTranscriptPanels()) {
      const expanded = panel.getAttribute("visibility")?.includes("EXPANDED");
      const loading = Boolean(panel.querySelector("tp-yt-paper-spinner[active]"));
      const segmentCount = readNativeTranscriptSegments(panel).length;
      const belongsToCurrentVideo = panel.dataset.staytubeTranscriptVideoId === videoId;
      const shouldReset = belongsToCurrentVideo
        ? Core.shouldResetNativeTranscriptPanel({ expanded, loading, segmentCount })
        : Boolean(expanded) && !loading;
      if (!shouldReset) continue;

      const close = panel.querySelector([
        '#visibility-button button',
        'button[aria-label="Close transcript"]',
        'button[aria-label="Close"]',
        '#visibility-button'
      ].join(","));
      if (!close) continue;
      close.click();
      reset = true;
    }
    if (reset) {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
  }

  async function transcriptSegmentsFromNativePanel(videoId) {
    const existing = readCurrentNativeTranscript(videoId);
    if (existing.length) return existing;

    const expander = document.querySelector("ytd-text-inline-expander#description-inline-expander #expand");
    if (expander?.getClientRects().length) {
      expander.click();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }

    // YouTube can preserve an expanded but empty transcript engagement panel
    // across SPA navigation. Close that stale panel so Show transcript issues a
    // fresh native getTranscript request for the current video.
    await resetStaleNativeTranscriptPanels(videoId);

    // Ignore transcript rows that were mounted for a prior SPA destination. A
    // panel is trusted only after StayTube observes it hydrate for this video.
    const baseline = nativeTranscriptBaseline();

    const allButtons = [...document.querySelectorAll(NATIVE_TRANSCRIPT_BUTTON_SELECTOR)];
    const visibleButtons = allButtons.filter((button) => button.getClientRects().length > 0);
    const buttons = visibleButtons.length ? visibleButtons : allButtons;
    if (!buttons.length) throw new Error("YouTube did not provide a transcript panel");

    let lastError;
    for (const nativeButton of buttons) {
      try {
        const pendingSegments = waitForNativeTranscript(videoId, baseline);
        nativeButton.click();
        return await pendingSegments;
      } catch (error) {
        lastError = error;
        await resetStaleNativeTranscriptPanels(videoId);
      }
    }
    throw lastError ?? new Error("YouTube's transcript panel did not load");
  }

  function nativeTranscriptDiagnostics() {
    const panels = nativeTranscriptPanels();
    return {
      controls: document.querySelectorAll(
        'button[aria-label="Show transcript"], button[aria-label="Transcript"]'
      ).length,
      visibleControls: [...document.querySelectorAll(
        'button[aria-label="Show transcript"], button[aria-label="Transcript"]'
      )].filter((control) => control.getClientRects().length > 0).length,
      panels: panels.length,
      expandedPanels: panels.filter((panel) => panel.getAttribute("visibility")?.includes("EXPANDED")).length,
      loadingSpinners: panels.filter((panel) => panel.querySelector("tp-yt-paper-spinner[active]")).length,
      segments: readNativeTranscriptSegments().length
    };
  }

  async function writeClipboardText(text) {
    return Core.copyTextWithFallback(text, {
      writeText: (value) => navigator.clipboard.writeText(value),
      legacyCopy(value) {
        const textarea = document.createElement("textarea");
        textarea.value = value;
        textarea.setAttribute("readonly", "");
        textarea.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
        document.body.append(textarea);
        textarea.select();
        const copied = document.execCommand("copy");
        textarea.remove();
        return copied;
      }
    });
  }

  function ensureTranscriptButton() {
    const videoId = currentWatchVideoId();
    if (!videoId) {
      document.querySelectorAll(".staytube-copy-transcript").forEach((button) => button.remove());
      return;
    }
    const placement = findTranscriptButtonPlacement();
    if (!placement) return;
    const { host, after } = placement;
    const existing = host.querySelector(":scope > .staytube-copy-transcript");
    if (existing) {
      existing.dataset.videoId = videoId;
      return;
    }

    document.querySelectorAll(".staytube-copy-transcript").forEach((button) => button.remove());
    const button = document.createElement("button");
    button.className = [
      "staytube-copy-transcript",
      "ytSpecButtonShapeNextHost",
      "ytSpecButtonShapeNextTonal",
      "ytSpecButtonShapeNextMono",
      "ytSpecButtonShapeNextSizeM"
    ].join(" ");
    button.type = "button";
    button.title = `Copy transcript with chapter headings as Markdown · StayTube ${EXTENSION_VERSION}`;
    button.setAttribute("aria-label", "Copy transcript with chapter headings as Markdown");
    button.dataset.videoId = videoId;
    button.dataset.staytubeVersion = EXTENSION_VERSION;
    button.innerHTML = `
      <span class="ytSpecButtonShapeNextIcon ytSpecButtonShapeNextElevatedContent" aria-hidden="true">
        <span class="ytIconWrapperHost" style="width: 24px; height: 24px">
          <svg viewBox="0 0 24 24" width="24" height="24" focusable="false" aria-hidden="true">
            <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1Zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2Zm0 16H8V7h11v14Z"></path>
          </svg>
        </span>
      </span>
      <span class="ytSpecButtonShapeNextTextContent ytSpecButtonShapeNextElevatedContent">
        <span class="staytube-copy-transcript-label yt-core-attributed-string">Copy transcript</span>
      </span>
      <yt-touch-feedback-shape aria-hidden="true" class="ytSpecTouchFeedbackShapeHost">
        <span class="ytSpecTouchFeedbackShapeStroke"></span>
        <span class="ytSpecTouchFeedbackShapeFill"></span>
      </yt-touch-feedback-shape>`;
    button.addEventListener("click", () => copyTranscript(button));
    if (after) {
      after.insertAdjacentElement("afterend", button);
    } else {
      host.append(button);
    }
  }

  function scanRoot(root) {
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
    if (root.nodeType === Node.ELEMENT_NODE && root.matches(VIDEO_LINK_SELECTOR)) inspectLink(root);
    if (root.nodeType === Node.ELEMENT_NODE) {
      const playlistRow = root.closest(
        "ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer"
      );
      if (playlistRow) {
        ensurePlaylistRemoveButton(playlistRow);
        ensurePlaylistCleanLink(playlistRow);
        updatePlaylistRowsCollapse([playlistRow]);
      }
    }
    const playlistRows = root.querySelectorAll(
      "ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer"
    );
    playlistRows.forEach((row) => {
      ensurePlaylistRemoveButton(row);
      ensurePlaylistCleanLink(row);
    });
    updatePlaylistRowsCollapse(playlistRows);
    observePlaylistProgress(root);
    root.querySelectorAll(VIDEO_LINK_SELECTOR).forEach(inspectLink);
  }

  function scan() {
    scanScheduled = false;
    ensureTranscriptButton();
    ensureWatchPublishedTime();
    ensurePlaylistCollapseControls();
    const roots = [...pendingScanRoots];
    pendingScanRoots.clear();
    roots.forEach(scanRoot);
    updatePlaylistCollapseControls();
  }

  function scheduleScan(root = document) {
    if (root === document) {
      pendingScanRoots.clear();
      pendingScanRoots.add(document);
    } else if (!pendingScanRoots.has(document)) {
      for (const existing of pendingScanRoots) {
        if (existing.contains?.(root)) return;
        if (root.contains?.(existing)) pendingScanRoots.delete(existing);
      }
      pendingScanRoots.add(root);
    }
    if (scanScheduled) return;
    scanScheduled = true;
    requestAnimationFrame(scan);
  }

  function isStayTubeMutationTarget(node) {
    return node.nodeType === Node.ELEMENT_NODE && Boolean(node.closest([
      ".staytube-listing-details",
      ".staytube-native-date-host",
      ".staytube-watch-published",
      ".staytube-copy-transcript",
      ".staytube-playlist-remove",
      ".staytube-playlist-open-clean",
      ".staytube-playlist-collapse-controls"
    ].join(",")));
  }

  const mutationObserver = new MutationObserver((records) => {
    for (const record of records) {
      if (isStayTubeMutationTarget(record.target)) continue;
      if (record.type === "attributes") {
        scheduleScan(record.target);
        continue;
      }
      const removedPlaylistAction = [...record.removedNodes].some((node) => (
        node.nodeType === Node.ELEMENT_NODE
        && (node.matches?.(".staytube-playlist-remove, .staytube-playlist-open-clean")
          || node.querySelector?.(".staytube-playlist-remove, .staytube-playlist-open-clean"))
      ));
      if (removedPlaylistAction) schedulePlaylistActionReconciliation();
      for (const node of record.addedNodes) {
        if (isStayTubeMutationTarget(node)) continue;
        scheduleScan(node.nodeType === Node.ELEMENT_NODE ? node : record.target);
      }
    }
  });
  mutationObserver.observe(document.documentElement, Core.LISTING_MUTATION_OBSERVER_OPTIONS);
  document.addEventListener("click", (event) => {
    if (!event.isTrusted || !event.target.closest?.(NATIVE_TRANSCRIPT_BUTTON_SELECTOR)) return;
    const videoId = currentWatchVideoId();
    if (!videoId) return;
    const baseline = nativeTranscriptBaseline();
    // Associate native rows only after they hydrate following a real user action.
    // Programmatic StayTube clicks are intentionally excluded by isTrusted.
    waitForNativeTranscript(videoId, baseline).catch(() => {});
  }, true);
  document.addEventListener("yt-navigate-finish", () => scheduleScan());
  document.addEventListener("yt-page-data-updated", () => scheduleScan());
  scheduleScan();
})();
