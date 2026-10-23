# StayTube 1.0.5 source and store handoff

Prepared October 22, 2026. The package and three real store screenshots are ready. Complete the remaining behavior checks before submission. The public GitHub repository provides the homepage, support, and privacy-policy URLs.

## Changes

- Restore YouTube's native classic desktop watch layout: description, publication date, and comments below the player; recommendations in the sidebar. A bundled MAIN-world script runs at document start to disable alternative watch-layout experiments. It also resets native side-menu properties on watch-page hydration and navigation, without moving or duplicating description/comment nodes.
- Restore publication timestamps and transcript buttons after YouTube removes them during a re-render. Discover dates hydrated only through `aria-label`, keep the accessible publication detail synchronized, and clear the previous video's timestamp while the next lookup is pending.
- Match the current native transcript-button icon-size styling.
- Update the manifest, privacy policy, store copy, reviewer instructions, and package builder. No additional permissions or website access were added. Chrome 111 or newer is required for the declarative MAIN-world script.

## Artifacts and verified checks

- Upload archive: `dist/staytube-1.0.5-chrome-web-store.zip`.
- SHA-256: `dist/staytube-1.0.5-chrome-web-store.zip.sha256`.
- Rebuild: `sh scripts/build-store-package.sh` (Node.js and Python 3.9+).
- 81 Node tests pass, including initial/appended/hydrated listing discovery, early YouTube configuration, native side-menu resets, SPA navigation, watch-control recovery, captions, and clipboard behavior.
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

The extension has not been uploaded or submitted. Google reviews store submissions independently.

## Store references

- [Image requirements](https://developer.chrome.com/docs/webstore/images): store icon, real screenshots, and promotional image formats.
- [Privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy): purpose, permissions, remote code, and policy URL.
- [User-data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq): local data processing still requires disclosure.
- [Content-script declarations](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts): document-start injection and execution worlds.

## Source reconciliation — October 23, 2026

The canonical manifest is 1.0.5, matching the currently published signed package. Runtime files are unchanged from published 1.0.5. This source landing adds the screenshot workflow and existing signed-out store images; it does not require another extension publication or version bump. The screenshots retain their original 1.0.4 capture provenance because that runtime is byte-identical. Build output names follow the manifest version. No store submission is performed by these scripts.
