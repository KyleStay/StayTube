"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../src/core.js");

test("extractVideoId recognizes listing URL variants", () => {
  const id = "dQw4w9WgXcQ";
  assert.equal(Core.extractVideoId(`/watch?v=${id}&list=abc`), id);
  assert.equal(Core.extractVideoId(`/shorts/${id}`), id);
  assert.equal(Core.extractVideoId(`/live/${id}?feature=share`), id);
  assert.equal(Core.extractVideoId(`https://youtu.be/${id}`), id);
  assert.equal(Core.extractVideoId("/playlist?list=abc"), null);
});

test("cleanVideoUrl removes playlist parameters but keeps the resume timestamp", () => {
  const id = "dQw4w9WgXcQ";
  assert.equal(
    Core.cleanVideoUrl(`/watch?v=${id}&list=PL123&index=4&t=30s`, "https://www.youtube.com/playlist?list=PL123"),
    `https://www.youtube.com/watch?v=${id}&t=30s`
  );
  assert.equal(
    Core.cleanVideoUrl(`/watch?v=${id}&list=PL123&index=4`, "https://www.youtube.com/playlist?list=PL123"),
    `https://www.youtube.com/watch?v=${id}`
  );
  assert.equal(Core.cleanVideoUrl("/playlist?list=PL123"), null);
});

test("parseWatchHtml extracts exact publishing and channel metadata", () => {
  const response = {
    videoDetails: {
      videoId: "dQw4w9WgXcQ",
      author: "Rick Astley",
      channelId: "UCuAXFkgsw1L7xaCfnd5JJOw"
    },
    microformat: {
      playerMicroformatRenderer: {
        ownerProfileUrl: "http://www.youtube.com/@RickAstleyYT",
        uploadDate: "2009-10-24T23:57:33-07:00",
        publishDate: "2009-10-24T23:57:33-07:00"
      }
    }
  };
  const html = `<script>var ytInitialPlayerResponse = ${JSON.stringify(response)};</script>`;

  assert.deepEqual(Core.parseWatchHtml(html, "dQw4w9WgXcQ"), {
    videoId: "dQw4w9WgXcQ",
    author: "Rick Astley",
    channelId: "UCuAXFkgsw1L7xaCfnd5JJOw",
    channelUrl: "http://www.youtube.com/@RickAstleyYT",
    publishedAt: "2009-10-24T23:57:33-07:00"
  });
});

test("parseWatchHtml falls back to embedded metadata", () => {
  const html = [
    '<meta itemprop="uploadDate" content="2026-07-10T12:34:56-04:00">',
    '<script>{"author":"Example Channel","channelId":"UC1234567890123456789012",',
    '"ownerProfileUrl":"https:\\/\\/www.youtube.com\\/@example"}</script>'
  ].join("");

  assert.deepEqual(Core.parseWatchHtml(html, "abcdefghijk"), {
    videoId: "abcdefghijk",
    author: "Example Channel",
    channelId: "UC1234567890123456789012",
    channelUrl: "https://www.youtube.com/@example",
    publishedAt: "2026-07-10T12:34:56-04:00"
  });
});

test("isExactTimestamp distinguishes date-only values", () => {
  assert.equal(Core.isExactTimestamp("2026-07-10T12:34:56-04:00"), true);
  assert.equal(Core.isExactTimestamp("2026-07-10"), false);
  assert.equal(Core.isExactTimestamp("not-a-date"), false);
});

test("looksLikePublishedAge identifies native relative-date labels", () => {
  assert.equal(Core.looksLikePublishedAge("3 hours ago"), true);
  assert.equal(Core.looksLikePublishedAge("2h ago"), true);
  assert.equal(Core.looksLikePublishedAge("11mo ago"), true);
  assert.equal(Core.looksLikePublishedAge("Streamed 2 years ago"), true);
  assert.equal(Core.looksLikePublishedAge("Scheduled for tomorrow"), true);
  assert.equal(Core.looksLikePublishedAge("1.2M views"), false);
  assert.equal(Core.looksLikePublishedAge("Example Channel"), false);
});

test("relativeAgeUnit recognizes full and compact age units", () => {
  assert.equal(Core.relativeAgeUnit("2 hours ago"), "hour");
  assert.equal(Core.relativeAgeUnit("6d ago"), "day");
  assert.equal(Core.relativeAgeUnit("3 weeks ago"), "week");
  assert.equal(Core.relativeAgeUnit("11mo ago"), "month");
  assert.equal(Core.relativeAgeUnit("4 years ago"), "year");
  assert.equal(Core.relativeAgeUnit("Scheduled for tomorrow"), null);
});

test("publication display modes keep week age with month, day, and time", () => {
  assert.equal(Core.publicationDisplayMode("minute"), "time");
  assert.equal(Core.publicationDisplayMode("day"), "relative-time");
  assert.equal(Core.publicationDisplayMode("week"), "relative-date-time");
  assert.equal(Core.publicationDisplayMode("month"), "relative-date-time");
  assert.equal(Core.publicationDisplayMode("year"), "year-date-time");
  assert.equal(Core.publicationDisplayMode(null), "full-date-time");
});

test("compactYearAge normalizes native year-old labels", () => {
  assert.equal(Core.compactYearAge("4 years ago"), "4y ago");
  assert.equal(Core.compactYearAge("Streamed 2 years ago"), "2y ago");
  assert.equal(Core.compactYearAge("1y ago"), "1y ago");
  assert.equal(Core.compactYearAge("a year ago"), "1y ago");
  assert.equal(Core.compactYearAge("11 months ago"), null);
});

test("remove command matching only accepts playlist removal labels", () => {
  assert.equal(Core.isRemoveFromPlaylistLabel("Remove from Watch later"), true);
  assert.equal(Core.isRemoveFromPlaylistLabel("  Remove from Favorites  "), true);
  assert.equal(Core.isRemoveFromPlaylistLabel("Save to playlist"), false);
  assert.equal(Core.isRemoveFromPlaylistLabel("Remove download"), false);
});

test("native date selectors cover classic listings and playlist video-info rows", () => {
  assert.ok(Core.NATIVE_DATE_CANDIDATE_SELECTORS.includes("#metadata-line span"));
  assert.ok(Core.NATIVE_DATE_CANDIDATE_SELECTORS.includes("#video-info span"));
  assert.ok(Core.CLASSIC_DATE_FALLBACK_SELECTORS.includes("#metadata-line > span"));
  assert.ok(Core.CLASSIC_DATE_FALLBACK_SELECTORS.includes("#video-info > span"));
  assert.equal(Object.isFrozen(Core.NATIVE_DATE_CANDIDATE_SELECTORS), true);
  assert.equal(Object.isFrozen(Core.CLASSIC_DATE_FALLBACK_SELECTORS), true);
});

test("listing observer detects appended and lazily hydrated video links", () => {
  assert.deepEqual(Core.LISTING_MUTATION_OBSERVER_OPTIONS, {
    attributeFilter: ["href"],
    attributes: true,
    childList: true,
    subtree: true
  });
  assert.equal(Object.isFrozen(Core.LISTING_MUTATION_OBSERVER_OPTIONS), true);
  assert.equal(Object.isFrozen(Core.LISTING_MUTATION_OBSERVER_OPTIONS.attributeFilter), true);
});

test("playlist progress observer options stay scoped to style and aria updates", () => {
  assert.deepEqual(Core.PLAYLIST_PROGRESS_OBSERVER_OPTIONS, {
    attributeFilter: ["style", "aria-label", "aria-valuenow", "src"],
    attributes: true,
    subtree: true
  });
  assert.equal(Object.isFrozen(Core.PLAYLIST_PROGRESS_OBSERVER_OPTIONS), true);
  assert.equal(Object.isFrozen(Core.PLAYLIST_PROGRESS_OBSERVER_OPTIONS.attributeFilter), true);
});

test("unavailable listing titles match YouTube's placeholder patterns only", () => {
  assert.equal(Core.isUnavailableListingTitle("[Deleted video]"), true);
  assert.equal(Core.isUnavailableListingTitle("[Private video]"), true);
  assert.equal(Core.isUnavailableListingTitle(" [ Unavailable video ] "), true);
  assert.equal(Core.isUnavailableListingTitle("[Live] My concert video"), false);
  assert.equal(Core.isUnavailableListingTitle("Deleted video"), false);
  assert.equal(Core.isUnavailableListingTitle(undefined), false);
});

test("playlist watch progress recognizes YouTube indicator formats", () => {
  assert.equal(Core.parseWatchProgress("width: 42.5%"), 42.5);
  assert.equal(Core.parseWatchProgress("left: 0%; width: 42%"), 42);
  assert.equal(Core.parseWatchProgress("transform: scaleX(0.84)"), 84);
  assert.equal(Core.parseWatchProgress("Fully watched"), 100);
  assert.equal(Core.parseWatchProgress("Not watched"), 0);
  assert.equal(Core.parseWatchProgress("Never watched"), 0);
  assert.equal(Core.parseWatchProgress("No progress"), null);
});

test("playlist overlay data recognizes resume and completed states", () => {
  assert.equal(Core.watchProgressFromOverlays([
    { thumbnailOverlayResumePlaybackRenderer: { percentDurationWatched: 84 } }
  ]), 84);
  assert.equal(Core.watchProgressFromOverlays([
    { thumbnailOverlayPlaybackStatusRenderer: { text: { simpleText: "WATCHED" } } }
  ]), 100);
  assert.equal(Core.watchProgressFromOverlays([
    { thumbnailOverlayPlaybackStatusRenderer: { accessibility: { accessibilityData: { label: "Not watched" } } } }
  ]), 0);
  assert.equal(Core.watchProgressFromOverlays([]), 0);
  assert.equal(Core.watchProgressFromOverlays(undefined), null);
});

test("transcript metadata selects captions and reads manual chapters", () => {
  const response = {
    videoDetails: { videoId: "dQw4w9WgXcQ" },
    captions: { playerCaptionsTracklistRenderer: { captionTracks: [
      { baseUrl: "https://www.youtube.com/api/timedtext?lang=en", kind: "asr" },
      { baseUrl: "https://www.youtube.com/api/timedtext?lang=en-US" }
    ] } },
    playerOverlays: { playerOverlayRenderer: { decoratedPlayerBarRenderer: {
      decoratedPlayerBarRenderer: { playerBar: { multiMarkersPlayerBarRenderer: { markersMap: [{
        key: "CHAPTERS",
        value: { chapters: [{ chapterRenderer: {
          title: { simpleText: "The middle" }, timeRangeStartMillis: 65000
        } }] }
      }] } } }
    } } }
  };
  const html = `<script>var ytInitialPlayerResponse = ${JSON.stringify(response)};</script>`;
  assert.deepEqual(Core.parseTranscriptMetadata(html, "dQw4w9WgXcQ"), {
    captionUrl: "https://www.youtube.com/api/timedtext?lang=en-US",
    chapters: [{ title: "The middle", startMs: 65000 }]
  });
});

test("transcript metadata reads automatic chapters", () => {
  const response = {
    videoDetails: { videoId: "dQw4w9WgXcQ" },
    captions: { playerCaptionsTracklistRenderer: { captionTracks: [
      { baseUrl: "https://www.youtube.com/api/timedtext?lang=en", kind: "asr" }
    ] } },
    playerOverlays: { playerOverlayRenderer: { decoratedPlayerBarRenderer: {
      decoratedPlayerBarRenderer: { playerBar: { multiMarkersPlayerBarRenderer: { markersMap: [{
        key: "AUTO_CHAPTERS",
        value: { chapters: [{ chapterRenderer: {
          title: { runs: [{ text: "Automatic chapter" }] }, timeRangeStartMillis: 83000
        } }] }
      }] } } }
    } } }
  };
  const html = `<script>var ytInitialPlayerResponse = ${JSON.stringify(response)};</script>`;
  assert.deepEqual(Core.parseTranscriptMetadata(html, "dQw4w9WgXcQ").chapters, [
    { title: "Automatic chapter", startMs: 83000 }
  ]);
});

test("SPA transcript lookup rejects the stale bootstrap response", () => {
  const response = (videoId) => `<script>var ytInitialPlayerResponse = ${JSON.stringify({
    videoDetails: { videoId },
    captions: { playerCaptionsTracklistRenderer: { captionTracks: [
      { baseUrl: `https://www.youtube.com/api/timedtext?video=${videoId}` }
    ] } }
  })};</script>`;
  assert.equal(Core.parseTranscriptMetadata(response("initialVideo"), "navigatedVideo"), null);
  assert.equal(
    Core.parseTranscriptMetadata(response("navigatedVideo"), "navigatedVideo").captionUrl,
    "https://www.youtube.com/api/timedtext?video=navigatedVideo"
  );
});

test("transcript Markdown intersperses timestamped chapter headings", () => {
  const segments = Core.captionSegmentsFromJson({ events: [
    { tStartMs: 0, segs: [{ utf8: "Hello\nworld" }] },
    { tStartMs: 65000, segs: [{ utf8: "Next section" }] }
  ] });
  assert.equal(Core.formatTranscriptMarkdown(segments, [
    { title: "Introduction", startMs: 0 },
    { title: "Details", startMs: 65000 }
  ]), [
    "## 0s: Introduction", "", "0s: Hello world", "",
    "## 1m 5s: Details", "", "1m 5s: Next section"
  ].join("\n"));
});

test("transcript chapter timestamps use hour, minute, and second units", () => {
  assert.equal(Core.formatTranscriptMarkdown([
    { startMs: 3723000, text: "Long-form section" }
  ], [
    { title: "Deep dive", startMs: 3723000 }
  ]), "## 1h 2m 3s: Deep dive\n\n1h 2m 3s: Long-form section");
});

test("transcript sentences retain timestamps without chapters and across unit boundaries", () => {
  assert.equal(Core.formatTranscriptMarkdown([
    { startMs: 0, text: "Start." },
    { startMs: 59999, text: "Before a minute." },
    { startMs: 60000, text: "One minute." },
    { startMs: 3600000, text: "One hour." },
    { startMs: 3723000, text: "Later." }
  ], []), [
    "0s: Start.", "59s: Before a minute.", "1m 0s: One minute.",
    "1h 0m 0s: One hour.", "1h 2m 3s: Later."
  ].join("\n"));
});

test("sentences span caption fragments and use the caption containing their first word", () => {
  assert.equal(Core.formatTranscriptMarkdown([
    { startMs: 0, text: "Hello" },
    { startMs: 1000, text: "world. next" },
    { startMs: 2000, text: "sentence!" },
    { startMs: 3000, text: 'He said “Really?”' },
    { startMs: 4000, text: "Yes. All done." }
  ], []), [
    "0s: Hello world.", "1s: next sentence!", "3s: He said “Really?”",
    "4s: Yes.", "4s: All done."
  ].join("\n"));
});

test("sentence timestamps do not split names, abbreviations or decimals", () => {
  assert.equal(Core.formatTranscriptMarkdown([
    { startMs: 0, text: "Dr." },
    { startMs: 1000, text: "Smith paid 3.50 dollars. The U.S." },
    { startMs: 2000, text: "price was lower, e.g. 2.50. Done." }
  ], []), [
    "0s: Dr. Smith paid 3.50 dollars.",
    "1s: The U.S. price was lower, e.g. 2.50.", "2s: Done."
  ].join("\n"));
});

test("unpunctuated captions form one passage without inventing sentence breaks", () => {
  assert.equal(Core.formatTranscriptMarkdown([
    { startMs: 0, text: " " },
    { startMs: 1000, text: "  this is\n" },
    { startMs: 2000, text: "one continuing" },
    { startMs: 3000, text: "passage" }
  ], []), "1s: this is one continuing passage");
});

test("chapter boundaries flush unfinished sentences without losing text", () => {
  assert.equal(Core.formatTranscriptMarkdown([
    { startMs: 0, text: "The first" },
    { startMs: 1000, text: "part" },
    { startMs: 2000, text: "A new" },
    { startMs: 3000, text: "chapter." }
  ], [{ startMs: 2000, title: "Details" }]),
  "0s: The first part\n\n## 2s: Details\n\n2s: A new chapter.");
});

test("sentence punctuation without spaces is supported", () => {
  assert.equal(Core.formatTranscriptMarkdown([
    { startMs: 1000, text: "你好。再见！" }
  ], []), "1s: 你好。\n1s: 再见！");
});

test("chapters after the final caption use the same timestamp format and spacing", () => {
  assert.equal(Core.formatTranscriptMarkdown([
    { startMs: 0, text: "Opening" }
  ], [{ startMs: 65000, title: "End credits" }]),
  "0s: Opening\n\n## 1m 5s: End credits");
  assert.equal(Core.formatTranscriptMarkdown([], []), "");
});

test("transcript failure prompt contains useful context without requesting secrets", () => {
  const prompt = Core.buildTranscriptDebugPrompt({
    error: "Captions returned 403",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    version: "1.0.2"
  });
  assert.match(prompt, /Captions returned 403/);
  assert.match(prompt, /watch\?v=dQw4w9WgXcQ/);
  assert.match(prompt, /StayTube version: 1\.0\.2/);
  assert.match(prompt, /transcript-panel fallback/i);
  assert.match(prompt, /Do not log or share cookies/);
  assert.doesNotMatch(prompt, /api\/timedtext/);
});

test("parseTimestamp converts native transcript timestamps", () => {
  assert.equal(Core.parseTimestamp("1:23"), 83000);
  assert.equal(Core.parseTimestamp("1:02:03"), 3723000);
  assert.equal(Core.parseTimestamp("not a timestamp"), null);
});

test("native transcript rows tolerate current view-model text hydration", () => {
  assert.deepEqual(Core.nativeTranscriptSegment("1:23", "Chapter discussion"), {
    startMs: 83000,
    text: "Chapter discussion"
  });
  assert.deepEqual(Core.nativeTranscriptSegment(null, null, "1:23 Chapter discussion"), {
    startMs: 83000,
    text: "Chapter discussion"
  });
  assert.equal(Core.nativeTranscriptSegment(null, null, "Chapter discussion"), null);
});

test("empty expanded transcript panels are reset before a native retry", () => {
  assert.equal(Core.shouldResetNativeTranscriptPanel({
    expanded: true, loading: false, segmentCount: 0
  }), true);
  assert.equal(Core.shouldResetNativeTranscriptPanel({
    expanded: true, loading: true, segmentCount: 0
  }), false);
  assert.equal(Core.shouldResetNativeTranscriptPanel({
    expanded: true, loading: false, segmentCount: 1
  }), false);
  assert.equal(Core.shouldResetNativeTranscriptPanel({
    expanded: false, loading: false, segmentCount: 0
  }), false);
});

test("native transcript trust requires current ownership or changed rows", () => {
  assert.equal(Core.canTrustNativeTranscriptPanel({
    belongsToCurrentVideo: false,
    changedSinceBaseline: false
  }), false);
  assert.equal(Core.canTrustNativeTranscriptPanel({
    belongsToCurrentVideo: true,
    changedSinceBaseline: false
  }), true);
  assert.equal(Core.canTrustNativeTranscriptPanel({
    belongsToCurrentVideo: false,
    changedSinceBaseline: true
  }), true);
});

test("accessible publication details replace their own prior suffix", () => {
  assert.equal(
    Core.replaceAccessibleLabelDetail("2 days ago", null, "Published July 18 2026 3:00 PM"),
    "2 days ago, Published July 18 2026 3:00 PM"
  );
  assert.equal(
    Core.replaceAccessibleLabelDetail(
      "2 days ago, Published July 18 2026 3:00 PM",
      "Published July 18 2026 3:00 PM",
      "Published July 19 2026 4:00 PM"
    ),
    "2 days ago, Published July 19 2026 4:00 PM"
  );
  assert.equal(
    Core.replaceAccessibleLabelDetail(
      "1 day ago",
      "Published July 17 2026 2:00 PM",
      "Published July 19 2026 4:00 PM"
    ),
    "1 day ago, Published July 19 2026 4:00 PM"
  );
});

test("clipboard denial falls back to the legacy copy path", async () => {
  const calls = [];
  const method = await Core.copyTextWithFallback("transcript", {
    writeText: async () => {
      calls.push("clipboard");
      throw new Error("NotAllowedError");
    },
    legacyCopy: async (text) => {
      calls.push(`legacy:${text}`);
      return true;
    }
  });
  assert.equal(method, "execCommand");
  assert.deepEqual(calls, ["clipboard", "legacy:transcript"]);
});

test("clipboard failure is reported when both copy paths are denied", async () => {
  await assert.rejects(Core.copyTextWithFallback("transcript", {
    writeText: async () => { throw new Error("NotAllowedError"); },
    legacyCopy: async () => false
  }), /browser denied clipboard access/);
});

test("caption parsers support YouTube XML and WebVTT fallbacks", () => {
  assert.deepEqual(Core.captionSegmentsFromXml(
    '<transcript><text start="1.25">Hello &amp; welcome</text></transcript>'
  ), [{ startMs: 1250, text: "Hello & welcome" }]);
  assert.deepEqual(Core.captionSegmentsFromVtt([
    "WEBVTT", "", "00:01.000 --> 00:03.000", "Hello &amp; welcome", ""
  ].join("\n")), [{ startMs: 1000, text: "Hello & welcome" }]);
});
