import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createLocalMediaJobManager } from "../../src/local-media/job-manager.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("local media jobs run one-at-a-time and expose no filesystem paths", async () => {
  const executions = [];
  const manager = createLocalMediaJobManager({
    maxConcurrent: 1,
    executeRender: ({ project, platform, signal }) => {
      const gate = deferred();
      executions.push({ project, platform, signal, gate });
      return gate.promise;
    }
  });

  const first = manager.submit({ project: { title: "One", cards: [{ id: "scene", text: "Renderable scene" }] }, platform: "youtube_video" });
  const second = manager.submit({ project: { title: "Two", cards: [{ id: "scene", text: "Renderable scene" }] }, platform: "youtube_shorts" });
  await Promise.resolve();

  assert.equal(manager.get(first.id).status, "running");
  assert.equal(manager.get(second.id).status, "queued");
  assert.equal(executions.length, 1);

  executions[0].gate.resolve({
    outputDir: "/tmp/private-run-one",
    manifestPath: "/tmp/private-run-one/master.manifest.json",
    manifestHashPath: "/tmp/private-run-one/master.manifest.json.sha256",
    manifest: {
      recipe: { id: "youtube-16x9-1080p" },
      qc: { passed: true },
      blockers: [],
      warnings: [],
      artifacts: [{ name: "master.mp4", type: "video/mp4", bytes: 10, sha256: "a".repeat(64) }]
    }
  });
  await manager.waitFor(first.id);
  await Promise.resolve();

  const publicFirst = manager.get(first.id);
  assert.equal(publicFirst.status, "completed");
  assert.equal(JSON.stringify(publicFirst).includes("/tmp/private"), false);
  assert.deepEqual(publicFirst.artifacts.map(item => item.name), [
    "master.mp4",
    "master.manifest.json",
    "master.manifest.json.sha256"
  ]);
  assert.equal(executions.length, 2);
  assert.equal(manager.get(second.id).status, "running");

  executions[1].gate.resolve({
    outputDir: "/tmp/private-run-two",
    manifestPath: "/tmp/private-run-two/short.manifest.json",
    manifestHashPath: "/tmp/private-run-two/short.manifest.json.sha256",
    manifest: { recipe: { id: "shorts-9x16-1080p" }, qc: { passed: true }, blockers: [], warnings: [], artifacts: [] }
  });
  await manager.waitFor(second.id);
  assert.equal(manager.get(second.id).status, "completed");
});

test("completed verified render is passed through a server-only candidate persistence port", async () => {
  let captured;
  const manager = createLocalMediaJobManager({
    verifyArtifactEvidence: async () => {},
    persistVerifiedCandidate: async input => {
      captured = input;
      return {
        id: "cand_verified_worker",
        digest: "d".repeat(64),
        version: 1,
        status: "sealed",
        approvable: true,
        approvalBlockers: []
      };
    },
    executeRender: async () => ({
      outputDir: "/tmp/private-verified-run",
      manifestPath: "/tmp/private-verified-run/youtube-16x9-1080p.manifest.json",
      manifestHashPath: "/tmp/private-verified-run/youtube-16x9-1080p.manifest.json.sha256",
      manifestArtifact: {
        name: "youtube-16x9-1080p.manifest.json",
        type: "application/json",
        bytes: 2000,
        sha256: "b".repeat(64)
      },
      manifest: {
        recipe: { id: "youtube-16x9-1080p" },
        qc: { passed: true },
        blockers: [],
        warnings: [],
        artifacts: [
          { name: "youtube-16x9-1080p.mp4", type: "video/mp4", bytes: 9000, sha256: "a".repeat(64) },
          { name: "youtube-16x9-1080p.cover.png", type: "image/png", bytes: 400, sha256: "c".repeat(64) }
        ]
      }
    })
  });

  const job = manager.submit({
    projectId: "project_saved_1",
    project: { id: "browser-id", title: "Verified", cards: [{ id: "scene", text: "Renderable scene" }] },
    platform: "youtube_video",
    evidence: { status: "server_verified" },
    rights: { status: "allowed" },
    artifacts: [{ name: "spoofed.mp4" }]
  });
  const completed = await manager.waitFor(job.id);

  assert.equal(completed.status, "completed");
  assert.deepEqual(completed.candidate, {
    id: "cand_verified_worker",
    digest: "d".repeat(64),
    version: 1,
    status: "sealed",
    approvable: true,
    blockers: []
  });
  assert.equal(captured.projectId, "project_saved_1");
  assert.equal(captured.verifiedRender.manifestSha256, "b".repeat(64));
  assert.deepEqual(captured.verifiedRender.artifacts.map(item => item.name), [
    "youtube-16x9-1080p.cover.png",
    "youtube-16x9-1080p.manifest.json",
    "youtube-16x9-1080p.mp4"
  ]);
  assert.equal(JSON.stringify(captured.verifiedRender).includes("spoofed"), false);
  assert.equal(JSON.stringify(completed).includes("/tmp/"), false);
});

test("candidate persistence re-verifies artifact hashes against files on disk", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "hermest-candidate-hash-"));
  const videoName = "youtube-16x9-1080p.mp4";
  const coverName = "youtube-16x9-1080p.cover.png";
  const manifestName = "youtube-16x9-1080p.manifest.json";
  const videoPath = path.join(outputDir, videoName);
  const coverPath = path.join(outputDir, coverName);
  const manifestPath = path.join(outputDir, manifestName);
  const manifestHashPath = `${manifestPath}.sha256`;
  const coverBytes = "cover";
  await writeFile(videoPath, "video", { mode: 0o600 });
  await writeFile(coverPath, coverBytes, { mode: 0o600 });
  await writeFile(manifestPath, "{}\n", { mode: 0o600 });
  await writeFile(manifestHashPath, `${"b".repeat(64)}  ${manifestName}\n`, { mode: 0o600 });
  let persistenceCalls = 0;

  try {
    const manager = createLocalMediaJobManager({
      persistVerifiedCandidate: async () => {
        persistenceCalls += 1;
        return {
          id: "cand_must_not_be_created",
          digest: "d".repeat(64),
          version: 1,
          status: "sealed",
          approvable: true,
          approvalBlockers: []
        };
      },
      executeRender: async () => ({
        outputDir,
        manifestPath,
        manifestHashPath,
        manifestArtifact: {
          name: manifestName,
          type: "application/json",
          bytes: 3,
          sha256: "b".repeat(64)
        },
        manifest: {
          recipe: { id: "youtube-16x9-1080p" },
          qc: { passed: true },
          blockers: [],
          warnings: [],
          artifacts: [
            { name: videoName, type: "video/mp4", bytes: 5, sha256: "a".repeat(64) },
            {
              name: coverName,
              type: "image/png",
              bytes: coverBytes.length,
              sha256: createHash("sha256").update(coverBytes).digest("hex")
            }
          ]
        }
      })
    });
    const job = manager.submit({
      projectId: "project_saved_1",
      project: { title: "Hash mismatch", cards: [{ id: "scene", text: "Renderable scene" }] },
      platform: "youtube_video"
    });
    const completed = await manager.waitFor(job.id);

    assert.equal(completed.status, "completed");
    assert.equal(persistenceCalls, 0);
    assert.equal(completed.candidate.status, "blocked");
    assert.ok(completed.candidate.blockers.includes("publish_candidate_persistence_failed"));
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("candidate persistence rejects a symlinked artifact path and fails closed", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "hermest-candidate-symlink-"));
  const videoName = "youtube-16x9-1080p.mp4";
  const coverName = "youtube-16x9-1080p.cover.png";
  const manifestName = "youtube-16x9-1080p.manifest.json";
  const realVideo = path.join(outputDir, "real-video.bin");
  const videoLink = path.join(outputDir, videoName);
  const coverPath = path.join(outputDir, coverName);
  const manifestPath = path.join(outputDir, manifestName);
  const manifestHashPath = `${manifestPath}.sha256`;
  const videoBytes = "video";
  const coverBytes = "cover";
  const manifestBytes = "{}\n";
  await writeFile(realVideo, videoBytes, { mode: 0o600 });
  await symlink(realVideo, videoLink);
  await writeFile(coverPath, coverBytes, { mode: 0o600 });
  await writeFile(manifestPath, manifestBytes, { mode: 0o600 });
  await writeFile(manifestHashPath, `hash  ${manifestName}\n`, { mode: 0o600 });
  const videoSha = createHash("sha256").update(videoBytes).digest("hex");
  const coverSha = createHash("sha256").update(coverBytes).digest("hex");
  const manifestSha = createHash("sha256").update(manifestBytes).digest("hex");
  let persistenceCalls = 0;

  try {
    const manager = createLocalMediaJobManager({
      persistVerifiedCandidate: async () => {
        persistenceCalls += 1;
        return { id: "cand_symlink", digest: "d".repeat(64), version: 1, status: "sealed", approvable: true, approvalBlockers: [] };
      },
      executeRender: async () => ({
        outputDir,
        manifestPath,
        manifestHashPath,
        manifestArtifact: { name: manifestName, type: "application/json", bytes: manifestBytes.length, sha256: manifestSha },
        manifest: {
          recipe: { id: "youtube-16x9-1080p" },
          qc: { passed: true },
          blockers: [],
          warnings: [],
          artifacts: [
            { name: videoName, type: "video/mp4", bytes: videoBytes.length, sha256: videoSha },
            { name: coverName, type: "image/png", bytes: coverBytes.length, sha256: coverSha }
          ]
        }
      })
    });
    const job = manager.submit({
      projectId: "project_saved_1",
      project: { title: "Symlink artifact", cards: [{ id: "scene", text: "Renderable scene" }] },
      platform: "youtube_video"
    });
    const completed = await manager.waitFor(job.id);

    assert.equal(completed.status, "completed");
    assert.equal(persistenceCalls, 0);
    assert.equal(completed.candidate.status, "blocked");
    assert.ok(completed.candidate.blockers.includes("publish_candidate_persistence_failed"));
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("a render without a cover frame never reaches candidate persistence", async () => {
  let persistenceCalls = 0;
  const manager = createLocalMediaJobManager({
    verifyArtifactEvidence: async () => {},
    persistVerifiedCandidate: async () => {
      persistenceCalls += 1;
      return { id: "cand_no_cover", digest: "d".repeat(64), version: 1, status: "sealed", approvable: true, approvalBlockers: [] };
    },
    executeRender: async () => ({
      outputDir: "/tmp/private-cover-missing",
      manifestPath: "/tmp/private-cover-missing/youtube-16x9-1080p.manifest.json",
      manifestHashPath: "/tmp/private-cover-missing/youtube-16x9-1080p.manifest.json.sha256",
      manifestArtifact: {
        name: "youtube-16x9-1080p.manifest.json",
        type: "application/json",
        bytes: 2000,
        sha256: "b".repeat(64)
      },
      manifest: {
        recipe: { id: "youtube-16x9-1080p" },
        qc: { passed: true },
        blockers: [],
        warnings: [],
        artifacts: [
          { name: "youtube-16x9-1080p.mp4", type: "video/mp4", bytes: 9000, sha256: "a".repeat(64) }
        ]
      }
    })
  });
  const job = manager.submit({
    projectId: "project_saved_1",
    project: { title: "Cover missing", cards: [{ id: "scene", text: "Renderable scene" }] },
    platform: "youtube_video"
  });
  const completed = await manager.waitFor(job.id);

  assert.equal(completed.status, "completed");
  assert.equal(persistenceCalls, 0);
  assert.equal(completed.candidate.status, "blocked");
  assert.ok(completed.candidate.blockers.includes("publish_candidate_persistence_failed"));
});

test("a cover frame declared with the wrong media type is rejected as evidence", async () => {
  let persistenceCalls = 0;
  const manager = createLocalMediaJobManager({
    verifyArtifactEvidence: async () => {},
    persistVerifiedCandidate: async () => {
      persistenceCalls += 1;
      return { id: "cand_wrong_cover", digest: "d".repeat(64), version: 1, status: "sealed", approvable: true, approvalBlockers: [] };
    },
    executeRender: async () => ({
      outputDir: "/tmp/private-cover-type",
      manifestPath: "/tmp/private-cover-type/youtube-16x9-1080p.manifest.json",
      manifestHashPath: "/tmp/private-cover-type/youtube-16x9-1080p.manifest.json.sha256",
      manifestArtifact: {
        name: "youtube-16x9-1080p.manifest.json",
        type: "application/json",
        bytes: 2000,
        sha256: "b".repeat(64)
      },
      manifest: {
        recipe: { id: "youtube-16x9-1080p" },
        qc: { passed: true },
        blockers: [],
        warnings: [],
        artifacts: [
          { name: "youtube-16x9-1080p.mp4", type: "video/mp4", bytes: 9000, sha256: "a".repeat(64) },
          { name: "youtube-16x9-1080p.cover.png", type: "text/plain", bytes: 400, sha256: "c".repeat(64) }
        ]
      }
    })
  });
  const job = manager.submit({
    projectId: "project_saved_1",
    project: { title: "Cover type", cards: [{ id: "scene", text: "Renderable scene" }] },
    platform: "youtube_video"
  });
  const completed = await manager.waitFor(job.id);

  assert.equal(persistenceCalls, 0);
  assert.equal(completed.candidate.status, "blocked");
});

test("candidate persistence failure leaves completed media blocked instead of fabricating approval", async () => {
  const manager = createLocalMediaJobManager({
    verifyArtifactEvidence: async () => {},
    persistVerifiedCandidate: async () => {
      throw new Error("cannot persist /tmp/private-secret");
    },
    executeRender: async () => ({
      outputDir: "/tmp/private-persistence-failure",
      manifestPath: "/tmp/private-persistence-failure/youtube-16x9-1080p.manifest.json",
      manifestHashPath: "/tmp/private-persistence-failure/youtube-16x9-1080p.manifest.json.sha256",
      manifestArtifact: {
        name: "youtube-16x9-1080p.manifest.json",
        type: "application/json",
        bytes: 2000,
        sha256: "b".repeat(64)
      },
      manifest: {
        recipe: { id: "youtube-16x9-1080p" },
        qc: { passed: true },
        blockers: [],
        warnings: [],
        artifacts: [
          { name: "youtube-16x9-1080p.mp4", type: "video/mp4", bytes: 9000, sha256: "a".repeat(64) },
          { name: "youtube-16x9-1080p.cover.png", type: "image/png", bytes: 400, sha256: "c".repeat(64) }
        ]
      }
    })
  });
  const job = manager.submit({
    projectId: "project_saved_1",
    project: { title: "Blocked candidate", cards: [{ id: "scene", text: "Renderable scene" }] },
    platform: "youtube_video"
  });
  const completed = await manager.waitFor(job.id);

  assert.equal(completed.status, "completed");
  assert.equal(completed.candidate.status, "blocked");
  assert.ok(completed.candidate.blockers.includes("publish_candidate_persistence_failed"));
  assert.equal(JSON.stringify(completed).includes("/tmp/"), false);
});

test("render results that fail QC never become completed or downloadable", async () => {
  const manager = createLocalMediaJobManager({
    executeRender: async () => ({
      outputDir: "/tmp/private-qc-failure",
      manifestPath: "/tmp/private-qc-failure/youtube-16x9-1080p.manifest.json",
      manifestHashPath: "/tmp/private-qc-failure/youtube-16x9-1080p.manifest.json.sha256",
      manifestArtifact: {
        name: "youtube-16x9-1080p.manifest.json",
        type: "application/json",
        bytes: 2000,
        sha256: "b".repeat(64)
      },
      manifest: {
        recipe: { id: "youtube-16x9-1080p" },
        qc: { passed: false },
        blockers: ["ffprobe_failed"],
        warnings: [],
        artifacts: [
          { name: "youtube-16x9-1080p.mp4", type: "video/mp4", bytes: 9000, sha256: "a".repeat(64) }
        ]
      }
    })
  });
  const job = manager.submit({
    project: { title: "Failed QC", cards: [{ id: "scene", text: "Renderable scene" }] },
    platform: "youtube_video"
  });
  const failed = await manager.waitFor(job.id);

  assert.equal(failed.status, "failed");
  assert.deepEqual(failed.artifacts, []);
  assert.throws(() => manager.resolveArtifact(job.id, "youtube-16x9-1080p.mp4"), /not available/);
});

test("render results with a missing QC block never become completed or downloadable", async () => {
  const manager = createLocalMediaJobManager({
    executeRender: async () => ({
      outputDir: "/tmp/private-qc-missing",
      manifestPath: "/tmp/private-qc-missing/youtube-16x9-1080p.manifest.json",
      manifestHashPath: "/tmp/private-qc-missing/youtube-16x9-1080p.manifest.json.sha256",
      manifest: {
        recipe: { id: "youtube-16x9-1080p" },
        blockers: [],
        warnings: [],
        artifacts: [
          { name: "youtube-16x9-1080p.mp4", type: "video/mp4", bytes: 9000, sha256: "a".repeat(64) }
        ]
      }
    })
  });
  const job = manager.submit({
    project: { title: "Missing QC", cards: [{ id: "scene", text: "Renderable scene" }] },
    platform: "youtube_video"
  });
  const failed = await manager.waitFor(job.id);

  assert.equal(failed.status, "failed");
  assert.deepEqual(failed.artifacts, []);
  assert.throws(() => manager.resolveArtifact(job.id, "youtube-16x9-1080p.mp4"), /not available/);
});

test("local media job cancellation aborts execution and settles as cancelled", async () => {
  const started = deferred();
  const manager = createLocalMediaJobManager({
    executeRender: ({ signal }) => new Promise((_resolve, reject) => {
      started.resolve();
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    })
  });
  const job = manager.submit({ project: { title: "Cancel", cards: [{ id: "scene", text: "Renderable scene" }] }, platform: "youtube_video" });
  await started.promise;

  const cancelled = manager.cancel(job.id);
  assert.equal(cancelled.outcome, "cancelled");
  assert.equal(cancelled.job.status, "cancelled");
  await manager.waitFor(job.id);
  assert.equal(manager.get(job.id).status, "cancelled");
});

test("cancel of an unknown render job reports not_found", () => {
  const manager = createLocalMediaJobManager({ executeRender: async () => ({}) });

  assert.deepEqual(manager.cancel("missing"), { outcome: "not_found", job: null });
  assert.deepEqual(manager.cancel(undefined), { outcome: "not_found", job: null });
});

test("render job cancel is immediately terminal without a transient status", async () => {
  const started = deferred();
  const manager = createLocalMediaJobManager({
    executeRender: ({ signal }) => new Promise((_resolve, reject) => {
      started.resolve();
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    })
  });
  const job = manager.submit({ project: { title: "No transient", cards: [{ id: "scene", text: "Renderable scene" }] }, platform: "youtube_video" });
  await started.promise;
  assert.equal(manager.get(job.id).status, "running");

  manager.cancel(job.id);
  // Наружу никогда не выходит промежуточный статус вроде "cancelling":
  // публичный вид становится терминально cancelled сразу же.
  assert.equal(manager.get(job.id).status, "cancelled");
  assert.equal(typeof manager.get(job.id).completedAt, "string");
  await manager.waitFor(job.id);
  assert.equal(manager.get(job.id).status, "cancelled");
});

test("repeat cancel of a cancelled render job is idempotent", async () => {
  const started = deferred();
  const manager = createLocalMediaJobManager({
    executeRender: ({ signal }) => new Promise((_resolve, reject) => {
      started.resolve();
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    })
  });
  const job = manager.submit({ project: { title: "Repeat", cards: [{ id: "scene", text: "Renderable scene" }] }, platform: "youtube_video" });
  await started.promise;

  assert.equal(manager.cancel(job.id).outcome, "cancelled");
  await manager.waitFor(job.id);
  const repeat = manager.cancel(job.id);
  assert.equal(repeat.outcome, "cancelled");
  assert.equal(repeat.job.status, "cancelled");
  assert.equal(manager.get(job.id).status, "cancelled");
});

test("cancel of a queued render job settles immediately without executing", async () => {
  const gate = deferred();
  let executions = 0;
  const manager = createLocalMediaJobManager({
    maxConcurrent: 1,
    executeRender: () => {
      executions += 1;
      return gate.promise;
    }
  });
  const running = manager.submit({ project: { title: "Running", cards: [{ id: "scene", text: "Renderable scene" }] }, platform: "youtube_video" });
  const queued = manager.submit({ project: { title: "Queued", cards: [{ id: "scene", text: "Renderable scene" }] }, platform: "youtube_video" });
  await Promise.resolve();
  assert.equal(manager.get(queued.id).status, "queued");

  const cancelled = manager.cancel(queued.id);
  assert.equal(cancelled.outcome, "cancelled");
  assert.equal(cancelled.job.status, "cancelled");
  await manager.waitFor(queued.id);

  gate.resolve({
    outputDir: "/tmp/private-running",
    manifestPath: "/tmp/private-running/master.manifest.json",
    manifestHashPath: "/tmp/private-running/master.manifest.json.sha256",
    manifest: { recipe: { id: "youtube-16x9-1080p" }, qc: { passed: true }, blockers: [], warnings: [], artifacts: [] }
  });
  await manager.waitFor(running.id);
  // Отменённый queued-job никогда не запускал исполнителя.
  assert.equal(executions, 1);
  assert.equal(manager.get(queued.id).status, "cancelled");
});

test("cancel of terminal render jobs reports not_cancellable", async () => {
  const manager = createLocalMediaJobManager({
    executeRender: async ({ project }) => {
      if (project.title === "fail") throw new Error("render exploded");
      return {
        outputDir: "/tmp/private-terminal",
        manifestPath: "/tmp/private-terminal/master.manifest.json",
        manifestHashPath: "/tmp/private-terminal/master.manifest.json.sha256",
        manifest: { recipe: { id: "youtube-16x9-1080p" }, qc: { passed: true }, blockers: [], warnings: [], artifacts: [] }
      };
    }
  });
  const completed = manager.submit({ project: { title: "ok", cards: [{ id: "scene", text: "Renderable scene" }] }, platform: "youtube_video" });
  await manager.waitFor(completed.id);
  const failed = manager.submit({ project: { title: "fail", cards: [{ id: "scene", text: "Renderable scene" }] }, platform: "youtube_video" });
  await manager.waitFor(failed.id);

  const completedResult = manager.cancel(completed.id);
  assert.equal(completedResult.outcome, "not_cancellable");
  assert.equal(completedResult.job.status, "completed");
  const failedResult = manager.cancel(failed.id);
  assert.equal(failedResult.outcome, "not_cancellable");
  assert.equal(failedResult.job.status, "failed");
  // Терминальные статусы не изменились после попытки отмены.
  assert.equal(manager.get(completed.id).status, "completed");
  assert.equal(manager.get(failed.id).status, "failed");
});

test("late render success after cancel is discarded and the job stays cancelled", async () => {
  const gate = deferred();
  const started = deferred();
  const manager = createLocalMediaJobManager({
    // executeRender игнорирует signal: модель зависшего child-процесса,
    // который физически завершился уже после отмены и вернул результат.
    executeRender: () => {
      started.resolve();
      return gate.promise;
    }
  });
  const job = manager.submit({ project: { title: "Race", cards: [{ id: "scene", text: "Renderable scene" }] }, platform: "youtube_video" });
  await started.promise;

  assert.equal(manager.cancel(job.id).outcome, "cancelled");
  gate.resolve({
    outputDir: "/tmp/private-late-success",
    manifestPath: "/tmp/private-late-success/master.manifest.json",
    manifestHashPath: "/tmp/private-late-success/master.manifest.json.sha256",
    manifest: {
      recipe: { id: "youtube-16x9-1080p" },
      qc: { passed: true },
      blockers: [],
      warnings: [],
      artifacts: [{ name: "master.mp4", type: "video/mp4", bytes: 10, sha256: "a".repeat(64) }]
    }
  });
  const settled = await manager.waitFor(job.id);

  assert.equal(settled.status, "cancelled");
  assert.deepEqual(settled.artifacts, []);
  assert.equal(manager.get(job.id).status, "cancelled");
  assert.throws(() => manager.resolveArtifact(job.id, "master.mp4"), /not available/);
});

test("cancel during candidate persistence never resurrects the job as completed", async () => {
  const persistGate = deferred();
  const persistStarted = deferred();
  const manager = createLocalMediaJobManager({
    verifyArtifactEvidence: async () => {},
    persistVerifiedCandidate: () => {
      persistStarted.resolve();
      return persistGate.promise;
    },
    executeRender: async () => ({
      outputDir: "/tmp/private-persist-race",
      manifestPath: "/tmp/private-persist-race/youtube-16x9-1080p.manifest.json",
      manifestHashPath: "/tmp/private-persist-race/youtube-16x9-1080p.manifest.json.sha256",
      manifestArtifact: {
        name: "youtube-16x9-1080p.manifest.json",
        type: "application/json",
        bytes: 2000,
        sha256: "b".repeat(64)
      },
      manifest: {
        recipe: { id: "youtube-16x9-1080p" },
        qc: { passed: true },
        blockers: [],
        warnings: [],
        artifacts: [
          { name: "youtube-16x9-1080p.mp4", type: "video/mp4", bytes: 9000, sha256: "a".repeat(64) },
          { name: "youtube-16x9-1080p.cover.png", type: "image/png", bytes: 400, sha256: "c".repeat(64) }
        ]
      }
    })
  });
  const job = manager.submit({
    projectId: "project_saved_1",
    project: { title: "Persist race", cards: [{ id: "scene", text: "Renderable scene" }] },
    platform: "youtube_video"
  });
  await persistStarted.promise;

  // Отмена пришла, пока job ждал persistVerifiedCandidate: поздний успех
  // персистенции не имеет права превратить cancelled в completed.
  assert.equal(manager.cancel(job.id).outcome, "cancelled");
  persistGate.resolve({
    id: "cand_late",
    digest: "d".repeat(64),
    version: 1,
    status: "sealed",
    approvable: true,
    approvalBlockers: []
  });
  const settled = await manager.waitFor(job.id);

  assert.equal(settled.status, "cancelled");
  assert.equal(settled.candidate, null);
  assert.deepEqual(settled.artifacts, []);
  assert.equal(manager.get(job.id).status, "cancelled");
});

test("local media job manager rejects structurally unsafe projects before queueing", () => {
  let executions = 0;
  const manager = createLocalMediaJobManager({
    executeRender: async () => { executions += 1; }
  });
  const project = {
    schemaVersion: 1,
    title: "Deep",
    cards: [{ id: "one", text: "Scene" }],
    extra: {}
  };
  let cursor = project.extra;
  for (let index = 0; index < 80; index += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }

  assert.throws(
    () => manager.submit({ project, platform: "youtube_video" }),
    /maximum depth/i
  );
  assert.equal(executions, 0);
});

test("render adapter paths cannot escape the private local run directory", async () => {
  const manager = createLocalMediaJobManager({
    executeRender: async () => ({
      outputDir: "/tmp/private-run",
      manifestPath: "/etc/passwd",
      manifestHashPath: "/tmp/private-run/master.manifest.json.sha256",
      manifest: { recipe: { id: "youtube-16x9-1080p" }, qc: { passed: true }, artifacts: [] }
    })
  });
  const job = manager.submit({
    project: { schemaVersion: 1, title: "Escape", cards: [{ id: "one", text: "Scene" }] },
    platform: "youtube_video"
  });
  await manager.waitFor(job.id);

  const failed = manager.get(job.id);
  assert.equal(failed.status, "failed");
  assert.equal(JSON.stringify(failed).includes("/etc/passwd"), false);
});

test("public job errors redact Unicode POSIX and Windows absolute paths", async () => {
  const manager = createLocalMediaJobManager({
    executeRender: async () => {
      throw new Error("cannot read /tmp/секрет.mp4 or C:\\private\\secret.mp4");
    }
  });
  const job = manager.submit({
    project: { schemaVersion: 1, title: "Private error", cards: [{ id: "one", text: "Scene" }] },
    platform: "youtube_video"
  });
  const failed = await manager.waitFor(job.id);

  assert.equal(failed.status, "failed");
  assert.equal(failed.error, "cannot read <path> or <path>");
});

test("evicting a completed job invokes private artifact cleanup", async () => {
  const cleaned = [];
  const manager = createLocalMediaJobManager({
    maxJobs: 1,
    cleanupRender: async target => { cleaned.push(target); },
    executeRender: async ({ jobId }) => ({
      outputDir: `/tmp/${jobId}`,
      manifestPath: `/tmp/${jobId}/master.manifest.json`,
      manifestHashPath: `/tmp/${jobId}/master.manifest.json.sha256`,
      manifest: {
        recipe: { id: "youtube-16x9-1080p" },
        qc: { passed: true },
        blockers: [],
        warnings: [],
        artifacts: []
      }
    })
  });
  const first = manager.submit({
    project: { title: "One", cards: [{ id: "one", text: "Scene one" }] },
    platform: "youtube_video"
  });
  await manager.waitFor(first.id);
  const second = manager.submit({
    project: { title: "Two", cards: [{ id: "two", text: "Scene two" }] },
    platform: "youtube_video"
  });
  await manager.waitFor(second.id);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(manager.get(first.id), null);
  assert.deepEqual(cleaned, [{ outputDir: `/tmp/${first.id}`, jobId: first.id }]);
});

test("artifact resolution is allowlisted to completed job outputs", async () => {
  const manager = createLocalMediaJobManager({
    executeRender: async () => ({
      outputDir: "/tmp/private-run",
      manifestPath: "/tmp/private-run/master.manifest.json",
      manifestHashPath: "/tmp/private-run/master.manifest.json.sha256",
      manifest: {
        recipe: { id: "youtube-16x9-1080p" },
        qc: { passed: true },
        blockers: [],
        warnings: [],
        artifacts: [{ name: "master.mp4", type: "video/mp4", bytes: 10, sha256: "a".repeat(64) }]
      }
    })
  });
  const job = manager.submit({ project: { title: "Done", cards: [{ id: "scene", text: "Renderable scene" }] }, platform: "youtube_video" });
  await manager.waitFor(job.id);

  assert.equal(manager.resolveArtifact(job.id, "master.mp4"), "/tmp/private-run/master.mp4");
  assert.throws(() => manager.resolveArtifact(job.id, "../secret"), /not available/);
  assert.throws(() => manager.resolveArtifact(job.id, "unknown.txt"), /not available/);
});

// Resume-контракт (docs/RESUME_MILESTONE_HANDOFF.md): активные job переживают
// «отключение» отправителя — их нельзя вычистить, пока они не терминальны,
// а publicJob отдаёт createdAt для восстановления elapsed при reconnect.

function passingRenderResult(outputDir) {
  return {
    outputDir,
    manifestPath: `${outputDir}/master.manifest.json`,
    manifestHashPath: `${outputDir}/master.manifest.json.sha256`,
    manifest: {
      recipe: { id: "youtube-16x9-1080p" },
      qc: { passed: true },
      blockers: [],
      warnings: [],
      artifacts: []
    }
  };
}

test("active render jobs are never evicted by capacity pressure", async () => {
  const gates = [];
  const manager = createLocalMediaJobManager({
    maxConcurrent: 1,
    maxJobs: 2,
    executeRender: () => {
      const gate = deferred();
      gates.push(gate);
      return gate.promise;
    }
  });

  const running = manager.submit({ project: { title: "One", cards: [{ id: "scene", text: "Renderable scene" }] }, platform: "youtube_video" });
  const queued = manager.submit({ project: { title: "Two", cards: [{ id: "scene", text: "Renderable scene" }] }, platform: "youtube_video" });
  await Promise.resolve();
  assert.equal(manager.get(running.id).status, "running");
  assert.equal(manager.get(queued.id).status, "queued");

  // Capacity-давление отвечает 429 и НЕ трогает активные записи.
  assert.throws(
    () => manager.submit({ project: { title: "Three", cards: [{ id: "scene", text: "Renderable scene" }] }, platform: "youtube_video" }),
    error => {
      assert.equal(error.message, "local_media_jobs_capacity");
      assert.equal(error.statusCode, 429);
      return true;
    }
  );
  assert.equal(manager.get(running.id).status, "running");
  assert.equal(manager.get(queued.id).status, "queued");

  gates[0].resolve(passingRenderResult("/tmp/private-run-one"));
  await manager.waitFor(running.id);
  await Promise.resolve();

  // Терминальный job уступает место новому; активный (running) остаётся.
  const accepted = manager.submit({ project: { title: "Four", cards: [{ id: "scene", text: "Renderable scene" }] }, platform: "youtube_video" });
  assert.equal(manager.get(running.id), null, "terminal job is evicted at capacity");
  assert.equal(manager.get(queued.id).status, "running");
  assert.equal(manager.get(accepted.id).status, "queued");
});

test("public render job exposes createdAt as an ISO timestamp for reconnect", async () => {
  const manager = createLocalMediaJobManager({
    now: () => "2026-07-23T12:00:00.000Z",
    executeRender: () => new Promise(() => {})
  });

  const submitted = manager.submit({ project: { title: "Resume", cards: [{ id: "scene", text: "Renderable scene" }] }, platform: "youtube_video" });
  assert.equal(submitted.createdAt, "2026-07-23T12:00:00.000Z");

  const polled = manager.get(submitted.id);
  assert.equal(polled.createdAt, "2026-07-23T12:00:00.000Z");
  assert.ok(Number.isFinite(Date.parse(polled.createdAt)), "createdAt must stay parseable ISO");
});
