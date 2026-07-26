import assert from "node:assert/strict";
import test from "node:test";

import { createLocalVerifiedCandidatePersister } from "../../src/local-media/candidate-persistence.js";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);

function projectRecord() {
  return {
    id: "project_saved_1",
    workspaceId: "workspace_local",
    ownerUserId: "local-dev",
    project: {
      schemaVersion: 2,
      id: "project_saved_1",
      title: "Persisted project",
      plan: "Plan",
      roadmap: "Roadmap",
      script: "Script",
      cards: [{ id: "card_1", x: 10, y: 20, w: 320, h: 300, z: 1, rot: 0, title: "Scene", text: "Body", tags: ["one"] }],
      links: [],
      publish: { platforms: ["youtube_video"], languages: ["ru"] }
    }
  };
}

function renderedProject() {
  const persisted = projectRecord().project;
  return {
    ...structuredClone(persisted),
    id: "browser-local-id",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z"
  };
}

function verifiedRender() {
  return {
    recipe: {
      id: "youtube-16x9-1080p",
      version: "1.0.0",
      platform: "youtube_video",
      width: 1920,
      height: 1080
    },
    platforms: ["youtube_video"],
    artifacts: [
      { name: "youtube-16x9-1080p.mp4", type: "video/mp4", bytes: 9000, sha256: SHA_A },
      { name: "youtube-16x9-1080p.manifest.json", type: "application/json", bytes: 2000, sha256: SHA_B },
      { name: "youtube-16x9-1080p.cover.png", type: "image/png", bytes: 400, sha256: SHA_C }
    ],
    manifestSha256: SHA_B,
    verifier: "local-media-worker-r1",
    outputDir: "/tmp/must-be-ignored",
    rights: { status: "allowed" }
  };
}

function harness({ assets = [], writable = true, existing = null } = {}) {
  const saved = [];
  const records = new Map();
  records.set("projects:project_saved_1", projectRecord());
  if (existing) records.set(`publishCandidates:${existing.id}`, existing);
  const persist = createLocalVerifiedCandidatePersister({
    getStorageStatus: () => ({ writeEnabled: writable }),
    getRecord: async (collection, id) => records.get(`${collection}:${id}`) || null,
    listRecords: async collection => collection === "assets" ? assets : [],
    saveRecord: async (collection, record) => {
      saved.push({ collection, record });
      records.set(`${collection}:${record.id}`, record);
      return record;
    },
    appendAudit: async (action, payload) => {
      const record = { id: "aud_test_1", action, ...payload, createdAt: "2026-07-13T13:00:00.000Z" };
      saved.push({ collection: "audit", record });
      return record;
    },
    now: () => "2026-07-13T13:00:00.000Z"
  });
  return { persist, saved, records };
}

test("trusted local worker persists server-verified candidate from saved project and stored rights", async () => {
  const { persist, saved } = harness({
    assets: [{ id: "asset_1", projectId: "project_saved_1", workspaceId: "workspace_local", ownerUserId: "local-dev", rightsStatus: "owned" }]
  });
  const candidate = await persist({
    projectId: "project_saved_1",
    project: renderedProject(),
    verifiedRender: verifiedRender(),
    evidence: { status: "metadata_only" },
    rights: { status: "restricted" }
  });

  assert.equal(candidate.evidence.status, "server_verified");
  assert.equal(candidate.evidence.verifier, "local-media-worker-r1");
  assert.equal(candidate.rights.status, "owned");
  assert.equal(candidate.approvable, true);
  assert.equal(JSON.stringify(candidate).includes("/tmp/"), false);
  assert.equal(saved.filter(item => item.collection === "publishCandidates").length, 1);
  const audit = saved.find(item => item.collection === "audit")?.record;
  assert.equal(audit.action, "publish_candidate.worker_verified");
  assert.equal(JSON.stringify(audit).includes("Persisted project"), false);
});

test("worker candidate persistence rejects snapshot mismatch before writing", async () => {
  const { persist, saved } = harness({
    assets: [{ id: "asset_1", projectId: "project_saved_1", workspaceId: "workspace_local", ownerUserId: "local-dev", rightsStatus: "owned" }]
  });
  const changed = renderedProject();
  changed.cards[0].text = "Changed after server save";

  await assert.rejects(
    persist({ projectId: "project_saved_1", project: changed, verifiedRender: verifiedRender() }),
    /verified_candidate_project_snapshot_mismatch/
  );
  assert.equal(saved.length, 0);
});

test("unknown stored rights produce a sealed but unapprovable candidate", async () => {
  const { persist } = harness({ assets: [] });
  const candidate = await persist({
    projectId: "project_saved_1",
    project: renderedProject(),
    verifiedRender: verifiedRender()
  });

  assert.equal(candidate.status, "sealed");
  assert.equal(candidate.rights.status, "unknown");
  assert.equal(candidate.approvable, false);
  assert.ok(candidate.approvalBlockers.includes("asset_rights_not_cleared"));
});

test("persister fails closed when storage is not writable", async () => {
  const { persist, saved } = harness({ writable: false });
  await assert.rejects(
    persist({ projectId: "project_saved_1", project: renderedProject(), verifiedRender: verifiedRender() }),
    /verified_candidate_storage_not_writable/
  );
  assert.equal(saved.length, 0);
});

test("persister rejects project IDs outside the storage ID contract", async () => {
  const { persist, saved } = harness();
  await assert.rejects(
    persist({ projectId: "A1", project: renderedProject(), verifiedRender: verifiedRender() }),
    /verified_candidate_project_id_required/
  );
  assert.equal(saved.length, 0);
});

test("deterministic existing candidate is idempotent but collision fails closed", async () => {
  const firstHarness = harness({ assets: [] });
  const first = await firstHarness.persist({
    projectId: "project_saved_1",
    project: renderedProject(),
    verifiedRender: verifiedRender()
  });
  const sameHarness = harness({ assets: [], existing: first });
  const same = await sameHarness.persist({
    projectId: "project_saved_1",
    project: renderedProject(),
    verifiedRender: verifiedRender()
  });
  assert.equal(same.digest, first.digest);
  assert.equal(sameHarness.saved.length, 0);

  const collisionHarness = harness({ assets: [], existing: { ...first, digest: "c".repeat(64) } });
  await assert.rejects(
    collisionHarness.persist({ projectId: "project_saved_1", project: renderedProject(), verifiedRender: verifiedRender() }),
    /verified_candidate_id_collision/
  );
});
