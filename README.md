# StayTube Listing Details

A small Manifest V3 browser extension that adds two details to YouTube video cards:

- A channel name that is always visible and clickable.
- The video's exact published date and time, displayed in your local timezone.
- Complete listing titles that wrap naturally instead of being truncated with an ellipsis.
- A direct one-click Watch Later button when a supported thumbnail is hovered or keyboard-focused.
- A one-click remove button on playlist rows when the playlist is editable.
- A button on playlist rows that opens the video in a new tab without the playlist context.
- A playlist-page watch-progress gate: two clamped sliders keep only videos watched between the chosen minimum and maximum visible (e.g. at least 80% to surface nearly-finished videos), plus an "Unavailable only" mode that isolates deleted/private entries, with a one-click reset.
- The exact published date and time beside the relative age in a playing video's description.
- A watch-page button that copies the transcript as Markdown with timestamped chapter headings interspersed.

It supports standard grids and lists, search results, sidebar recommendations, playlist rows and panels, Shorts shelves, embedded community-post videos, lockup cards, and YouTube's mobile renderers. YouTube changes its markup regularly, so the extension discovers cards from their video links instead of relying on one page layout.

Watch History's modern horizontal rows keep the exact publication time in the native text column and turn the channel name already shown by YouTube into a channel link, avoiding duplicated channel text or details displaced beside the action menu.

Where YouTube already provides a clickable channel and a relative-date field, the extension reuses the channel and replaces the relative date in place. A compact extra row is only added when a listing type does not provide native metadata slots.

On full playlist pages, YouTube places the view count and relative upload age in a `video-info` row rather than the standard metadata row. StayTube recognizes that playlist-specific slot, keeps the view count intact, and replaces only the relative age with the exact local publication timestamp.

## Install in Chrome, Edge, Brave, or another Chromium browser

1. Open the browser's extensions page (for Chrome, `chrome://extensions`).
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this repository folder.
5. Open or refresh YouTube.

The extension only runs on `www.youtube.com` and `m.youtube.com`. It has no analytics, sends data nowhere else, and stores no browsing history. It requests each visible video's ordinary YouTube watch page to read first-party metadata, then caches the result for the current tab.

## Behavior and limitations

- Times are rendered in the browser's local timezone; hover the timestamp to see its source ISO value.
- Hour- and day-old uploads keep their relative age and add the browser-local time. Week- and month-old uploads keep their relative age and add month, day, and local time. Year-old uploads use `#y ago YYYY Mon dd h:mm AM/PM`, such as `4y ago 2022 Jul 03 2:15 PM`. Visible timestamps omit timezone abbreviations, commas, and bullet separators.
- Cards are loaded shortly before they enter view and lookups are limited to four at a time.
- Newly appended playlist rows are discovered automatically. Rows that YouTube inserts before assigning their video link are picked up as soon as that link is hydrated, so scrolling does not require a page refresh.
- Deleted, private, age-restricted, region-blocked, or consent-gated videos may not expose metadata. In those cases the card explicitly says which value is unavailable.
- If YouTube supplies only a calendar date, the extension labels the exact time as unavailable instead of inventing one.
- If direct timed-text responses are empty or invalid, transcript copying retries through YouTube's native transcript panel. If copying still fails, the button copies a privacy-conscious troubleshooting prompt with the video URL and error without exposing signed caption URLs or authentication data.

## Verify

The metadata parser and listing-selector regressions use Node's built-in test runner and need no dependencies:

```sh
node --test tests/*.test.js
```

## Chrome Web Store release

The store-ready privacy policy, promotional images, screenshot design references, package builder, and click-to-copy dashboard answers live in `store-assets`, `assets`, `PRIVACY.md`, and `scripts/build-store-package.sh`. Real screenshots must be captured from the unpacked extension before submission. Open `store-assets/submission-helper.html` in a browser for the submission checklist and one-click field copying.
