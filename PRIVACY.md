# StayTube Privacy Policy

Effective date: October 22, 2026

StayTube is a browser extension that enhances YouTube listings, playlists, and watch pages. This policy explains the limited data the extension handles to provide those features.

## Data the extension handles

StayTube processes the following information locally in your browser while you use YouTube:

- The address of the YouTube page and video links on that page.
- YouTube page content needed for the extension's features, such as video titles, channel names, publication metadata, playlist state, watch progress indicators, and transcript text.
- YouTube responses requested for a visible video when publication details or transcript data are needed.

StayTube does not collect names, email addresses, payment information, authentication credentials, or form entries. It does not read browser history outside the YouTube pages on which it runs.

## How the data is used

The extension uses this information only to add its user-facing features to YouTube: the classic desktop watch layout, clickable channel names, exact local publication times, complete titles, playlist tools, Watch Later controls, clean video links, and transcript copying. Transcript text is written to the clipboard only after you press the copy button.

To restore the desktop layout, a bundled script runs in YouTube's page context before the page initializes. It changes only the layout experiment settings and native watch-page layout properties needed to keep the description and comments inline. It does not send page data to the extension developer or execute downloaded code.

Metadata requests are sent directly from your browser to YouTube over HTTPS. These authenticated same-origin requests may include browser-managed YouTube cookies. StayTube does not directly read or store those cookies, and it does not send them to the developer or anywhere other than YouTube.

## Storage and retention

StayTube keeps fetched video metadata only in memory for the current browser tab. It does not create a browsing-history database or persist user data after the tab is closed or reloaded. Clipboard contents are controlled by your operating system and browser after you choose to copy a transcript.

## Sharing and sale

StayTube has no developer-operated server, analytics, advertising, tracking, or data broker integration. The developer does not receive, sell, rent, or share your data. Information requested from YouTube remains subject to YouTube's own terms and privacy policy.

## Limited Use disclosure

StayTube's use of information received from Google services adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements. Data is used only to provide the extension's disclosed, user-facing features. It is not used for advertising, credit decisions, or any purpose unrelated to those features, and humans cannot access it through the extension.

## Changes

If StayTube's data practices change, this policy and the Chrome Web Store disclosures will be updated before the changed version is published.

## Contact

For support, questions, or privacy requests, open an issue on the [StayTube support page](https://github.com/KyleStay/StayTube/issues).
