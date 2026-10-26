"use strict";

// Capture the installed extension on real YouTube pages. Run from Finder or a
// normal Terminal when the agent workspace cannot launch the isolated runner.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { createRequire } = require("node:module");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "store-assets/screenshots");
const runnerDir = path.join(os.homedir(), ".codex/skills/chrome-extension-test-runner/scripts");
const runner = path.join(runnerDir, "launch_test_chrome.py");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
let browser, launch, cleaning;

function python(args) {
  const result = spawnSync("python3", args, { encoding: "utf8", timeout: 60000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || "Chrome runner failed");
  return result.stdout;
}

function loadPlaywright() {
  try { return require("playwright"); } catch (error) {
    if (error.code !== "MODULE_NOT_FOUND") throw error;
    const modules = process.env.STAYTUBE_NODE_MODULES || path.join(os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules");
    return createRequire(path.join(modules, ".staytube-resolve.cjs"))("playwright");
  }
}

async function cleanup() {
  if (cleaning) return cleaning;
  cleaning = (async () => {
    if (!launch) return;
    if (browser) {
      let closeDeadline;
      try {
        await Promise.race([
          (async () => {
            const session = await browser.newBrowserCDPSession();
            await session.send("Browser.close");
          })(),
          new Promise(resolve => { closeDeadline = setTimeout(resolve, 2000); })
        ]);
      } catch { /* Verify shutdown with the runner's exact ownership record. */ }
      finally { clearTimeout(closeDeadline); }
    }
    python(["-c", [
      "import json,sys",
      "from pathlib import Path",
      "sys.path.insert(0,sys.argv[1])",
      "from test_chrome_owner import cleanup",
      "profile=Path(sys.argv[2])",
      "assert not profile.exists() or cleanup(json.loads((profile/'.test-chrome-owner.json').read_text())), 'Chrome cleanup failed'",
      "print('Cleanup verified: owned browser processes=0, disposable profiles=0')"
    ].join("\n"), runnerDir, launch.profile_dir]);
    console.log("Cleanup verified: owned browser processes=0, disposable profiles=0");
  })();
  return cleaning;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => cleanup().then(() => process.exit(1), error => {
    console.error(error.message); process.exit(1);
  }));
}

async function openYouTube(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  const reject = page.getByRole("button", { name: "Reject all", exact: true });
  if (await reject.isVisible()) await reject.click();
  await page.waitForURL("https://www.youtube.com/**", { timeout: 30000 });
  await page.locator("ytd-masthead #logo").first().waitFor({ state: "visible", timeout: 30000 });
  await page.waitForFunction(() => document.fonts.status === "loaded");
}

async function settleVisibleImages(page) {
  await page.waitForFunction(() => [...document.querySelectorAll("ytd-thumbnail img, yt-thumbnail-view-model img")]
    .filter(image => image.currentSrc && image.getBoundingClientRect().bottom > 0
      && image.getBoundingClientRect().top < innerHeight)
    .every(image => image.complete && image.naturalWidth > 0), null, { timeout: 15000 });
  // YouTube loads its icon sprites and finishes layout after the content rows.
  await page.waitForTimeout(2500);
}

async function verifyWatch(page) {
  await page.locator("ytd-watch-flexy ytd-watch-metadata").waitFor({ timeout: 30000 });
  await page.locator(".staytube-watch-published").waitFor({ timeout: 30000 });
  await page.locator(".staytube-copy-transcript").waitFor({ timeout: 30000 });
  const classic = await page.evaluate(() => {
    const metadata = document.querySelector("ytd-watch-flexy ytd-watch-metadata");
    return Boolean(metadata?.closest("#primary"));
  });
  assert.ok(classic, "The native classic watch layout was not restored; screenshots stopped.");
  if (await page.locator(".ytp-error-content-wrap").isVisible()) {
    throw new Error("YouTube displayed a player error. Resolve it before capturing store images.");
  }
  await page.evaluate(() => document.querySelectorAll("video").forEach(video => video.pause()));
}

async function frameMetadata(page) {
  await page.evaluate(() => {
    const metadata = document.querySelector("ytd-watch-metadata");
    window.scrollTo(0, Math.max(0, metadata.getBoundingClientRect().top + scrollY - 240));
  });
  await page.locator(".staytube-copy-transcript").waitFor({ state: "visible" });
}

async function saveScreenshot(page, name) {
  await settleVisibleImages(page);
  const image = await page.screenshot({ scale: "css", animations: "disabled", timeout: 20000 });
  assert.equal(image.readUInt32BE(16), 1280, "Screenshot width must be 1280");
  assert.equal(image.readUInt32BE(20), 800, "Screenshot height must be 800");
  fs.writeFileSync(path.join(output, name), image);
  console.log(`Saved ${name} (1280×800)`);
}

async function verifyTheater(page) {
  await openYouTube(page, "https://www.youtube.com/watch?v=jNQXAC9IVRw&hl=en");
  await verifyWatch(page);
  const player = page.locator("#movie_player");
  const sizeButton = player.locator(".ytp-size-button");
  for (const width of [1280, 1600, 900]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await player.hover();
    await sizeButton.waitFor({ state: "visible", timeout: 15000 });
    await sizeButton.click();
    await page.waitForFunction(() => document.querySelector("ytd-watch-flexy")?.hasAttribute("theater"));
    await page.waitForFunction(() => {
      const rect = document.querySelector("#movie_player").getBoundingClientRect();
      return Math.abs(rect.left) <= 2 && Math.abs(rect.width - document.documentElement.clientWidth) <= 2;
    }, null, { timeout: 15000 });
    const dimensions = await player.boundingBox();
    console.log(`Theater button: viewport ${width}px, player ${Math.round(dimensions.width)}px wide`);
    assert.equal(await page.evaluate(() => Boolean(document.fullscreenElement)), false);
    if (width === 1280) {
      const image = await page.screenshot({ scale: "css", animations: "disabled" });
      fs.writeFileSync(path.join(os.tmpdir(), "staytube-theater-mode.png"), image);
    }
    // Leave through YouTube's keyboard handler, with focus on the player.
    await player.focus();
    await page.keyboard.press("t");
    await page.waitForFunction(() => !document.querySelector("ytd-watch-flexy")?.hasAttribute("theater"));
    await page.keyboard.press("t");
    await page.waitForFunction(() => document.querySelector("ytd-watch-flexy")?.hasAttribute("theater"));
    await player.hover();
    await sizeButton.click();
    await page.waitForFunction(() => !document.querySelector("ytd-watch-flexy")?.hasAttribute("theater"));
    console.log(`Theater keyboard and normal-size restoration passed at ${width}px`);
  }
  const previousId = new URL(page.url()).searchParams.get("v");
  const related = page.locator('ytd-watch-next-secondary-results-renderer a[href*="/watch?"]').first();
  await Promise.all([
    page.waitForURL(url => url.searchParams.get("v") !== previousId),
    related.click()
  ]);
  const nextId = new URL(page.url()).searchParams.get("v");
  await page.locator(`.staytube-watch-published[data-video-id="${nextId}"]`).waitFor({ timeout: 30000 });
  await player.hover();
  await sizeButton.click();
  await page.waitForFunction(() => {
    const watch = document.querySelector("ytd-watch-flexy");
    const rect = document.querySelector("#movie_player").getBoundingClientRect();
    return watch?.hasAttribute("theater") && Math.abs(rect.width - document.documentElement.clientWidth) <= 2;
  }, null, { timeout: 15000 });
  console.log("Theater mode remains available after YouTube SPA navigation");
}

async function main() {
  assert.ok(fs.existsSync(runner), "The Chrome Extension Test Runner skill is required.");
  const { chromium } = loadPlaywright();
  for (const entry of manifest.content_scripts) {
    for (const file of [...(entry.js || []), ...(entry.css || [])]) {
      assert.ok(fs.existsSync(path.join(root, file)), `Missing extension file: ${file}`);
    }
  }
  if (process.argv.includes("--check")) {
    const plan = JSON.parse(python([runner, "--extension", root, "--dry-run"]));
    console.log(`Capture prerequisites verified for StayTube ${manifest.version}.`);
    console.log(`Runner browser: ${plan.chrome_path || plan.command?.[0] || "available"}`);
    return;
  }
  fs.mkdirSync(output, { recursive: true });
  try {
    console.log(`Starting isolated Chrome for StayTube ${manifest.version}…`);
    launch = JSON.parse(python([runner, "--extension", root,
      "--owner-pid", String(process.pid), "--url", "about:blank"]));
    assert.equal(launch.debugger_ready, true, "Chrome debugger did not become ready");
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${launch.debug_port}`);
    const context = browser.contexts()[0];
    const page = context.pages()[0] || await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });

    if (process.argv.includes("--verify-theater")) {
      await verifyTheater(page);
      return;
    }

    await openYouTube(page, "https://www.youtube.com/results?search_query=NASA+science&hl=en");
    await page.waitForFunction(() => document.querySelectorAll(
      ".staytube-native-published, .staytube-listing-details time"
    ).length >= 3, null, { timeout: 45000 });
    const videoId = await page.evaluate(() => {
      const candidates = [...document.querySelectorAll(
        ".staytube-native-published, .staytube-listing-details time"
      )].map(date => date.closest("ytd-video-renderer, yt-lockup-view-model, ytd-rich-item-renderer"))
        .filter(card => card && !card.closest(
          "ytd-ad-slot-renderer, ad-slot-renderer, ytd-search-pyv-renderer, ytd-promoted-video-renderer"
        ));
      const card = candidates.find(candidate => candidate.textContent.includes("NASA Science")) || candidates[0];
      if (!card) return null;
      const link = [...card.querySelectorAll('a[href*="/watch?"]')].find(anchor =>
        /^[A-Za-z0-9_-]{11}$/.test(new URL(anchor.href).searchParams.get("v")));
      if (!link) return null;
      window.scrollTo(0, card.getBoundingClientRect().top + scrollY - 88);
      return new URL(link.href).searchParams.get("v");
    });
    assert.match(videoId || "", /^[A-Za-z0-9_-]{11}$/, "Could not select a real video for the watch capture");
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}&hl=en`;
    await saveScreenshot(page, "02-listing-publication-details.png");

    await openYouTube(page, watchUrl);
    await verifyWatch(page);
    await frameMetadata(page);
    await saveScreenshot(page, "01-classic-watch-layout.png");

    const expand = page.locator("ytd-watch-metadata #description-inline-expander #expand");
    if (await expand.isVisible()) await expand.click();
    await frameMetadata(page);
    await saveScreenshot(page, "03-description-and-transcript.png");
    python(["-c", [
      "from pathlib import Path",
      "import sys,zipfile",
      "folder=Path(sys.argv[1])",
      "with zipfile.ZipFile(folder / sys.argv[2], 'w', zipfile.ZIP_DEFLATED) as archive:",
      " for name in ['01-classic-watch-layout.png','02-listing-publication-details.png','03-description-and-transcript.png']:",
      "  archive.write(folder / name, name)"
    ].join("\n"), output, "staytube-store-screenshots.zip"]);
    console.log(`Done. Review the three images in ${output} before uploading.`);
  } finally {
    await cleanup();
  }
}

main().catch(error => {
  console.error(`Screenshot capture stopped: ${error.message}`);
  process.exitCode = 1;
});
