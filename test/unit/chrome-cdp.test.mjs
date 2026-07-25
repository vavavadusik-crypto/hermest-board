import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  buildSceneBrowserArgs,
  openSceneBrowser,
  resolveCaptureWorkerCount
} from "../../src/media/chrome-cdp.js";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PNG_BASE64 = PNG_BYTES.toString("base64");
const BROWSER_TARGET_PATH = "/devtools/browser/8f2c1d4e-aaaa-bbbb-cccc-0123456789ab";

test("browser argv follows the exact locked schema and binds debugging to loopback", () => {
  const argv = buildSceneBrowserArgs({
    profileDir: "/tmp/run/chrome-profile",
    width: 1920,
    height: 1080
  });
  assert.deepEqual(argv, [
    "--headless=new",
    "--disable-gpu",
    "--disable-extensions",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    "--user-data-dir=/tmp/run/chrome-profile",
    "--window-size=1920,1080",
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=0",
    "about:blank"
  ]);
});

test("browser argv rejects unsafe profile paths and bogus dimensions", () => {
  assert.throws(() => buildSceneBrowserArgs({
    profileDir: "/tmp/run/../etc",
    width: 1920,
    height: 1080
  }), TypeError);
  assert.throws(() => buildSceneBrowserArgs({
    profileDir: "/tmp/run/profile dir",
    width: 1920,
    height: 1080
  }), TypeError);
  assert.throws(() => buildSceneBrowserArgs({
    profileDir: "/tmp/run/profile",
    width: 0,
    height: 1080
  }), TypeError);
  assert.throws(() => buildSceneBrowserArgs({
    profileDir: "/tmp/run/profile",
    width: 1920,
    height: 99999
  }), TypeError);
});

test("capture worker count stays within the measured saturation range", () => {
  assert.equal(resolveCaptureWorkerCount({ env: {}, parallelism: 1 }), 1);
  assert.equal(resolveCaptureWorkerCount({ env: {}, parallelism: 2 }), 1);
  assert.equal(resolveCaptureWorkerCount({ env: {}, parallelism: 4 }), 3);
  assert.equal(resolveCaptureWorkerCount({ env: {}, parallelism: 32 }), 4);
  assert.equal(resolveCaptureWorkerCount({ env: { HERMEST_SCENE_CAPTURE_WORKERS: "2" }, parallelism: 32 }), 2);
  assert.equal(resolveCaptureWorkerCount({ env: { HERMEST_SCENE_CAPTURE_WORKERS: "99" }, parallelism: 8 }), 4);
  assert.equal(resolveCaptureWorkerCount({ env: { HERMEST_SCENE_CAPTURE_WORKERS: "nope" }, parallelism: 8 }), 4);
});

test("scene browser captures frames over one CDP session and terminates the process on close", async () => {
  const profileDir = await mkdtemp(path.join(os.tmpdir(), "cdp-session-"));
  try {
    const harness = createHarness({ profileDir, width: 1920, height: 1080 });
    const browser = await openSceneBrowser({
      profileDir,
      width: 1920,
      height: 1080,
      workerCount: 1,
      spawnImpl: harness.spawnImpl,
      webSocketImpl: harness.webSocketImpl
    });
    assert.equal(harness.spawned.length, 1, "exactly one chrome process for the whole render");
    assert.equal(browser.launchArgv.at(-1), "about:blank");
    assert.equal(browser.workerCount, 1);

    await browser.openScene({ htmlFile: "/tmp/run/scene-001.html", transparent: false });
    const first = await browser.captureFrame(0);
    const second = await browser.captureFrame(233);
    assert.ok(Buffer.isBuffer(first) && first.equals(PNG_BYTES));
    assert.ok(second.equals(PNG_BYTES));

    // Каждый кадр — свежий документ; уникальный query нужен потому, что смена
    // одного лишь фрагмента документ не перезагружает.
    const navigations = harness.socket.sent.filter(m => m.method === "Page.navigate").map(m => m.params.url);
    assert.deepEqual(navigations, [
      "file:///tmp/run/scene-001.html?f=0#t=0",
      "file:///tmp/run/scene-001.html?f=233#t=233"
    ]);
    assert.equal(harness.socket.sent.filter(m => m.method === "Page.captureScreenshot").length, 2);
    assert.deepEqual(
      harness.socket.sent.filter(m => m.method === "Emulation.setDeviceMetricsOverride").map(m => m.params),
      [{ width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false }]
    );
    assert.ok(
      harness.socket.sent.every(m => typeof m.sessionId === "string" || m.method.startsWith("Target.")),
      "page-scoped commands carry the flat CDP session id"
    );

    await browser.close();
    assert.ok(
      harness.socket.sent.some(m => m.method === "Browser.close"),
      "the browser is shut down gracefully so it can flush its profile"
    );
    assert.deepEqual(harness.child.kills, [], "a graceful shutdown needs no signal");
    assert.equal(harness.socket.closed, true);
  } finally {
    await rm(profileDir, { recursive: true, force: true });
  }
});

test("scene browser builds a tab pool and routes frames to the requested worker", async () => {
  const profileDir = await mkdtemp(path.join(os.tmpdir(), "cdp-pool-"));
  try {
    const harness = createHarness({ profileDir, width: 1920, height: 1080 });
    const browser = await openSceneBrowser({
      profileDir,
      width: 1920,
      height: 1080,
      workerCount: 3,
      spawnImpl: harness.spawnImpl,
      webSocketImpl: harness.webSocketImpl
    });
    try {
      assert.equal(browser.workerCount, 3);
      assert.equal(
        harness.socket.sent.filter(m => m.method === "Target.createTarget").length,
        2,
        "the launch tab is reused, only the extra tabs are created"
      );
      await browser.openScene({ htmlFile: "/tmp/run/scene-001.html", transparent: true });
      assert.equal(
        harness.socket.sent.filter(m => m.method === "Emulation.setDefaultBackgroundColorOverride").length,
        3,
        "the transparent override is applied to every tab in the pool"
      );
      await Promise.all([0, 1, 2].map(workerIndex => browser.captureFrame(workerIndex * 33, workerIndex)));
      const shots = harness.socket.sent.filter(m => m.method === "Page.captureScreenshot");
      assert.equal(shots.length, 3);
      assert.equal(new Set(shots.map(m => m.sessionId)).size, 3, "each frame is captured on its own tab");
      await assert.rejects(browser.captureFrame(0, 7), RangeError);
    } finally {
      await browser.close();
    }
  } finally {
    await rm(profileDir, { recursive: true, force: true });
  }
});

test("scene browser refuses to capture before a scene is opened", async () => {
  const profileDir = await mkdtemp(path.join(os.tmpdir(), "cdp-noscene-"));
  try {
    const harness = createHarness({ profileDir, width: 1920, height: 1080 });
    const browser = await openSceneBrowser({
      profileDir,
      width: 1920,
      height: 1080,
      workerCount: 1,
      spawnImpl: harness.spawnImpl,
      webSocketImpl: harness.webSocketImpl
    });
    try {
      await assert.rejects(browser.captureFrame(0), /No scene is open/);
      await browser.openScene({ htmlFile: "/tmp/run/scene-001.html" });
      await assert.rejects(browser.captureFrame(-1), RangeError);
      await assert.rejects(browser.captureFrame(600001), RangeError);
    } finally {
      await browser.close();
    }
  } finally {
    await rm(profileDir, { recursive: true, force: true });
  }
});

test("scene browser applies the transparent background override only for overlay scenes", async () => {
  const profileDir = await mkdtemp(path.join(os.tmpdir(), "cdp-overlay-"));
  try {
    const harness = createHarness({ profileDir, width: 1080, height: 1920 });
    const browser = await openSceneBrowser({
      profileDir,
      width: 1080,
      height: 1920,
      workerCount: 1,
      spawnImpl: harness.spawnImpl,
      webSocketImpl: harness.webSocketImpl
    });
    await browser.openScene({ htmlFile: "/tmp/run/scene-001.html", transparent: false });
    await browser.openScene({ htmlFile: "/tmp/run/scene-002.html", transparent: true });
    const overrides = harness.socket.sent
      .filter(m => m.method === "Emulation.setDefaultBackgroundColorOverride")
      .map(m => m.params);
    assert.deepEqual(overrides, [{}, { color: { r: 0, g: 0, b: 0, a: 0 } }]);
    await browser.close();
  } finally {
    await rm(profileDir, { recursive: true, force: true });
  }
});

test("scene browser kills the process when the DevTools endpoint never appears", async () => {
  const profileDir = await mkdtemp(path.join(os.tmpdir(), "cdp-nolaunch-"));
  try {
    const child = createFakeChild();
    child.stderr.write("Chrome could not start\n");
    await assert.rejects(
      openSceneBrowser({
        profileDir,
        width: 1920,
        height: 1080,
        launchTimeoutMs: 120,
        spawnImpl: () => child,
        webSocketImpl: class NeverUsed {}
      }),
      /did not publish a DevTools endpoint/
    );
    assert.deepEqual(child.kills, ["SIGTERM"], "a failed launch must not leak the process");
  } finally {
    await rm(profileDir, { recursive: true, force: true });
  }
});

test("scene browser rejects an unusable DevTools endpoint", async () => {
  const profileDir = await mkdtemp(path.join(os.tmpdir(), "cdp-badport-"));
  try {
    const child = createFakeChild();
    await writeFile(path.join(profileDir, "DevToolsActivePort"), "0\n/devtools/browser/../../etc\n", "utf8");
    await assert.rejects(
      openSceneBrowser({
        profileDir,
        width: 1920,
        height: 1080,
        launchTimeoutMs: 500,
        spawnImpl: () => child,
        webSocketImpl: class NeverUsed {}
      }),
      /unusable DevTools endpoint/
    );
    assert.deepEqual(child.kills, ["SIGTERM"]);
  } finally {
    await rm(profileDir, { recursive: true, force: true });
  }
});

test("scene browser fails closed when chrome dies during launch", async () => {
  const profileDir = await mkdtemp(path.join(os.tmpdir(), "cdp-crash-"));
  try {
    const child = createFakeChild();
    setTimeout(() => {
      child.stderr.write("fatal: no usable sandbox\n");
      child.emit("exit", 1, null);
    }, 20);
    await assert.rejects(
      openSceneBrowser({
        profileDir,
        width: 1920,
        height: 1080,
        launchTimeoutMs: 5000,
        spawnImpl: () => child,
        webSocketImpl: class NeverUsed {}
      }),
      /chrome exited 1/
    );
  } finally {
    await rm(profileDir, { recursive: true, force: true });
  }
});

test("scene browser rejects a viewport that does not match the recipe", async () => {
  const profileDir = await mkdtemp(path.join(os.tmpdir(), "cdp-viewport-"));
  try {
    const harness = createHarness({ profileDir, width: 1920, height: 1080, reportedViewport: [1920, 1040] });
    await assert.rejects(
      openSceneBrowser({
        profileDir,
        width: 1920,
        height: 1080,
        workerCount: 1,
        spawnImpl: harness.spawnImpl,
        webSocketImpl: harness.webSocketImpl
      }),
      /viewport is 1920x1040, expected 1920x1080/
    );
    assert.ok(harness.socket.sent.some(m => m.method === "Browser.close"), "a rejected launch still shuts down");
  } finally {
    await rm(profileDir, { recursive: true, force: true });
  }
});

test("scene browser surfaces page-side evaluation failures", async () => {
  const profileDir = await mkdtemp(path.join(os.tmpdir(), "cdp-eval-"));
  try {
    const harness = createHarness({ profileDir, width: 1920, height: 1080, failFonts: true });
    const browser = await openSceneBrowser({
      profileDir,
      width: 1920,
      height: 1080,
      workerCount: 1,
      spawnImpl: harness.spawnImpl,
      webSocketImpl: harness.webSocketImpl
    });
    try {
      await browser.openScene({ htmlFile: "/tmp/run/scene-001.html" });
      await assert.rejects(browser.captureFrame(0), /rejected scene evaluation: TypeError: boom/);
    } finally {
      await browser.close();
    }
    assert.ok(harness.socket.sent.some(m => m.method === "Browser.close"));
  } finally {
    await rm(profileDir, { recursive: true, force: true });
  }
});

test("scene browser falls back to SIGTERM when chrome ignores a graceful shutdown", async () => {
  const profileDir = await mkdtemp(path.join(os.tmpdir(), "cdp-stuck-"));
  try {
    const harness = createHarness({ profileDir, width: 1920, height: 1080, ignoreBrowserClose: true });
    const browser = await openSceneBrowser({
      profileDir,
      width: 1920,
      height: 1080,
      workerCount: 1,
      gracefulCloseMs: 40,
      spawnImpl: harness.spawnImpl,
      webSocketImpl: harness.webSocketImpl
    });
    await browser.close();
    assert.deepEqual(harness.child.kills, ["SIGTERM"], "a hung browser must still be terminated");
  } finally {
    await rm(profileDir, { recursive: true, force: true });
  }
});

test("scene browser surfaces navigation and CDP errors", async () => {
  const profileDir = await mkdtemp(path.join(os.tmpdir(), "cdp-naverr-"));
  try {
    const harness = createHarness({ profileDir, width: 1920, height: 1080, navigationError: "net::ERR_FILE_NOT_FOUND" });
    const browser = await openSceneBrowser({
      profileDir,
      width: 1920,
      height: 1080,
      workerCount: 1,
      spawnImpl: harness.spawnImpl,
      webSocketImpl: harness.webSocketImpl
    });
    try {
      await browser.openScene({ htmlFile: "/tmp/run/scene-001.html" });
      await assert.rejects(browser.captureFrame(0), /failed to load scene markup: net::ERR_FILE_NOT_FOUND/);
    } finally {
      await browser.close();
    }
  } finally {
    await rm(profileDir, { recursive: true, force: true });
  }
});

test("scene browser rejects an out-of-range worker pool", async () => {
  const profileDir = await mkdtemp(path.join(os.tmpdir(), "cdp-pooldim-"));
  try {
    const harness = createHarness({ profileDir, width: 1920, height: 1080 });
    await assert.rejects(openSceneBrowser({
      profileDir,
      width: 1920,
      height: 1080,
      workerCount: 9,
      spawnImpl: harness.spawnImpl,
      webSocketImpl: harness.webSocketImpl
    }), RangeError);
    assert.equal(harness.spawned.length, 0, "argument validation happens before chrome starts");
  } finally {
    await rm(profileDir, { recursive: true, force: true });
  }
});

function createFakeChild() {
  const child = new EventEmitter();
  child.stderr = new PassThrough();
  child.kills = [];
  child.kill = signal => {
    child.kills.push(signal);
    if (signal === "SIGTERM") setImmediate(() => child.emit("exit", null, "SIGTERM"));
  };
  return child;
}

// Полноценный CDP-двойник: проверяет протокольный слой без реального Chrome.
function createHarness({
  profileDir,
  width,
  height,
  reportedViewport,
  failFonts = false,
  navigationError = "",
  ignoreBrowserClose = false,
  port = 45551
}) {
  const child = createFakeChild();
  const harness = { child, spawned: [], socket: null };
  harness.spawnImpl = (tool, argv) => {
    harness.spawned.push({ tool, argv });
    writeFile(path.join(profileDir, "DevToolsActivePort"), `${port}\n${BROWSER_TARGET_PATH}\n`, "utf8");
    return child;
  };
  harness.webSocketImpl = class FakeSocket {
    constructor(url) {
      this.url = url;
      this.sent = [];
      this.closed = false;
      this.listeners = new Map();
      this.nextTargetId = 0;
      harness.socket = this;
      setImmediate(() => this.emit("open", {}));
    }

    addEventListener(type, handler, options = {}) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push({ handler, once: options.once === true });
    }

    emit(type, event) {
      const entries = this.listeners.get(type) || [];
      this.listeners.set(type, entries.filter(entry => !entry.once));
      for (const entry of entries) entry.handler(event);
    }

    send(raw) {
      const message = JSON.parse(raw);
      this.sent.push(message);
      if (message.method === "Browser.close") {
        setImmediate(() => this.emit("message", { data: JSON.stringify({ id: message.id, result: {} }) }));
        if (!ignoreBrowserClose) setImmediate(() => child.emit("exit", 0, null));
        return;
      }
      const replies = replyTo(message, {
        width,
        height,
        reportedViewport,
        failFonts,
        navigationError,
        nextTargetId: () => {
          this.nextTargetId += 1;
          return `T${this.nextTargetId}`;
        }
      });
      for (const reply of replies) {
        setImmediate(() => this.emit("message", { data: JSON.stringify(reply) }));
      }
    }

    close() {
      this.closed = true;
      this.emit("close", {});
    }
  };
  return harness;
}

function replyTo(message, { width, height, reportedViewport, failFonts, navigationError, nextTargetId }) {
  const { id, method, params, sessionId } = message;
  const ok = result => [{ id, result }];
  if (method === "Target.getTargets") {
    return ok({ targetInfos: [{ targetId: "T0", type: "page", url: "about:blank" }] });
  }
  if (method === "Target.createTarget") return ok({ targetId: nextTargetId() });
  if (method === "Target.attachToTarget") return ok({ sessionId: `S-${params.targetId}` });
  if (
    method === "Page.enable"
    || method === "Emulation.setDeviceMetricsOverride"
    || method === "Emulation.setDefaultBackgroundColorOverride"
  ) {
    return ok({});
  }
  if (method === "Page.navigate") {
    if (navigationError) return ok({ frameId: "F1", errorText: navigationError });
    return [
      { id, result: { frameId: "F1", loaderId: "L1" } },
      { method: "Page.loadEventFired", sessionId, params: { timestamp: 1 } }
    ];
  }
  if (method === "Page.captureScreenshot") return ok({ data: PNG_BASE64 });
  if (method === "Runtime.evaluate") {
    if (params.expression === "[innerWidth, innerHeight]") {
      return ok({ result: { value: reportedViewport ?? [width, height] } });
    }
    if (failFonts) {
      return ok({
        result: { type: "undefined" },
        exceptionDetails: { text: "Uncaught", exception: { description: "TypeError: boom" } }
      });
    }
    return ok({ result: { value: "loaded" } });
  }
  return [{ id, error: { code: -32601, message: `unsupported method ${method}` } }];
}
