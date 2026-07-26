import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { createLocalMediaJobManager } from "../../src/local-media/job-manager.js";
import { createLocalMediaRequestHandler } from "../../src/local-media/vite-plugin.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const RENDERABLE_PROJECT = {
  title: "Analytics",
  cards: [{ id: "scene", text: "Renderable scene" }]
};

const FROZEN_NOW = "2026-07-23T10:00:00.000Z";
const REAL_MANIFEST_FIXTURE = path.resolve("test/fixtures/youtube-16x9-1080p.real.manifest.json");

// Фикстура повторяет форму реального result.manifest из renderProject
// (см. src/media/render-project.js → buildRenderManifest и эталон
// test/fixtures/youtube-16x9-1080p.real.manifest.json): tts в tools,
// loudness в qc, probe.scenes у storyboard.json, у mp4 —
// probe.durationSeconds и вложенный probe.video.{width,height}.
const COVER_BYTES = 182_400;

function fullManifestFixture() {
  return {
    schemaVersion: 1,
    renderer: "hermest-board-media-r1",
    recipe: { id: "youtube-16x9-1080p", version: 1, width: 1920, height: 1080 },
    recipeSha256: "f0".repeat(32),
    tools: {
      ffmpeg: "ffmpeg version 6.1",
      tts: {
        provider: "elevenlabs",
        model: "eleven_multilingual_v2",
        voice: "George",
        language: "ru",
        durationSeconds: 41.9,
        sampleRate: 48000,
        channels: 1,
        codec: "pcm_s16le"
      }
    },
    qc: {
      passed: true,
      checks: ["audio_loudness_measured"],
      loudness: {
        integratedLufs: -16.4,
        truePeakDbtp: -2.1,
        loudnessRangeLu: 4.2,
        thresholdLufs: -27.1,
        targetIntegratedLufs: -16,
        targetTruePeakDbtp: -1.5,
        targetLoudnessRangeLu: 11
      }
    },
    blockers: [],
    warnings: [],
    footage: [
      { sceneIndex: 0, license: "pexels", sha256: "c".repeat(64), source: "stock", provider: "pexels" },
      { sceneIndex: 2, license: "pexels", sha256: "d".repeat(64), source: "stock", provider: "pexels" }
    ],
    music: { id: "ambient-01", title: "Calm", mood: "calm", license: "cc0", sha256: "e".repeat(64), source: "library" },
    artifacts: [
      {
        name: "storyboard.json",
        type: "application/json",
        bytes: 1400,
        sha256: "1".repeat(64),
        probe: { schemaVersion: 1, scenes: 6 }
      },
      {
        name: "narration.wav",
        type: "audio/wav",
        bytes: 4032044,
        sha256: "2".repeat(64),
        probe: { durationSeconds: 41.9 }
      },
      {
        name: "narration.srt",
        type: "application/x-subrip",
        bytes: 512,
        sha256: "3".repeat(64),
        probe: { durationSeconds: 41.9 }
      },
      {
        name: "youtube-16x9-1080p.mp4",
        type: "video/mp4",
        bytes: 9_100_000,
        sha256: "a".repeat(64),
        probe: {
          durationSeconds: 42.05,
          audio: { channels: 2, codec: "aac", sampleRate: 48000 },
          video: { codec: "h264", width: 1920, height: 1080 }
        }
      },
      {
        name: "youtube-16x9-1080p.cover.png",
        type: "image/png",
        bytes: COVER_BYTES,
        sha256: "f".repeat(64),
        probe: { width: 1920, height: 1080, atSeconds: 1.25 }
      }
    ]
  };
}

function fullAnalyticsExpectation() {
  return {
    durationSeconds: 42.05,
    integratedLufs: -16.4,
    loudnessRangeLu: 4.2,
    truePeakDbtp: -2.1,
    voice: "George",
    language: "ru",
    recipeId: "youtube-16x9-1080p",
    recipeHash: "f0".repeat(32),
    sceneCount: 6,
    footageCount: 2,
    musicUsed: true,
    artifactCount: 7,
    totalBytes: 1400 + 4032044 + 512 + 9_100_000 + COVER_BYTES,
    videoBytes: 9_100_000,
    videoSha256: "a".repeat(64),
    videoName: "youtube-16x9-1080p.mp4",
    videoType: "video/mp4",
    resolution: { width: 1920, height: 1080 },
    aspectRatio: "16:9",
    qcPassed: true,
    blockers: [],
    warnings: [],
    completedAt: FROZEN_NOW
  };
}

function renderResult(manifest) {
  return {
    outputDir: "/tmp/private-analytics-run",
    manifestPath: "/tmp/private-analytics-run/youtube-16x9-1080p.manifest.json",
    manifestHashPath: "/tmp/private-analytics-run/youtube-16x9-1080p.manifest.json.sha256",
    manifest
  };
}

function analyticsManager(manifest) {
  return createLocalMediaJobManager({
    now: () => FROZEN_NOW,
    executeRender: async () => renderResult(manifest)
  });
}

async function completedAnalytics(manifest) {
  const manager = analyticsManager(manifest);
  const job = manager.submit({ project: RENDERABLE_PROJECT, platform: "youtube_video" });
  await manager.waitFor(job.id);
  const completed = manager.get(job.id);
  assert.equal(completed.status, "completed");
  return completed.analytics;
}

// Инварианты схемы analytics: числа конечны, строки коротки и без путей или
// управляющих символов, массивы ограничены. Общая проверка для всех кейсов.
function assertAnalyticsSchemaInvariants(analytics) {
  assert.ok(analytics && typeof analytics === "object" && !Array.isArray(analytics));
  const seen = [analytics];
  while (seen.length > 0) {
    const node = seen.pop();
    for (const value of Object.values(node)) {
      if (value === null) continue;
      if (typeof value === "number") {
        assert.ok(Number.isFinite(value), "analytics numbers must be finite");
      } else if (typeof value === "string") {
        assert.ok(value.length <= 256, "analytics strings must stay short");
        assert.doesNotMatch(value, /[\u0000-\u001f\u007f]/u, "no control characters");
        assert.doesNotMatch(value, /(?:^|[\s"'(<])\/[^\s"'<>]+/u, "no absolute paths");
      } else if (Array.isArray(value)) {
        assert.ok(value.length <= 20, "analytics arrays must be bounded");
        for (const item of value) seen.push({ item });
      } else if (typeof value === "object") {
        seen.push(value);
      } else {
        assert.equal(typeof value, "boolean");
      }
    }
  }
}

test("completed render job exposes analytics derived from the verified manifest", async () => {
  const analytics = await completedAnalytics(fullManifestFixture());
  assert.deepEqual(analytics, fullAnalyticsExpectation());
  assert.equal(JSON.stringify(analytics).includes("/tmp"), false);
  assertAnalyticsSchemaInvariants(analytics);
});

test("analytics of the real renderer manifest fixture matches the contract exactly", async () => {
  const manifest = JSON.parse(await readFile(REAL_MANIFEST_FIXTURE, "utf8"));
  const analytics = await completedAnalytics(manifest);
  assert.deepEqual(analytics, {
    durationSeconds: 15.96,
    integratedLufs: null,
    loudnessRangeLu: null,
    truePeakDbtp: null,
    voice: "slt",
    language: "en",
    recipeId: "youtube-16x9-1080p",
    recipeHash: "093d36f8d5f2b33d7c0240ae8e17b640af955f1549f1d44c56c4cd1bfacc13ed",
    sceneCount: 3,
    footageCount: 0,
    musicUsed: false,
    artifactCount: 6,
    totalBytes: 1660 + 1532238 + 348 + 523430,
    videoBytes: 523430,
    videoSha256: "47a561427b190e4be0da9f8e2741178a5055f5d44477a7632f1f231132e4d612",
    videoName: "youtube-16x9-1080p.mp4",
    videoType: "video/mp4",
    resolution: { width: 1920, height: 1080 },
    aspectRatio: "16:9",
    qcPassed: true,
    blockers: [],
    warnings: [],
    completedAt: FROZEN_NOW
  });
  assertAnalyticsSchemaInvariants(analytics);
});

test("sparse manifest degrades analytics to null/0 without inventing values", async () => {
  const analytics = await completedAnalytics({
    recipe: { id: "youtube-16x9-1080p" },
    qc: { passed: true },
    blockers: [],
    warnings: [],
    artifacts: []
  });
  assert.deepEqual(analytics, {
    durationSeconds: null,
    integratedLufs: null,
    loudnessRangeLu: null,
    truePeakDbtp: null,
    voice: null,
    language: null,
    recipeId: "youtube-16x9-1080p",
    recipeHash: null,
    sceneCount: 0,
    footageCount: 0,
    musicUsed: false,
    artifactCount: 2,
    totalBytes: 0,
    videoBytes: 0,
    videoSha256: null,
    videoName: null,
    videoType: null,
    resolution: null,
    aspectRatio: null,
    qcPassed: true,
    blockers: [],
    warnings: [],
    completedAt: FROZEN_NOW
  });
  assertAnalyticsSchemaInvariants(analytics);
});

test("aspect ratio reduces width/height to the smallest integer ratio", async () => {
  const vertical = fullManifestFixture();
  const verticalVideo = vertical.artifacts.find(artifact => artifact.type === "video/mp4");
  verticalVideo.probe.video = { codec: "h264", width: 1080, height: 1920 };
  const verticalAnalytics = await completedAnalytics(vertical);
  assert.deepEqual(verticalAnalytics.resolution, { width: 1080, height: 1920 });
  assert.equal(verticalAnalytics.aspectRatio, "9:16");

  const odd = fullManifestFixture();
  const oddVideo = odd.artifacts.find(artifact => artifact.type === "video/mp4");
  oddVideo.probe.video = { codec: "h264", width: 1366, height: 768 };
  const oddAnalytics = await completedAnalytics(odd);
  assert.equal(oddAnalytics.aspectRatio, "683:384");
});

test("partial or invalid probe.video degrades resolution and aspect ratio to null", async () => {
  const manifest = fullManifestFixture();
  const video = manifest.artifacts.find(artifact => artifact.type === "video/mp4");
  video.probe.video = { codec: "h264", width: 1920, height: Number.NaN };
  const analytics = await completedAnalytics(manifest);
  assert.equal(analytics.resolution, null);
  assert.equal(analytics.aspectRatio, null);
  // Остальная сводка не деградирует из-за одного битого поля.
  assert.equal(analytics.durationSeconds, 42.05);
  assertAnalyticsSchemaInvariants(analytics);
});

test("scene count falls back to distinct footage scenes when the storyboard probe is absent", async () => {
  const manifest = fullManifestFixture();
  manifest.artifacts = manifest.artifacts.filter(artifact => artifact.name !== "storyboard.json");
  const analytics = await completedAnalytics(manifest);
  assert.equal(analytics.sceneCount, 2);
  assert.equal(analytics.footageCount, 2);
});

test("hostile manifest strings are sanitized and invalid hashes rejected in analytics", async () => {
  const manifest = fullManifestFixture();
  manifest.tools.tts.voice = "/etc/passwd stolen voice " + "x".repeat(200);
  manifest.tools.tts.language = 12345;
  manifest.qc.loudness.integratedLufs = Number.NaN;
  manifest.qc.loudness.truePeakDbtp = "loud";
  manifest.recipeSha256 = "not-a-hash";
  const video = manifest.artifacts.find(artifact => artifact.type === "video/mp4");
  video.probe = { durationSeconds: Number.POSITIVE_INFINITY };
  video.sha256 = "A".repeat(64);
  const analytics = await completedAnalytics(manifest);
  // Невалидная probe-длительность (Infinity) отвергнута → честный fallback на tts.
  assert.equal(analytics.durationSeconds, 41.9);
  assert.equal(analytics.integratedLufs, null);
  assert.equal(analytics.truePeakDbtp, null);
  assert.equal(analytics.recipeHash, null);
  assert.equal(analytics.resolution, null);
  assert.equal(analytics.aspectRatio, null);
  assert.equal(analytics.language, null);
  assert.equal(typeof analytics.voice, "string");
  assert.equal(analytics.voice.includes("/etc/passwd"), false);
  assert.equal(analytics.voice.startsWith("<path>"), true);
  assert.ok(analytics.voice.length <= 80);
  // sha256 нормализуется к lower-case, а не отбрасывается: значение верное.
  assert.equal(analytics.videoSha256, "a".repeat(64));
  assertAnalyticsSchemaInvariants(analytics);
});

test("analytics blockers and warnings are sanitized, capped and path-free", async () => {
  const manifest = fullManifestFixture();
  manifest.blockers = [
    "footage /home/user/secret/clip.mp4 missing",
    "b".repeat(500),
    ...Array.from({ length: 40 }, (_, index) => `blocker-${index}`)
  ];
  manifest.warnings = [
    "Error: boom\n    at renderProject (/app/src/media/render-project.js:10:5)",
    12345,
    ""
  ];
  const analytics = await completedAnalytics(manifest);
  assert.ok(Array.isArray(analytics.blockers));
  assert.ok(analytics.blockers.length <= 20, "blockers list must be capped");
  for (const blocker of analytics.blockers) {
    assert.equal(typeof blocker, "string");
    assert.ok(blocker.length <= 200, "each blocker must stay within 200 chars");
    assert.equal(blocker.includes("/home"), false);
  }
  assert.equal(analytics.blockers[0], "footage <path> missing");
  assert.ok(Array.isArray(analytics.warnings));
  assert.equal(analytics.warnings.length, 2);
  assert.equal(analytics.warnings[0].includes("\n"), false);
  assert.equal(analytics.warnings[0].includes("/app"), false);
  assertAnalyticsSchemaInvariants(analytics);
});

test("queued, running, failed and cancelled jobs never expose analytics", async () => {
  const gates = [];
  const manager = createLocalMediaJobManager({
    maxConcurrent: 1,
    executeRender: () => {
      const gate = deferred();
      gates.push(gate);
      return gate.promise;
    }
  });

  const running = manager.submit({ project: RENDERABLE_PROJECT, platform: "youtube_video" });
  const queued = manager.submit({ project: RENDERABLE_PROJECT, platform: "youtube_video" });
  await Promise.resolve();

  assert.equal(manager.get(running.id).status, "running");
  assert.equal("analytics" in manager.get(running.id), false);
  assert.equal(manager.get(queued.id).status, "queued");
  assert.equal("analytics" in manager.get(queued.id), false);

  const cancelled = manager.cancel(queued.id);
  assert.equal(cancelled.outcome, "cancelled");
  assert.equal("analytics" in manager.get(queued.id), false);

  gates[0].reject(new Error("render exploded"));
  await manager.waitFor(running.id);
  assert.equal(manager.get(running.id).status, "failed");
  assert.equal("analytics" in manager.get(running.id), false);
});

test("cancellation racing a late successful result never publishes analytics", async () => {
  let releasePersist;
  const persistGate = new Promise(resolve => { releasePersist = resolve; });
  const manager = createLocalMediaJobManager({
    verifyArtifactEvidence: async () => {},
    persistVerifiedCandidate: async () => {
      await persistGate;
      return {
        id: "cand_late",
        digest: "d".repeat(64),
        version: 1,
        status: "sealed",
        approvable: true,
        approvalBlockers: []
      };
    },
    executeRender: async () => ({
      ...renderResult(fullManifestFixture()),
      manifestArtifact: {
        name: "youtube-16x9-1080p.manifest.json",
        type: "application/json",
        bytes: 2000,
        sha256: "b".repeat(64)
      }
    })
  });

  const job = manager.submit({
    projectId: "project_analytics_race",
    project: RENDERABLE_PROJECT,
    platform: "youtube_video"
  });
  await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));

  manager.cancel(job.id);
  releasePersist();
  await manager.waitFor(job.id);

  const final = manager.get(job.id);
  assert.equal(final.status, "cancelled");
  assert.equal("analytics" in final, false);
});

// PHASE 1.2: тот же контракт через HTTP-границу — analytics отдаётся только
// для completed-job, неизвестный id — структурный 404-envelope, не-completed
// статусы не содержат поля analytics вовсе.
test("HTTP boundary serves extended analytics for completed jobs only", async t => {
  const gates = [];
  let manifestForNext = null;
  const manager = createLocalMediaJobManager({
    maxConcurrent: 1,
    now: () => FROZEN_NOW,
    executeRender: () => {
      if (manifestForNext) {
        const manifest = manifestForNext;
        manifestForNext = null;
        return Promise.resolve(renderResult(manifest));
      }
      const gate = deferred();
      gates.push(gate);
      return gate.promise;
    }
  });
  const server = createServer(createLocalMediaRequestHandler({ manager }));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise(resolve => server.close(resolve)));

  async function submitJob() {
    const response = await fetch(`${origin}/api/local-media/render`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hermest-local-media": "1",
        origin
      },
      body: JSON.stringify({ project: RENDERABLE_PROJECT, platform: "youtube_video" })
    });
    assert.equal(response.status, 202);
    return (await response.json()).job;
  }

  async function getJob(id) {
    const response = await fetch(`${origin}/api/local-media/jobs/${id}`, { headers: { origin } });
    return { status: response.status, body: await response.json() };
  }

  // completed → analytics со всеми новыми полями, побайтово по контракту.
  manifestForNext = fullManifestFixture();
  const completedJob = await submitJob();
  await manager.waitFor(completedJob.id);
  const completed = await getJob(completedJob.id);
  assert.equal(completed.status, 200);
  assert.equal(completed.body.job.status, "completed");
  assert.deepEqual(completed.body.job.analytics, fullAnalyticsExpectation());
  assertAnalyticsSchemaInvariants(completed.body.job.analytics);

  // Неизвестный job → структурный 404-envelope, не пустой ответ и не 500.
  const missing = await getJob("job_00000000-0000-4000-8000-000000000000");
  assert.equal(missing.status, 404);
  assert.equal(missing.body.ok, false);
  assert.equal(missing.body.code, "local_media_job_not_found");
  assert.equal(typeof missing.body.error, "string");

  // running/queued/cancelled/failed → поле analytics отсутствует в JSON.
  const runningJob = await submitJob();
  const queuedJob = await submitJob();
  await Promise.resolve();
  const running = await getJob(runningJob.id);
  assert.equal(running.body.job.status, "running");
  assert.equal("analytics" in running.body.job, false);
  const queued = await getJob(queuedJob.id);
  assert.equal(queued.body.job.status, "queued");
  assert.equal("analytics" in queued.body.job, false);

  const cancelResponse = await fetch(`${origin}/api/local-media/jobs/${queuedJob.id}`, {
    method: "DELETE",
    headers: { "content-type": "application/json", "x-hermest-local-media": "1", origin },
    body: "{}"
  });
  assert.equal(cancelResponse.status, 202);
  const cancelledOverHttp = await getJob(queuedJob.id);
  assert.equal(cancelledOverHttp.body.job.status, "cancelled");
  assert.equal("analytics" in cancelledOverHttp.body.job, false);

  gates[0].reject(new Error("render exploded"));
  await manager.waitFor(runningJob.id);
  const failed = await getJob(runningJob.id);
  assert.equal(failed.body.job.status, "failed");
  assert.equal("analytics" in failed.body.job, false);
});
