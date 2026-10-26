"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

module.exports = async function verifyListingLayout(page) {
  const fixture = fs.readFileSync(path.join(__dirname, "fixtures/listing-layout.html"), "utf8");
  const pattern = "https://www.youtube.com/**";
  const handler = async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/staytube-listing-fixture") {
      await route.fulfill({ contentType: "text/html", body: fixture });
    } else if (url.pathname === "/watch") {
      await route.fulfill({ contentType: "text/html", body: '<meta itemprop="uploadDate" content="2026-10-25T12:34:56-04:00"><script>{"author":"Fixture Channel","channelId":"UC1234567890123456789012","ownerProfileUrl":"https://www.youtube.com/@fixture"}</script>' });
    } else {
      await route.continue();
    }
  };
  await page.route(pattern, handler);
  async function check(id, expectedViews, expectedAge) {
    const card = page.locator(`#${id}`);
    await card.locator("time[datetime]").waitFor();
    const layout = await card.evaluate(element => {
      const times = [...element.querySelectorAll("time[datetime]")];
      const time = times[0];
      const views = element.querySelector(".views");
      const channel = element.querySelector(".staytube-channel");
      return {
        count: times.length,
        timeTop: time.getBoundingClientRect().top,
        viewsBottom: views.getBoundingClientRect().bottom,
        views: views.textContent,
        timeText: time.textContent,
        channelBottom: channel?.getBoundingClientRect().bottom,
        visibleSeparators: [...element.querySelectorAll(".ytContentMetadataViewModelDelimiter")]
          .filter(separator => separator.getClientRects().length).length,
        playlist: element.tagName === "YTD-PLAYLIST-VIDEO-RENDERER",
        cleanLinks: element.querySelectorAll(".staytube-playlist-open-clean").length
      };
    });
    assert.equal(layout.count, 1, `${id}: duplicate timestamp`);
    assert.ok(layout.timeTop >= layout.viewsBottom - 1, `${id}: timestamp shares the views line`);
    assert.equal(layout.views, expectedViews);
    if (expectedAge) assert.ok(layout.timeText.startsWith(expectedAge), `${id}: stale relative age`);
    if (layout.channelBottom) assert.ok(layout.timeTop >= layout.channelBottom - 1, `${id}: timestamp shares the channel line`);
    assert.equal(layout.visibleSeparators, 0, `${id}: orphaned date separator`);
    if (layout.playlist) assert.equal(layout.cleanLinks, 1, `${id}: playlist controls must remain idempotent`);
  }
  try {
    await page.goto("https://www.youtube.com/staytube-listing-fixture", { waitUntil: "domcontentloaded" });
    await check("initial", "1,234 views");
    await check("modern", "5,678 views");
    await check("fallback", "42 views");
    await check("playlist", "321 views");
    await page.evaluate(() => {
      document.getElementById("appended").innerHTML = '<ytd-playlist-video-renderer id="later"><a href="/watch?v=appended001&list=fixture">Appended playlist row</a><div id="metadata"><a href="/@fixture">Fixture Channel</a><div id="video-info"><span class="views">9,876 views</span><span>3 days ago</span></div></div><div id="menu"></div></ytd-playlist-video-renderer>';
      document.getElementById("hydrated").innerHTML = '<yt-lockup-view-model id="lazy"><div class="ytLockupMetadataViewModelTextContainer"></div></yt-lockup-view-model>';
    });
    await check("later", "9,876 views");
    await page.locator("#lazy .ytLockupMetadataViewModelTextContainer").evaluate(element => {
      element.innerHTML = '<a href="/watch?v=hydrated001">Hydrated lockup</a>';
    });
    await page.locator("#lazy time[datetime]").waitFor();
    await page.locator("#lazy .ytLockupMetadataViewModelTextContainer").evaluate(element => {
      element.insertAdjacentHTML("beforeend", '<yt-content-metadata-view-model><div class="ytContentMetadataViewModelMetadataRow"><span class="ytContentMetadataViewModelMetadataText views">7,654 views</span><span class="ytContentMetadataViewModelDelimiter">•</span><span class="ytContentMetadataViewModelMetadataText">4 days ago</span></div></yt-content-metadata-view-model>');
    });
    await page.locator("#lazy .staytube-native-published").waitFor();
    await check("lazy", "7,654 views", "4 days ago");
    await page.locator("#lazy .staytube-native-date-host").evaluate(element => { element.textContent = "5 days ago"; });
    await page.locator("#lazy .staytube-native-published").waitFor();
    await check("lazy", "7,654 views", "5 days ago");
    // Recycling a card must not retain a stale layout marker or timestamp.
    await page.locator("#later > a[href*=watch]").evaluate(link => { link.href = "/watch?v=recycled001"; });
    await page.locator('#later[data-staytube-video-id="recycled001"] time[datetime]').waitFor();
    for (const width of [1280, 640]) {
      await page.setViewportSize({ width, height: 900 });
      for (const [id, views] of [["initial", "1,234 views"], ["modern", "5,678 views"], ["fallback", "42 views"], ["playlist", "321 views"], ["later", "9,876 views"], ["lazy", "7,654 views"]]) await check(id, views);
    }
    await page.screenshot({ path: path.join(os.tmpdir(), "staytube-listing-layout-fixture.png"), scale: "css" });
    console.log("Listing fixture passed: classic, lockup, fallback, appended, lazily hydrated, rehydrated and recycled rows at 1280px and 640px");
  } finally {
    await page.unroute(pattern, handler);
  }
};
