# StayTube 1.0.7 listing-layout update

Prepared October 26, 2026. Version 1.0.7 places listing release dates on their own line and includes the native theater-mode fix. The public GitHub repository provides the homepage, support, and privacy-policy URLs. This local update has not been uploaded to the store.

## Changes

- Show the release timestamp on its own full-width line in classic cards, modern lockups, playlist rows, and fallback details. Preserve native channel links/view counts and hide only the adjacent date separator. Newly appended, hydrated, and recycled rows keep the same layout without duplicate dates or controls.

- Keep the native theater button and `T` shortcut available on desktop and narrow windows. Theater mode uses YouTube's full-width player; toggling back restores normal size. StayTube does not force theater mode on or overwrite the user's selected size.
- Restore YouTube's native classic desktop watch layout: description, publication date, and comments below the player; recommendations in the sidebar. A bundled MAIN-world script runs at document start to disable alternative watch-layout experiments. It also resets native side-menu properties on watch-page hydration and navigation, without moving or duplicating description/comment nodes.
- Restore publication timestamps and transcript buttons after YouTube removes them during a re-render. Discover dates hydrated only through `aria-label`, keep the accessible publication detail synchronized, and clear the previous video's timestamp while the next lookup is pending.
- Match the current native transcript-button icon-size styling.
- Update the manifest, privacy policy, store copy, reviewer instructions, and package builder. No additional permissions or website access were added. Chrome 111 or newer is required for the declarative MAIN-world script.

## Artifacts and verified checks

- Upload archive: `dist/staytube-1.0.7-chrome-web-store.zip`.
- SHA-256: `dist/staytube-1.0.7-chrome-web-store.zip.sha256`.
- Rebuild: `bash .ci/local.sh` (Node.js and Python 3.9+). All CI runs locally.
- Source/helper tests cover initial/appended/hydrated listing discovery, early YouTube configuration, native side-menu resets, theater rollout flags and selected size, SPA navigation, watch-control recovery, captions, and clipboard behavior.
- `bash .ci/local.sh` passed: all 87 source/helper tests, JavaScript syntax, archive integrity and package construction. ZIP/source equality and checksum verification are also required before upload. The logger uses a regular file instead of process substitution and preserves failing build exit codes.
- The listing browser fixture passed for initial classic/lockup/fallback/playlist cards, appended playlist rows, delayed link/metadata hydration, native rehydration, and recycled rows at 1280 and 640 pixels. Checks require the timestamp below the view count/channel, intact view counts, no orphan separator, and one timestamp/playlist control. Current live YouTube screenshots were visually inspected to confirm the separate release line.
- Live 1.0.7 theater verification passed at viewport widths 1280, 1600, and 900 pixels: the player matched the available page width (1265, 1585, and 885 pixels after the scrollbar), the size button and `T` both entered/exited theater mode, and the control remained available after a YouTube SPA video change. Theater did not enter browser full screen. Owned browser processes and disposable profiles were verified at zero after cleanup.
- All bundled JavaScript passes `node --check`. The ZIP passes integrity and manifest-file checks and contains only nine runtime files: the manifest, four icons, three JavaScript files, and one CSS file.
- Manifest summary is 128 characters. Icons are 16, 32, 48, and 128 pixels square. Existing promotional images are 440×280 and 1400×560.
- A fresh public YouTube watch response still parses the channel and exact publication timestamp. The layout switch and inline-description/comment conditions were inspected in YouTube's current public UI source. These source checks do not establish live visual compatibility with every account experiment.
- Live screenshot capture ran in a signed-out, disposable Chrome for Testing profile with host execution after the user requested agent-operated capture. The run checked native classic watch-metadata placement, publication timestamps, and the transcript control, and saved three 1280×800 PNGs. Images were visually inspected. Browser/process cleanup is verified separately by the runner. These checks do not cover signed-in playlist editing, clipboard output, or every responsive layout.

## Remaining submission checks

1. In an environment where the isolated Chrome for Testing runner is permitted, install this unpacked build and reload existing YouTube tabs. Confirm a real watch page has its title/actions, description/date, and comments below the player. Expand the description, load more comments, sort comments, and check that recommendations remain usable. Include the account receiving the new layout experiment.
2. Navigate between two videos using YouTube links, then use Back/Forward. Confirm the layout persists, publication dates belong to the current video, and there is one working transcript button. Test normal, theater, and full-screen modes, a narrow desktop window, and light/dark themes. Confirm mobile retains its native layout.
3. Verify one initially rendered listing and one subsequently appended or hydrated listing on search and playlist pages. Confirm channel links and dates, clean-video links, and watch-progress filtering. With a signed-in account, check Watch Later and removal from an editable playlist.
4. Copy a captioned video's transcript and paste it into a text editor. Check sentence timestamps and chapter headings. Check a video without captions reports failure and a video change during copying never copies the wrong transcript.
5. Upload the three real 1280×800 PNGs in `store-assets/screenshots/`, previewed in the HTML guide. To retake them, run `Capture Store Screenshots.command` from Finder or `node scripts/capture-store-screenshots.cjs` in a normal Terminal. The files under `store-assets/mockups/` are design references and must not be submitted as real screenshots.
6. Enter the public [repository](https://github.com/KyleStay/StayTube) as the homepage, [Issues](https://github.com/KyleStay/StayTube/issues) for support, and [PRIVACY.md](https://github.com/KyleStay/StayTube/blob/main/PRIVACY.md) as the privacy policy. These URLs are populated in the HTML guide. Keep the policy on `main` synchronized with the extension's behavior.
7. Use `store-assets/submission-helper.html` for the listing and privacy answers. Disclose Website content and Web history processing, including local processing; justify clipboardWrite and the two YouTube content-script matches. Confirm the public policy and dashboard describe the same behavior. Upload the ZIP, 128-pixel icon, real screenshots, and optional promotional images, then submit through the developer account.

## Existing store identity

- Canonical listing: [StayTube Listing Details](https://chromewebstore.google.com/detail/staytube-listing-details/dendmbjihbflekjlbfofggaiipplagap).
- Store/browser: Chrome Web Store; publisher: `staytechco`; item ID: `dendmbjihbflekjlbfofggaiipplagap`.
- Public listing and Google's signed CRX3 package both report 1.0.5, verified October 26, 2026. The CRX3 signature was verified with an identity-matching public key; public-key SHA-256: `34d3c198715b4a9b15e566088ffb060f9812bd6b927eb32647304ae599a4e370`.
- Upload the 1.0.7 ZIP to that existing item after confirming there is no equal or higher private uploaded draft. The public check does not reveal private draft versions. No private key is needed, and the development directory's unpacked ID is not evidence of the store identity.

## Store references

- [Image requirements](https://developer.chrome.com/docs/webstore/images): store icon, real screenshots, and promotional image formats.
- [Privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy): purpose, permissions, remote code, and policy URL.
- [User-data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq): local data processing still requires disclosure.
- [Content-script declarations](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts): document-start injection and execution worlds.

## Source reconciliation — October 23, 2026

The October 23 source reconciliation matched published 1.0.5 and added the screenshot workflow without changing runtime behavior. The original versioned screenshot bundle retains its 1.0.4 capture provenance. Current preview PNGs are retaken from 1.0.7 to show the new listing layout; 1.0.7 also includes the theater-mode fix developed for 1.0.6. Build output names follow the manifest version. No store submission is performed by these scripts.
