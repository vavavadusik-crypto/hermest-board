import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { composeSceneFrames, describeSceneComposerAvailability } from "../../src/media/scene-frames.js";

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
// Хвост IEND обязателен: съёмка принимает только дописанный до конца кадр.
// Двойник, у которого хвоста нет, — это обрезанный скриншот, а такие мы теперь
// не пишем на диск, потому что ffmpeg на них спотыкается.
const PNG_TRAILER = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
const wholePng = (...parts) => Buffer.concat([PNG_HEADER, ...parts, PNG_TRAILER]);

const storyboard = Object.freeze({
  scenes: [
    { title: "Сцена один", narration: "Текст один.", durationMs: 4200 },
    { title: "Сцена два", narration: "Текст два.", durationMs: 5100 }
  ]
});
const recipe = Object.freeze({ width: 1920, height: 1080, fps: 30 });

// Двойник CDP-браузера: один экземпляр на весь прогон, как и настоящий.
function createFakeBrowser({ frameBytes = () => wholePng(), workerCount = 1 } = {}) {
  const calls = { scenes: [], frames: [], workers: [], closed: 0 };
  return {
    calls,
    workerCount,
    launchArgv: [
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
    ],
    async openScene(options) {
      calls.scenes.push(options);
    },
    async captureFrame(frameTimeMs, workerIndex) {
      calls.frames.push(frameTimeMs);
      calls.workers.push(workerIndex);
      return frameBytes(frameTimeMs, calls.frames.length - 1);
    },
    async close() {
      calls.closed += 1;
    }
  };
}

test("composer availability reports missing binary honestly", async () => {
  const availability = await describeSceneComposerAvailability({
    env: { HERMEST_CHROME_PATH: "/tmp/definitely-missing-chrome-binary" }
  });
  assert.equal(availability.status, "missing");
  assert.ok(availability.reason.includes("legacy"));
});

test("composeSceneFrames captures an animated build-in sequence from one browser", async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "scene-frames-test-"));
  try {
    const browser = createFakeBrowser();
    const factoryCalls = [];
    const result = await composeSceneFrames({
      storyboard,
      brief: { topic: "Тема", language: "ru" },
      recipe,
      runDir,
      seed: 42,
      buildFrameLimit: 3,
      browserFactory: async options => {
        factoryCalls.push(options);
        return browser;
      }
    });
    assert.equal(factoryCalls.length, 1, "one browser for the whole render");
    assert.equal(factoryCalls[0].profileDir, path.join(runDir, "chrome-profile"));
    assert.equal(factoryCalls[0].width, 1920);
    assert.equal(factoryCalls[0].height, 1080);

    assert.equal(result.frames.length, 2);
    assert.equal(browser.calls.scenes.length, 2, "each scene is announced to the browser once");
    assert.deepEqual(browser.calls.frames, [0, 33, 67, 0, 33, 67], "3 build frames per scene at 30fps");
    assert.equal(browser.calls.closed, 1, "browser closed exactly once");
    assert.equal(result.composer, "scene-markup@2");
    assert.deepEqual(result.commands, [{ id: "scene-browser", tool: "chrome", argv: browser.launchArgv }]);
    assert.ok(browser.calls.scenes.every(scene => scene.transparent === false));

    const firstFrame = result.frames[0];
    assert.equal(firstFrame.durationSeconds, 4.2);
    assert.equal(firstFrame.sequenceFrameCount, 3);
    assert.equal(firstFrame.sequenceFps, 30);
    assert.ok(firstFrame.sequencePattern.endsWith("scene-001-f%04d.png"));
    assert.ok(firstFrame.path.endsWith("scene-001-f0002.png"), "static path is the final build frame");
    assert.match(firstFrame.frameSha256, /^[0-9a-f]{64}$/);
    assert.match(firstFrame.markupSha256, /^[0-9a-f]{64}$/);

    const written = await readdir(runDir);
    assert.deepEqual(written.filter(name => name.endsWith(".png")).sort(), [
      "scene-001-f0000.png",
      "scene-001-f0001.png",
      "scene-001-f0002.png",
      "scene-002-f0000.png",
      "scene-002-f0001.png",
      "scene-002-f0002.png"
    ]);
    assert.equal(written.filter(name => name.endsWith(".html")).length, 0, "markup is cleaned up");
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("composeSceneFrames opens overlay scenes with a transparent background", async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "scene-frames-overlay-"));
  try {
    const browser = createFakeBrowser();
    await composeSceneFrames({
      storyboard,
      brief: {},
      recipe,
      runDir,
      seed: 7,
      buildFrameLimit: 1,
      backgroundImages: [null, { path: "/tmp/run/bg-002.png" }],
      browserFactory: async () => browser
    });
    assert.deepEqual(browser.calls.scenes.map(scene => scene.transparent), [false, true]);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("composeSceneFrames spreads a scene sequence across the tab pool without gaps", async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "scene-frames-pool-"));
  try {
    // Каждый кадр отдаёт уникальные байты, чтобы поймать перепутанные файлы.
    const browser = createFakeBrowser({
      workerCount: 3,
      frameBytes: frameTimeMs => wholePng(Buffer.from(`t${frameTimeMs}`))
    });
    const result = await composeSceneFrames({
      storyboard: { scenes: [{ title: "Одна", narration: "Текст.", durationMs: 5000 }] },
      brief: {},
      recipe,
      runDir,
      seed: 3,
      buildFrameLimit: 7,
      browserFactory: async () => browser
    });
    assert.equal(result.frames[0].sequenceFrameCount, 7);
    assert.deepEqual([...browser.calls.frames].sort((a, b) => a - b), [0, 33, 67, 100, 133, 167, 200]);
    assert.deepEqual([...new Set(browser.calls.workers)].sort(), [0, 1, 2], "every pool tab does work");

    for (let frameIndex = 0; frameIndex < 7; frameIndex += 1) {
      const frameTimeMs = Math.round((frameIndex * 1000) / 30);
      const written = await readFile(path.join(runDir, `scene-001-f${String(frameIndex).padStart(4, "0")}.png`));
      assert.equal(written.subarray(PNG_HEADER.length, written.length - PNG_TRAILER.length).toString(), `t${frameTimeMs}`, "frame index maps to its file");
    }
    const lastBytes = await readFile(path.join(runDir, "scene-001-f0006.png"));
    assert.equal(
      result.frames[0].frameSha256,
      createHash("sha256").update(lastBytes).digest("hex"),
      "frameSha256 pins the final build frame regardless of capture order"
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("composeSceneFrames caps the build window by scene duration and fps", async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "scene-frames-cap-"));
  try {
    const browser = createFakeBrowser();
    const result = await composeSceneFrames({
      storyboard: { scenes: [{ title: "Короткая", narration: "Текст.", durationMs: 400 }] },
      brief: {},
      recipe,
      runDir,
      seed: 1,
      browserFactory: async () => browser
    });
    assert.equal(result.frames[0].sequenceFrameCount, 12, "0.4s at 30fps = 12 frames");
    assert.equal(browser.calls.frames.length, 12);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("composeSceneFrames fails closed on non-png capture output and still closes the browser", async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "scene-frames-badpng-"));
  try {
    const browser = createFakeBrowser({ frameBytes: () => Buffer.from("not a png") });
    await assert.rejects(
      composeSceneFrames({
        storyboard,
        brief: {},
        recipe,
        runDir,
        seed: 1,
        browserFactory: async () => browser
      }),
      /incomplete PNG/
    );
    assert.equal(browser.calls.closed, 1, "browser must not leak when a capture is rejected");
    const written = await readdir(runDir);
    assert.equal(written.filter(name => name.endsWith(".png")).length, 0, "no bogus frame reaches disk");
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("composeSceneFrames closes the browser when a capture throws", async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "scene-frames-throw-"));
  try {
    const browser = createFakeBrowser({
      frameBytes: (_frameTimeMs, index) => {
        if (index === 2) throw new Error("chrome CDP command Page.captureScreenshot timed out after 60000ms");
        return wholePng();
      }
    });
    await assert.rejects(
      composeSceneFrames({
        storyboard,
        brief: {},
        recipe,
        runDir,
        seed: 1,
        browserFactory: async () => browser
      }),
      /Page.captureScreenshot timed out/
    );
    assert.equal(browser.calls.closed, 1, "browser must not leak when capture fails mid-sequence");
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("composeSceneFrames aborts mid-sequence and closes the browser", async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "scene-frames-abort-"));
  try {
    const controller = new AbortController();
    const browser = createFakeBrowser({
      frameBytes: (_frameTimeMs, index) => {
        if (index === 1) controller.abort();
        return wholePng();
      }
    });
    await assert.rejects(
      composeSceneFrames({
        storyboard,
        brief: {},
        recipe,
        runDir,
        seed: 1,
        signal: controller.signal,
        browserFactory: async () => browser
      }),
      { name: "AbortError" }
    );
    assert.equal(browser.calls.closed, 1);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("composeSceneFrames validates scene count and run dir before launching a browser", async () => {
  let launched = 0;
  const browserFactory = async () => {
    launched += 1;
    return createFakeBrowser();
  };
  await assert.rejects(
    composeSceneFrames({
      storyboard: { scenes: [] }, brief: {}, recipe, runDir: "/tmp/x", seed: 1, browserFactory
    }),
    RangeError
  );
  await assert.rejects(
    composeSceneFrames({
      storyboard, brief: {}, recipe, runDir: "relative/path", seed: 1, browserFactory
    }),
    TypeError
  );
  assert.equal(launched, 0, "no chrome process starts for invalid input");
});
