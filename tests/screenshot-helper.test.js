'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'scripts/capture-store-screenshots.cjs'), 'utf8');
function fixture(browser) {
  const scheduled = new Map();
  let nextId = 0, ownedCalls = 0;
  const context = vm.createContext({
    require(name) {
      if (name === 'node:child_process') return { spawnSync() { ownedCalls += 1; return { status: 0, stdout: 'Owned cleanup verified', stderr: '' }; } };
      return require(name);
    },
    __dirname: path.join(root, 'scripts'),
    console: { log() {}, error() {} },
    process: { once() {}, argv: [], env: {} },
    setTimeout(callback, delay) { const id = ++nextId; scheduled.set(id, { callback, delay }); return id; },
    clearTimeout(id) { scheduled.delete(id); }
  });
  const safeSource = source.replace(/\nmain\(\)\.catch\([\s\S]*$/, '');
  assert.notEqual(safeSource, source, 'test must exclude the actual browser-launch entry point');
  vm.runInContext(safeSource + '\n;globalThis.captureTest = { cleanup, setup(b) { browser = b; launch = { profile_dir: "/test-owned-profile" }; } };', context);
  context.captureTest.setup(browser);
  return { api: context.captureTest, scheduled, calls: () => ownedCalls };
}
for (const phase of ['session creation', 'close request']) {
  test(`stalled ${phase} cannot prevent owned cleanup`, async () => {
    const never = new Promise(() => {});
    const browser = phase === 'session creation'
      ? { newBrowserCDPSession: () => never }
      : { newBrowserCDPSession: async () => ({ send: () => never }) };
    const f = fixture(browser);
    const first = f.api.cleanup();
    const second = f.api.cleanup();
    await Promise.resolve();
    assert.equal(f.calls(), 0);
    assert.equal(f.scheduled.size, 1, 'graceful shutdown needs one bounded deadline');
    const [, deadline] = [...f.scheduled][0];
    assert.ok(deadline.delay > 0 && deadline.delay <= 5000);
    deadline.callback();
    await Promise.all([first, second]);
    assert.equal(f.calls(), 1, 'fallback ownership cleanup runs once');
    assert.equal(f.scheduled.size, 0);
  });
}
test('successful graceful close clears its deadline and still verifies owned cleanup', async () => {
  const f = fixture({ newBrowserCDPSession: async () => ({ send: async () => {} }) });
  await f.api.cleanup();
  assert.equal(f.calls(), 1);
  assert.equal(f.scheduled.size, 0);
});
test('retake archive target equals the guide bulk-download target', () => {
  const expression = source.match(/output,\s*(`[^`]+`|"[^"]+"|'[^']+')\]\);/);
  assert.ok(expression, 'capture archive output argument must remain inspectable');
  const generated = vm.runInNewContext(expression[1], { manifest: { version: '1.0.5' } });
  const helper = fs.readFileSync(path.join(root, 'store-assets/submission-helper.html'), 'utf8');
  const linked = helper.match(/href="screenshots\/([^"]+)" download>Download all/);
  assert.ok(linked);
  assert.equal(generated, linked[1]);
});
