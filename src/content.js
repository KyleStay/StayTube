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

  const metadataCache = new Map();
  const pendingTasks = [];
  const observedCards = new WeakSet();
  const MAX_CONCURRENT_REQUESTS = 4;
  let activeRequests = 0;
  let scanScheduled = false;
  const pendingScanRoots = new Set();
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

  function ensurePlaylistRemoveButton(card) {
    if (!card.matches("ytd-playlist-video-renderer")) return;
    if (!card.querySelector(":scope .playlist-drag-handle")) return;
    const menu = card.querySelector(":scope > #menu");
    if (!menu || menu.querySelector(":scope > .staytube-playlist-remove")) return;

    const title = card.querySelector(":scope #video-title")?.textContent?.trim();
    const button = document.createElement("button");
    button.className = "staytube-playlist-remove";
    button.type = "button";
    button.textContent = "×";
    button.setAttribute("aria-label", title ? `Remove ${title} from playlist` : "Remove video from playlist");
    button.title = "Remove from playlist";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      runRemovePlaylistCommand(card, button);
    });
    menu.prepend(button);
  }

  function prepareCard(card, videoId) {
    ensurePlaylistRemoveButton(card);
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

  async function ensureWatchPublishedTime() {
    const videoId = currentWatchVideoId();
    if (!videoId) {
      document.querySelectorAll(".staytube-watch-published").forEach((element) => element.remove());
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

      document.querySelectorAll(".staytube-watch-published").forEach((element) => element.remove());
      const published = makePublishedTime(metadata?.publishedAt);
      if (!published) return;
      published.classList.add("staytube-watch-published");
      published.dataset.videoId = videoId;
      host.insertAdjacentElement("afterend", published);
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
          segments = await transcriptSegmentsFromNativePanel();
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

  function readNativeTranscriptSegments() {
    const renderers = document.querySelectorAll([
      "ytd-transcript-segment-renderer",
      "transcript-segment-view-model",
      "yt-formatted-string.ytd-transcript-segment-renderer"
    ].join(","));
    const segments = [];
    for (const renderer of renderers) {
      const timestampElement = renderer.querySelector([
        ".segment-timestamp",
        "[class*='Timestamp']"
      ].join(","));
      const textElement = renderer.querySelector([
        ".segment-text",
        "[class*='Segment']:not([class*='Timestamp'])"
      ].join(","));
      const startMs = Core.parseTimestamp(timestampElement?.textContent ?? "");
      const text = textElement?.textContent?.replace(/\s+/g, " ").trim();
      if (startMs !== null && text) segments.push({ startMs, text });
    }
    return segments.filter((segment, index) => (
      index === 0
      || segment.startMs !== segments[index - 1].startMs
      || segment.text !== segments[index - 1].text
    ));
  }

  function waitForNativeTranscript(timeoutMs = 6000) {
    const existing = readNativeTranscriptSegments();
    if (existing.length) return Promise.resolve(existing);

    return new Promise((resolve, reject) => {
      const observer = new MutationObserver(() => {
        const segments = readNativeTranscriptSegments();
        if (!segments.length) return;
        clearTimeout(timeout);
        observer.disconnect();
        resolve(segments);
      });
      const timeout = setTimeout(() => {
        observer.disconnect();
        reject(new Error("YouTube's transcript panel did not load"));
      }, timeoutMs);
      observer.observe(document.documentElement, { childList: true, subtree: true });
    });
  }

  async function transcriptSegmentsFromNativePanel() {
    const existing = readNativeTranscriptSegments();
    if (existing.length) return existing;

    const expander = document.querySelector("ytd-text-inline-expander#description-inline-expander #expand");
    if (expander?.getClientRects().length) {
      expander.click();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }

    const buttons = [...document.querySelectorAll([
      'ytd-video-description-transcript-section-renderer button[aria-label="Show transcript"]',
      'button[aria-label="Transcript"]'
    ].join(","))].sort((left, right) => (
      Number(right.getClientRects().length > 0) - Number(left.getClientRects().length > 0)
    ));
    if (!buttons.length) throw new Error("YouTube did not provide a transcript panel");

    let lastError;
    for (const nativeButton of buttons) {
      try {
        const pendingSegments = waitForNativeTranscript();
        nativeButton.click();
        return await pendingSegments;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError ?? new Error("YouTube's transcript panel did not load");
  }

  function nativeTranscriptDiagnostics() {
    const panels = [...document.querySelectorAll(
      'ytd-engagement-panel-section-list-renderer[target-id*="transcript"]'
    )];
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
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
      document.body.append(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      if (!copied) throw new Error("The browser denied clipboard access");
    }
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
      const playlistRow = root.closest("ytd-playlist-video-renderer");
      if (playlistRow) ensurePlaylistRemoveButton(playlistRow);
    }
    root.querySelectorAll("ytd-playlist-video-renderer").forEach(ensurePlaylistRemoveButton);
    root.querySelectorAll(VIDEO_LINK_SELECTOR).forEach(inspectLink);
  }

  function scan() {
    scanScheduled = false;
    ensureTranscriptButton();
    ensureWatchPublishedTime();
    const roots = [...pendingScanRoots];
    pendingScanRoots.clear();
    roots.forEach(scanRoot);
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
      ".staytube-playlist-remove"
    ].join(",")));
  }

  const mutationObserver = new MutationObserver((records) => {
    for (const record of records) {
      if (isStayTubeMutationTarget(record.target)) continue;
      if (record.type === "attributes") {
        scheduleScan(record.target);
        continue;
      }
      for (const node of record.addedNodes) {
        if (isStayTubeMutationTarget(node)) continue;
        scheduleScan(node.nodeType === Node.ELEMENT_NODE ? node : record.target);
      }
    }
  });
  mutationObserver.observe(document.documentElement, Core.LISTING_MUTATION_OBSERVER_OPTIONS);
  document.addEventListener("yt-navigate-finish", () => scheduleScan());
  document.addEventListener("yt-page-data-updated", () => scheduleScan());
  scheduleScan();
})();
