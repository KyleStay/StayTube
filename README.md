# StayTube Listing Details

A small Manifest V3 browser extension that adds details and shortcuts to YouTube listings and watch pages:

- A channel name that is always visible and clickable.
- The classic desktop watch layout, with the description, publication date, and comments below the player and recommendations beside it.
- Native full-width theater mode, using YouTube's size button or the `T` shortcut, including when YouTube's layout experiment disables it.
- The video's exact published date and time, displayed in your local timezone on its own line below the native listing metadata.
- Complete listing titles that wrap naturally instead of being truncated with an ellipsis.
- A direct one-click Watch Later button when a supported thumbnail is hovered or keyboard-focused.
- A one-click remove button on playlist rows when the playlist is editable.
- A button on playlist rows that opens the video in a new tab without the playlist context.
- A playlist-page watch-progress gate: two clamped sliders keep only videos watched between the chosen minimum and maximum visible (e.g. at least 80% to surface nearly-finished videos), plus an "Unavailable only" mode that isolates deleted/private entries, with a one-click reset.
- The exact published date and time beside the relative age in a playing video's description.
- A watch-page button that copies the transcript as Markdown with timestamped chapter headings interspersed.

It supports standard grids and lists, search results, sidebar recommendations, playlist rows and panels, Shorts shelves, embedded community-post videos, lockup cards, and YouTube's mobile renderers. YouTube changes its markup regularly, so the extension discovers cards from their video links instead of relying on one page layout.

Watch History's modern horizontal rows keep the exact publication time in the native text column and turn the channel name already shown by YouTube into a channel link, avoiding duplicated channel text or details displaced beside the action menu.

Where YouTube already provides a clickable channel and a relative-date field, the extension reuses the channel and replaces the relative date in place, giving that date its own full-width line while preserving view counts. A compact extra row is only added when a listing type does not provide native metadata slots.

On full playlist pages, YouTube places the view count and relative upload age in a `video-info` row rather than the standard metadata row. StayTube recognizes that playlist-specific slot, keeps the view count intact, and replaces only the relative age with the exact local publication timestamp.

## Install in Chrome, Edge, Brave, or another Chromium browser

1. Open the browser's extensions page (for Chrome, `chrome://extensions`).
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this repository folder.
5. Open or refresh YouTube.

The extension only runs on `www.youtube.com` and `m.youtube.com`. It has no analytics, sends data nowhere else, and stores no browsing history. It requests each visible video's ordinary YouTube watch page to read first-party metadata, then caches the result for the current tab.

## Behavior and limitations

- Desktop layout restoration takes effect on a fresh YouTube page load. After installing or updating StayTube, reload existing YouTube tabs. It disables the grid and side-rail layout experiments before YouTube initializes, then resets native side-menu properties when watch pages hydrate or change videos. It uses YouTube's own inline description and comments; it does not copy or relocate those panels. Mobile retains its native layout. Chrome 111 or newer is required.
- Times are rendered in the browser's local timezone; hover the timestamp to see its source ISO value.
- Hour- and day-old uploads keep their relative age and add the browser-local time. Week- and month-old uploads keep their relative age and add month, day, and local time. Year-old uploads use `#y ago YYYY Mon dd h:mm AM/PM`, such as `4y ago 2022 Jul 03 2:15 PM`. Visible timestamps omit timezone abbreviations, commas, and bullet separators.
- Cards are loaded shortly before they enter view and lookups are limited to four at a time.
- Newly appended playlist rows are discovered automatically. Rows that YouTube inserts before assigning their video link are picked up as soon as that link is hydrated, so scrolling does not require a page refresh.
- Deleted, private, age-restricted, region-blocked, or consent-gated videos may not expose metadata. In those cases the card explicitly says which value is unavailable.
- If YouTube supplies only a calendar date, the extension labels the exact time as unavailable instead of inventing one.
- If direct timed-text responses are empty or invalid, transcript copying retries through YouTube's native transcript panel. If copying still fails, the button copies a privacy-conscious troubleshooting prompt with the video URL and error without exposing signed caption URLs or authentication data.
- Copied transcripts join caption fragments into sentences, with one timestamp at each sentence's start, such as `1h 2m 3s: Transcript sentence.` The timestamp comes from the caption containing the sentence's first word. Shorter times omit leading zero units (`5s:`, `2m 10s:`). Captions without punctuation remain one passage per chapter. Chapters use headings such as `## 2m 10s: Chapter title`, separated by blank lines.
- Copy transcript reuses the native tonal button classes, touch feedback, and `yt-light-shape` gradient rim from a neighboring YouTube action. It upgrades automatically when those controls hydrate.
- Transcript requests time out instead of leaving the button stuck indefinitely. If you navigate to a different video while a transcript is loading, StayTube discards that result without copying it or opening the new video's transcript panel.
- Publication dates updated only through an accessible label are discovered automatically. Watch timestamps and transcript buttons are restored when YouTube removes them during a re-render, and the previous video's publication time is cleared before a new lookup finishes.

## Verify

Run `bash .ci/local.sh` for the full local guard, tests, syntax checks, and package build. The metadata parser and listing-selector regressions also use Node's built-in test runner directly and need no dependencies:

```sh
node --test tests/*.test.js
```

Three real 1280×800 store screenshots are included under `store-assets/screenshots/`. To retake them, double-click `Capture Store Screenshots.command` in Finder, or run `node scripts/capture-store-screenshots.cjs` in a normal Terminal. The tool uses the installed Codex workspace Playwright runtime and the Chrome Extension Test Runner skill, launches only a disposable Chrome for Testing profile, checks StayTube's page controls, and verifies browser/profile cleanup. `node scripts/capture-store-screenshots.cjs --check` checks prerequisites without launching a browser. Host execution is required when the agent workspace blocks the runner's `/bin/ps` ownership preflight.

## Chrome Web Store release

Run `bash .ci/local.sh` to run local verification and build `dist/staytube-1.0.7-chrome-web-store.zip` with a SHA-256 checksum. The archive includes only manifest-declared runtime files and icons. Use `node scripts/capture-store-screenshots.cjs --verify-listings` for browser geometry checks on initial, appended, hydrated, recycled, and playlist rows, including narrow windows. Use `node scripts/capture-store-screenshots.cjs --verify-theater` for isolated live checks of the size button, `T` shortcut, player width, and YouTube navigation.

Open `store-assets/submission-helper.html` for listing copy, permission justifications, and reviewer instructions. See [RELEASE.md](RELEASE.md) for verification evidence and the remaining submission checks. The images in `store-assets/mockups` are design references; capture real screenshots before submission.

Use the public [repository](https://github.com/KyleStay/StayTube) as the store homepage, [GitHub Issues](https://github.com/KyleStay/StayTube/issues) for support, and [PRIVACY.md](https://github.com/KyleStay/StayTube/blob/main/PRIVACY.md) as the privacy-policy URL.
