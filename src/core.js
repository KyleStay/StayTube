(function initializeStayTubeCore(globalScope, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  globalScope.StayTubeCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createStayTubeCore() {
  "use strict";

  const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
  const NATIVE_DATE_CANDIDATE_SELECTORS = Object.freeze([
    "#metadata-line span",
    "#metadata-line .inline-metadata-item",
    "#video-info span",
    ".yt-lockup-metadata-view-model__metadata span",
    "yt-content-metadata-view-model span"
  ]);
  const CLASSIC_DATE_FALLBACK_SELECTORS = Object.freeze([
    "#metadata-line > span",
    "#metadata-line > .inline-metadata-item",
    "#video-info > span"
  ]);
  const LISTING_MUTATION_OBSERVER_OPTIONS = Object.freeze({
    attributeFilter: Object.freeze(["href"]),
    attributes: true,
    childList: true,
    subtree: true
  });

  function extractVideoId(value, baseUrl = "https://www.youtube.com/") {
    if (!value) return null;

    let url;
    try {
      url = new URL(value, baseUrl);
    } catch {
      return null;
    }

    const queryId = url.searchParams.get("v");
    if (queryId && VIDEO_ID_PATTERN.test(queryId)) return queryId;

    const pathMatch = url.pathname.match(/^\/(?:shorts|live|embed)\/([^/?#]+)/);
    if (pathMatch && VIDEO_ID_PATTERN.test(pathMatch[1])) return pathMatch[1];

    if (url.hostname === "youtu.be") {
      const shortId = url.pathname.split("/").filter(Boolean)[0];
      if (shortId && VIDEO_ID_PATTERN.test(shortId)) return shortId;
    }

    return null;
  }

  function findJsonObject(source, marker) {
    const markerIndex = source.indexOf(marker);
    if (markerIndex === -1) return null;

    const start = source.indexOf("{", markerIndex + marker.length);
    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < source.length; index += 1) {
      const character = source[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === '"') {
          inString = false;
        }
        continue;
      }

      if (character === '"') {
        inString = true;
      } else if (character === "{") {
        depth += 1;
      } else if (character === "}") {
        depth -= 1;
        if (depth === 0) return source.slice(start, index + 1);
      }
    }

    return null;
  }

  function readInitialPlayerResponse(html) {
    const markers = [
      "ytInitialPlayerResponse =",
      "ytInitialPlayerResponse=",
      "window.ytInitialPlayerResponse ="
    ];

    for (const marker of markers) {
      const json = findJsonObject(html, marker);
      if (!json) continue;

      try {
        return JSON.parse(json);
      } catch {
        // Try the next representation if YouTube emitted more than one.
      }
    }

    return null;
  }

  function decodeJsonString(value) {
    if (!value) return null;
    try {
      return JSON.parse(`"${value}"`);
    } catch {
      return value.replaceAll("\\/", "/");
    }
  }

  function firstRegexValue(source, patterns) {
    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (match) return decodeJsonString(match[1]);
    }
    return null;
  }

  function parseWatchHtml(html, expectedVideoId = null) {
    const response = readInitialPlayerResponse(html);
    const details = response?.videoDetails ?? {};
    const microformat = response?.microformat?.playerMicroformatRenderer ?? {};

    const videoId = details.videoId ?? expectedVideoId;
    if (expectedVideoId && videoId && videoId !== expectedVideoId) return null;

    const author = details.author ?? firstRegexValue(html, [
      /"author":"((?:\\.|[^"\\])+)"/,
      /<link\s+itemprop="name"\s+content="([^"]+)"/i
    ]);
    const channelId = details.channelId ?? firstRegexValue(html, [
      /"channelId":"((?:\\.|[^"\\])+)"/
    ]);
    const ownerProfileUrl = microformat.ownerProfileUrl ?? firstRegexValue(html, [
      /"ownerProfileUrl":"((?:\\.|[^"\\])+)"/
    ]);
    const publishedAt = microformat.publishDate ?? microformat.uploadDate ?? firstRegexValue(html, [
      /"publishDate":"((?:\\.|[^"\\])+)"/,
      /"uploadDate":"((?:\\.|[^"\\])+)"/,
      /itemprop="uploadDate"\s+content="([^"]+)"/i
    ]);

    const canonicalBaseUrl = microformat.ownerProfileUrl
      ?? response?.microformat?.playerMicroformatRenderer?.ownerProfileUrl;
    const channelUrl = ownerProfileUrl
      ?? canonicalBaseUrl
      ?? (channelId ? `/channel/${channelId}` : null);

    if (!author && !channelUrl && !publishedAt) return null;

    return {
      videoId: videoId ?? expectedVideoId,
      author: author ?? null,
      channelId: channelId ?? null,
      channelUrl,
      publishedAt: publishedAt ?? null
    };
  }

  function parseTranscriptMetadata(html, expectedVideoId = null) {
    const response = readInitialPlayerResponse(html);
    if (!response) return null;
    if (expectedVideoId && response.videoDetails?.videoId !== expectedVideoId) return null;

    const tracks = response.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    const preferredTrack = tracks.find((track) => !track.kind)
      ?? tracks.find((track) => track.kind === "asr")
      ?? tracks[0];
    if (!preferredTrack?.baseUrl) return null;

    const markerMaps = response.playerOverlays?.playerOverlayRenderer
      ?.decoratedPlayerBarRenderer?.decoratedPlayerBarRenderer
      ?.playerBar?.multiMarkersPlayerBarRenderer?.markersMap ?? [];
    const chapterMap = markerMaps.find((entry) => ["CHAPTERS", "AUTO_CHAPTERS"].includes(entry.key));
    const chapters = (chapterMap?.value?.chapters ?? []).map(({ chapterRenderer }) => ({
      title: chapterRenderer?.title?.simpleText
        ?? chapterRenderer?.title?.runs?.map((run) => run.text).join("")
        ?? "Chapter",
      startMs: Number(chapterRenderer?.timeRangeStartMillis) || 0
    }));

    return { captionUrl: preferredTrack.baseUrl, chapters };
  }

  function captionSegmentsFromJson(payload) {
    return (payload?.events ?? []).flatMap((event) => {
      const text = event.segs?.map((segment) => segment.utf8).join("")
        .replaceAll("\n", " ").replace(/\s+/g, " ").trim();
      return text ? [{ startMs: Number(event.tStartMs) || 0, text }] : [];
    });
  }

  function decodeXmlText(value) {
    return value
      .replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">")
      .replaceAll("&quot;", '"').replaceAll("&#39;", "'")
      .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
  }

  function captionSegmentsFromXml(source) {
    return [...source.matchAll(/<text\b[^>]*\bstart="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g)]
      .map((match) => ({
        startMs: Math.round(Number(match[1]) * 1000),
        text: decodeXmlText(match[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()
      }))
      .filter((segment) => segment.text);
  }

  function captionSegmentsFromVtt(source) {
    const segments = [];
    const lines = source.replaceAll("\r", "").split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const match = lines[index].match(/(?:^|\s)((?:\d+:)?\d{2}:\d{2}[.,]\d{3})\s+-->/);
      if (!match) continue;
      const startMs = parseTimestamp(match[1].replace(/[.,]\d{3}$/, ""));
      const text = [];
      for (index += 1; index < lines.length && lines[index].trim(); index += 1) {
        text.push(lines[index].replace(/<[^>]+>/g, ""));
      }
      const normalized = decodeXmlText(text.join(" ")).replace(/\s+/g, " ").trim();
      if (startMs !== null && normalized) segments.push({ startMs, text: normalized });
    }
    return segments;
  }

  function formatTimestamp(milliseconds) {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [
      hours > 0 ? `${hours}h` : null,
      hours > 0 || minutes > 0 ? `${minutes}m` : null,
      `${seconds}s`
    ].filter(Boolean).join(" ");
  }

  function parseTimestamp(value) {
    if (typeof value !== "string") return null;
    const parts = value.trim().split(":").map(Number);
    if (parts.length < 2 || parts.length > 3 || parts.some(Number.isNaN)) return null;
    const seconds = parts.pop();
    const minutes = parts.pop();
    const hours = parts.pop() ?? 0;
    return ((hours * 60 * 60) + (minutes * 60) + seconds) * 1000;
  }

  function nativeTranscriptSegment(timestampValue, textValue, combinedValue = "") {
    const normalize = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
    const combined = normalize(combinedValue);
    const timestamp = normalize(timestampValue).match(/(?:\d+:)?\d{1,2}:\d{2}/)?.[0]
      ?? combined.match(/(?:^|\s)((?:\d+:)?\d{1,2}:\d{2})(?:\s|$)/)?.[1];
    const startMs = parseTimestamp(timestamp ?? "");
    if (startMs === null) return null;

    let text = normalize(textValue) || combined;
    if (timestamp && text.startsWith(timestamp)) text = text.slice(timestamp.length).trim();
    return text ? { startMs, text } : null;
  }

  function shouldResetNativeTranscriptPanel({ expanded, loading, segmentCount }) {
    return Boolean(expanded) && !loading && Number(segmentCount) === 0;
  }

  function canTrustNativeTranscriptPanel({
    belongsToCurrentVideo,
    changedSinceBaseline
  }) {
    return Boolean(belongsToCurrentVideo || changedSinceBaseline);
  }

  function replaceAccessibleLabelDetail(label, previousDetail, nextDetail) {
    if (typeof label !== "string" || !label.trim()) return null;
    const previousSuffix = previousDetail ? `, ${previousDetail}` : "";
    const base = previousSuffix && label.endsWith(previousSuffix)
      ? label.slice(0, -previousSuffix.length)
      : label;
    return nextDetail ? `${base}, ${nextDetail}` : base;
  }

  async function copyTextWithFallback(text, { writeText, legacyCopy }) {
    try {
      await writeText(text);
      return "clipboard";
    } catch {
      try {
        if (await legacyCopy(text)) return "execCommand";
      } catch {
        // Report a stable, privacy-safe error for either clipboard mechanism.
      }
      throw new Error("The browser denied clipboard access");
    }
  }

  function formatTranscriptMarkdown(segments, chapters) {
    const orderedChapters = [...chapters].sort((left, right) => left.startMs - right.startMs);
    const output = [];
    let chapterIndex = 0;

    for (const segment of segments) {
      while (chapterIndex < orderedChapters.length
        && orderedChapters[chapterIndex].startMs <= segment.startMs) {
        const chapter = orderedChapters[chapterIndex];
        output.push(`## ${formatTimestamp(chapter.startMs)} ${chapter.title}`, "");
        chapterIndex += 1;
      }
      output.push(segment.text);
    }
    while (chapterIndex < orderedChapters.length) {
      const chapter = orderedChapters[chapterIndex];
      output.push(`## ${formatTimestamp(chapter.startMs)} ${chapter.title}`, "");
      chapterIndex += 1;
    }
    return output.join("\n").trim();
  }

  function buildTranscriptDebugPrompt({ diagnostics = null, error, videoUrl, version = "unknown" }) {
    return `Please diagnose and improve StayTube's Copy transcript feature.

Expected behavior:
- On a YouTube watch page, copy the available transcript as Markdown.
- Intersperse chapters as headings in the form: ## 1m 23s Chapter title
- Keep working across YouTube single-page navigation.
- Preserve the native YouTube-style button beside Share.

Failure context:
- Video URL: ${videoUrl}
- StayTube version: ${version}
- Error: ${error || "Unknown error"}
- Safe diagnostics: ${diagnostics ? JSON.stringify(diagnostics, null, 2) : "Not available"}

Please reproduce the failure on this video and inspect:
1. Whether ytInitialPlayerResponse contains captionTracks and CHAPTERS or AUTO_CHAPTERS.
2. The caption response status, content type, and format, without exposing signed caption URLs or authentication tokens.
3. Whether captions are available through YouTube's transcript panel when the timed-text endpoint fails.
4. Clipboard permission errors and whether the fallback copy path succeeds.
5. YouTube's current watch-action DOM around the Share button.

Implement the smallest robust fix, including a transcript-panel fallback if needed. Add focused regression tests, verify an initially loaded video and a video reached through in-page navigation, and report the exact root cause and verification results. Do not log or share cookies, authorization headers, signed caption URLs, visitor data, or other private tokens.`;
  }

  function isExactTimestamp(value) {
    return typeof value === "string" && /T\d{2}:\d{2}/.test(value) && !Number.isNaN(Date.parse(value));
  }

  function looksLikePublishedAge(value) {
    if (typeof value !== "string") return false;
    return /(?:\b(?:second|minute|hour|day|week|month|year)s?\s+ago\b|\b\d+\s*(?:s|min|h|d|w|mo|y)\s+ago\b|\b(?:streamed|premiered)\s+.+\s+ago\b|\bscheduled\s+for\b)/i.test(value.trim());
  }

  function relativeAgeUnit(value) {
    if (typeof value !== "string") return null;
    const normalized = value.trim().toLowerCase();
    const wordMatch = normalized.match(/\b(second|minute|hour|day|week|month|year)s?\s+ago\b/);
    if (wordMatch) return wordMatch[1];

    const compactMatch = normalized.match(/\b\d+\s*(s|min|h|d|w|mo|y)\s+ago\b/);
    if (!compactMatch) return null;
    return {
      s: "second",
      min: "minute",
      h: "hour",
      d: "day",
      w: "week",
      mo: "month",
      y: "year"
    }[compactMatch[1]] ?? null;
  }

  function publicationDisplayMode(unit) {
    if (["second", "minute"].includes(unit)) return "time";
    if (["hour", "day"].includes(unit)) return "relative-time";
    if (["week", "month"].includes(unit)) return "relative-date-time";
    if (unit === "year") return "year-date-time";
    return "full-date-time";
  }

  function compactYearAge(value) {
    if (typeof value !== "string") return null;
    const normalized = value.trim().toLowerCase();
    const numericMatch = normalized.match(/\b(\d+)\s*(?:years?|y)\s+ago\b/);
    if (numericMatch) return `${numericMatch[1]}y ago`;
    if (/\b(?:a|an)\s+year\s+ago\b/.test(normalized)) return "1y ago";
    return null;
  }

  function isRemoveFromPlaylistLabel(value) {
    return typeof value === "string" && /^remove\s+from\b/i.test(value.trim());
  }

  return {
    CLASSIC_DATE_FALLBACK_SELECTORS,
    LISTING_MUTATION_OBSERVER_OPTIONS,
    NATIVE_DATE_CANDIDATE_SELECTORS,
    extractVideoId,
    findJsonObject,
    isExactTimestamp,
    isRemoveFromPlaylistLabel,
    captionSegmentsFromJson,
    captionSegmentsFromVtt,
    captionSegmentsFromXml,
    canTrustNativeTranscriptPanel,
    compactYearAge,
    copyTextWithFallback,
    buildTranscriptDebugPrompt,
    formatTranscriptMarkdown,
    looksLikePublishedAge,
    nativeTranscriptSegment,
    parseWatchHtml,
    parseTranscriptMetadata,
    parseTimestamp,
    publicationDisplayMode,
    replaceAccessibleLabelDetail,
    relativeAgeUnit,
    readInitialPlayerResponse,
    shouldResetNativeTranscriptPanel
  };
});
