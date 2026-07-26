import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCandidateApproval,
  buildPublishCandidate,
  summarizeAssetRights
} from "../../api/_lib/publish-candidates.js";

const SECRET = "candidate-secret-sentinel-73f2";
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const SHA_D = "d".repeat(64);

function input(overrides = {}) {
  return {
    projectRecord: {
      id: "prj_candidate",
      workspaceId: "workspace_one",
      ownerUserId: "user_one",
      project: {
        id: "prj_candidate",
        schemaVersion: 1,
        title: "Candidate board",
        plan: `Plan ${SECRET}`,
        roadmap: "Roadmap",
        script: "Script",
        cards: [
          { id: "card_b", x: 10, y: 20, w: 300, h: 200, title: "B", text: "Second" },
          { id: "card_a", x: 0, y: 0, w: 300, h: 200, title: "A", text: "First" }
        ],
        links: [["card_b", "card_a"]],
        publish: { platforms: ["youtube_video"], languages: "ru" },
        updatedAt: "2026-01-01T00:00:00.000Z",
        localPath: "/tmp/private/candidate.json",
        apiToken: SECRET
      }
    },
    recipe: {
      id: "youtube-16x9-1080p",
      version: "1.0.0",
      platform: "youtube_video",
      width: 1920,
      height: 1080
    },
    platforms: ["youtube_video"],
    artifacts: [
      { name: "youtube-16x9-1080p.manifest.json", type: "application/json", bytes: 2048, sha256: SHA_B, path: "/tmp/private/youtube-16x9-1080p.manifest.json", token: SECRET },
      { name: "youtube-16x9-1080p.mp4", type: "video/mp4", bytes: 9000, sha256: SHA_A },
      { name: "youtube-16x9-1080p.cover.png", type: "image/png", bytes: 41000, sha256: SHA_D }
    ],
    manifestSha256: SHA_B,
    rights: { status: "allowed", assetIds: ["asset_b", "asset_a"] },
    evidence: { status: "server_verified", verifier: "local-media-v1" },
    createdAt: "2026-07-13T10:00:00.000Z",
    ...overrides
  };
}

test("sealed candidate digest is canonical, deterministic and excludes paths, secrets and timestamps", () => {
  const first = buildPublishCandidate(input());
  const second = buildPublishCandidate(input({
    createdAt: "2030-01-01T00:00:00.000Z",
    artifacts: [...input().artifacts].reverse(),
    rights: { assetIds: ["asset_a", "asset_b"], status: "allowed" }
  }));

  assert.equal(first.id, second.id);
  assert.equal(first.digest, second.digest);
  assert.equal(first.project.snapshotSha256, second.project.snapshotSha256);
  assert.equal(first.status, "sealed");
  assert.equal(first.approvable, true);
  assert.deepEqual(first.artifacts.map(item => item.name), [
    "youtube-16x9-1080p.cover.png",
    "youtube-16x9-1080p.manifest.json",
    "youtube-16x9-1080p.mp4"
  ]);
  assert.deepEqual(first.rights.assetIds, ["asset_a", "asset_b"]);
  const serialized = JSON.stringify(first);
  assert.equal(serialized.includes(SECRET), false);
  assert.equal(serialized.includes("/tmp/"), false);
  assert.equal(Object.isFrozen(first), true);
  assert.throws(() => {
    first.status = "draft";
  }, TypeError);
});

test("metadata-only and unsafe-rights candidates seal but cannot be approved", () => {
  const metadataOnly = buildPublishCandidate(input({
    evidence: { status: "metadata_only", verifier: "api-client-attested" }
  }));
  assert.equal(metadataOnly.approvable, false);
  assert.ok(metadataOnly.approvalBlockers.includes("artifact_verification_required"));

  const unknownRights = buildPublishCandidate(input({
    rights: { status: "unknown", assetIds: ["asset_a"] }
  }));
  assert.equal(unknownRights.approvable, false);
  assert.ok(unknownRights.approvalBlockers.includes("asset_rights_not_cleared"));
});

test("candidate input rejects malformed hashes, duplicate artifacts and path-like names", () => {
  assert.throws(
    () => buildPublishCandidate(input({ manifestSha256: "not-a-hash" })),
    /invalid_manifest_sha256/
  );
  assert.throws(
    () => buildPublishCandidate(input({ artifacts: [input().artifacts[0], input().artifacts[0]] })),
    /duplicate_candidate_artifact/
  );
  assert.throws(
    () => buildPublishCandidate(input({ artifacts: [{ name: "..\/master.mp4", type: "video/mp4", bytes: 1, sha256: SHA_C }] })),
    /invalid_candidate_artifact_name/
  );
});

test("approval assertion binds exact immutable candidate identity and evidence", () => {
  const candidate = buildPublishCandidate(input());
  assert.equal(assertCandidateApproval(candidate, {
    candidateId: candidate.id,
    candidateDigest: candidate.digest,
    candidateVersion: candidate.version
  }), candidate);

  assert.throws(
    () => assertCandidateApproval(candidate, { candidateId: candidate.id, candidateDigest: SHA_C, candidateVersion: 1 }),
    /candidate_digest_mismatch/
  );
  assert.throws(
    () => assertCandidateApproval(candidate, { candidateId: "cand_wrong", candidateDigest: candidate.digest, candidateVersion: 1 }),
    /candidate_id_mismatch/
  );
  const blocked = buildPublishCandidate(input({ evidence: { status: "metadata_only", verifier: "api-client-attested" } }));
  assert.throws(
    () => assertCandidateApproval(blocked, { candidateId: blocked.id, candidateDigest: blocked.digest, candidateVersion: 1 }),
    /candidate_not_approvable/
  );
});

test("rights summary fails closed across project assets", () => {
  assert.deepEqual(summarizeAssetRights([
    { id: "asset_b", rightsStatus: "generated" },
    { id: "asset_a", rightsStatus: "allowed" }
  ]), {
    status: "allowed",
    assetIds: ["asset_a", "asset_b"]
  });
  assert.equal(summarizeAssetRights([{ id: "asset_a", rightsStatus: "restricted" }]).status, "restricted");
  assert.equal(summarizeAssetRights([]).status, "unknown");
});
