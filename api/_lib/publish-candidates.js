import { createHash } from "node:crypto";

const SCHEMA = "hermest.publish-candidate.v1";
const MAX_ARTIFACTS = 32;
const MAX_ARTIFACT_BYTES = 20 * 1024 * 1024 * 1024;
const SAFE_RIGHTS = new Set(["allowed", "owned", "generated"]);
const RIGHTS_STATUSES = new Set(["unknown", "allowed", "restricted", "owned", "generated"]);
const PLATFORM_IDS = new Set([
  "youtube_video",
  "youtube_shorts",
  "instagram_reels",
  "instagram_feed",
  "tiktok"
]);
const EVIDENCE_STATUSES = new Set(["metadata_only", "server_verified"]);
const SHA256 = /^[a-f0-9]{64}$/;

export function buildPublishCandidate(input = {}) {
  const identity = normalizeProjectIdentity(input.projectRecord);
  const projectSnapshot = normalizeProjectSnapshot(input.projectRecord?.project || input.projectRecord);
  const recipe = normalizeRecipe(input.recipe);
  const platforms = normalizePlatforms(input.platforms);
  if (!platforms.includes(recipe.platform)) fail("candidate_recipe_platform_mismatch");
  const artifacts = normalizeArtifacts(input.artifacts);
  const manifestSha256 = normalizeSha256(input.manifestSha256, "invalid_manifest_sha256");
  const expectedManifestName = `${recipe.id}.manifest.json`;
  const expectedVideoName = `${recipe.id}.mp4`;
  const manifestArtifact = artifacts.find(item => item.name === expectedManifestName);
  if (!manifestArtifact || manifestArtifact.type !== "application/json" || manifestArtifact.sha256 !== manifestSha256) {
    fail("candidate_manifest_artifact_mismatch");
  }
  const videoArtifact = artifacts.find(item => item.name === expectedVideoName);
  if (!videoArtifact || videoArtifact.type !== "video/mp4") fail("candidate_master_artifact_missing");
  const expectedCoverName = `${recipe.id}.cover.png`;
  const coverArtifact = artifacts.find(item => item.name === expectedCoverName);
  const rights = normalizeRights(input.rights);
  const evidence = normalizeEvidence(input.evidence);
  const projectSnapshotSha256 = hashCanonical(projectSnapshot);
  const approvalBlockers = [];
  if (!SAFE_RIGHTS.has(rights.status)) approvalBlockers.push("asset_rights_not_cleared");
  if (evidence.status !== "server_verified") approvalBlockers.push("artifact_verification_required");
  // Обложка требуется каждой площадкой из publish-пака (thumbnail / cover_frame),
  // поэтому кандидат без неё запечатывается, но одобрен быть не может: тихий
  // пропуск превратил бы недостающий ассет в проблему момента публикации.
  if (!coverArtifact || coverArtifact.type !== "image/png") approvalBlockers.push("cover_frame_artifact_missing");

  const sealedPayload = {
    schema: SCHEMA,
    version: 1,
    project: {
      id: identity.projectId,
      workspaceId: identity.workspaceId,
      ownerUserId: identity.ownerUserId,
      snapshotSha256: projectSnapshotSha256
    },
    recipe,
    platforms,
    artifacts,
    manifestSha256,
    rights,
    evidence
  };
  const digest = hashCanonical(sealedPayload);
  const candidate = {
    id: `cand_${digest.slice(0, 40)}`,
    schema: SCHEMA,
    version: 1,
    digest,
    status: "sealed",
    projectId: identity.projectId,
    workspaceId: identity.workspaceId,
    ownerUserId: identity.ownerUserId,
    project: sealedPayload.project,
    recipe,
    platforms,
    artifacts,
    manifestSha256,
    rights,
    evidence,
    approvable: approvalBlockers.length === 0,
    approvalBlockers,
    canAutopublish: false,
    createdAt: normalizeIsoDate(input.createdAt),
    updatedAt: normalizeIsoDate(input.createdAt)
  };

  return deepFreeze(candidate);
}

export function assertCandidateApproval(candidate, expected = {}) {
  if (!candidate || candidate.status !== "sealed") fail("candidate_not_sealed", 409);
  if (String(expected.candidateId || "") !== candidate.id) fail("candidate_id_mismatch", 409);
  if (String(expected.candidateDigest || "") !== candidate.digest) fail("candidate_digest_mismatch", 409);
  if (Number(expected.candidateVersion) !== candidate.version) fail("candidate_version_mismatch", 409);
  if (!candidate.approvable || candidate.approvalBlockers?.length) fail("candidate_not_approvable", 409);
  return candidate;
}

export function getPublishProjectSnapshotSha256(projectRecord) {
  return hashCanonical(normalizeProjectSnapshot(projectRecord?.project || projectRecord));
}

export function summarizeAssetRights(assets) {
  const records = (Array.isArray(assets) ? assets : []).slice(0, 1000);
  if (!records.length) return { status: "unknown", assetIds: [] };
  const assetIds = records
    .map(asset => safeId(asset?.id, ""))
    .filter(Boolean)
    .sort();
  const statuses = records.map(asset => normalizeRightsStatus(asset?.rightsStatus));
  let status = "allowed";
  if (statuses.includes("restricted")) status = "restricted";
  else if (statuses.includes("unknown")) status = "unknown";
  else if (statuses.every(value => value === "generated")) status = "generated";
  else if (statuses.every(value => value === "owned" || value === "generated")) status = "owned";
  return { status, assetIds: [...new Set(assetIds)] };
}

function normalizeProjectIdentity(record) {
  const projectId = safeId(record?.id || record?.project?.id, "");
  const workspaceId = safeId(record?.workspaceId || record?.project?.workspaceId, "");
  const ownerUserId = safeId(record?.ownerUserId || record?.project?.ownerUserId, "");
  if (!projectId) fail("candidate_project_id_required");
  if (!workspaceId) fail("candidate_workspace_id_required");
  if (!ownerUserId) fail("candidate_owner_user_id_required");
  return { projectId, workspaceId, ownerUserId };
}

function normalizeProjectSnapshot(project) {
  const source = project && typeof project === "object" ? project : {};
  const cards = (Array.isArray(source.cards) ? source.cards : [])
    .slice(0, 250)
    .map(card => ({
      id: safeId(card?.id, "card_unknown"),
      x: finiteNumber(card?.x, 0),
      y: finiteNumber(card?.y, 0),
      w: finiteNumber(card?.w, 320),
      h: finiteNumber(card?.h, 300),
      z: finiteNumber(card?.z, 1),
      rot: finiteNumber(card?.rot, 0),
      color: safeText(card?.color, 32),
      kicker: safeText(card?.kicker, 80),
      title: safeText(card?.title, 180),
      text: safeText(card?.text, 50_000),
      tags: normalizeStrings(card?.tags, 32, 80)
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const links = (Array.isArray(source.links) ? source.links : [])
    .slice(0, 1000)
    .map(link => Array.isArray(link) ? [safeId(link[0], ""), safeId(link[1], "")] : ["", ""])
    .filter(link => link[0] && link[1])
    .sort((left, right) => `${left[0]}:${left[1]}`.localeCompare(`${right[0]}:${right[1]}`));

  return {
    schemaVersion: positiveInteger(source.schemaVersion, 1, 1000),
    id: safeId(source.id, ""),
    title: safeText(source.title, 180),
    plan: safeText(source.plan, 50_000),
    roadmap: safeText(source.roadmap, 50_000),
    script: safeText(source.script, 50_000),
    cards,
    links,
    publish: {
      platforms: normalizePlatforms(source.publish?.platforms || [], true),
      languages: normalizeLanguages(source.publish?.languages)
    }
  };
}

function normalizeRecipe(recipe) {
  const source = recipe && typeof recipe === "object" ? recipe : {};
  const id = safeSlug(source.id, "");
  const version = safeSlug(source.version, "");
  const platform = String(source.platform || "").trim();
  if (!id) fail("candidate_recipe_id_required");
  if (!version) fail("candidate_recipe_version_required");
  if (!PLATFORM_IDS.has(platform)) fail("invalid_candidate_recipe_platform");
  return {
    id,
    version,
    platform,
    width: positiveInteger(source.width, 1, 16_384),
    height: positiveInteger(source.height, 1, 16_384)
  };
}

function normalizePlatforms(value, allowEmpty = false) {
  const platforms = normalizeStrings(value, 8, 64)
    .filter(platform => PLATFORM_IDS.has(platform))
    .sort();
  const unique = [...new Set(platforms)];
  if (!allowEmpty && !unique.length) fail("candidate_platforms_required");
  return unique;
}

function normalizeArtifacts(value) {
  if (!Array.isArray(value) || !value.length || value.length > MAX_ARTIFACTS) {
    fail("invalid_candidate_artifacts");
  }
  const seen = new Set();
  return value.map(item => {
    const name = String(item?.name || "").trim();
    if (!/^[a-z0-9][a-z0-9._-]{0,119}$/i.test(name) || name.includes("..")) {
      fail("invalid_candidate_artifact_name");
    }
    if (seen.has(name)) fail("duplicate_candidate_artifact");
    seen.add(name);
    const type = String(item?.type || "application/octet-stream").trim().toLowerCase();
    if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(type)) fail("invalid_candidate_artifact_type");
    const bytes = positiveInteger(item?.bytes, 1, MAX_ARTIFACT_BYTES);
    return {
      name,
      type,
      bytes,
      sha256: normalizeSha256(item?.sha256, "invalid_candidate_artifact_sha256")
    };
  }).sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeRights(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    status: normalizeRightsStatus(source.status),
    assetIds: [...new Set(normalizeStrings(source.assetIds, 1000, 120).map(id => safeId(id, "")).filter(Boolean))].sort()
  };
}

function normalizeRightsStatus(value) {
  const status = String(value || "unknown").trim().toLowerCase();
  return RIGHTS_STATUSES.has(status) ? status : "unknown";
}

function normalizeEvidence(value) {
  const source = value && typeof value === "object" ? value : {};
  const status = String(source.status || "metadata_only").trim();
  if (!EVIDENCE_STATUSES.has(status)) fail("invalid_candidate_evidence_status");
  const verifier = safeSlug(source.verifier || (status === "server_verified" ? "unknown-verifier" : "api-client-attested"), "");
  if (!verifier) fail("candidate_evidence_verifier_required");
  return { status, verifier };
}

function hashCanonical(value) {
  return createHash("sha256").update(canonicalStringify(value)).digest("hex");
}

function canonicalStringify(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function normalizeStrings(value, limit, itemLimit) {
  const values = Array.isArray(value) ? value : String(value || "").split(/[,\s]+/);
  return values.slice(0, limit).map(item => safeText(item, itemLimit).trim()).filter(Boolean);
}

function normalizeLanguages(value) {
  return [...new Set(normalizeStrings(value, 32, 32).map(item => item.toLowerCase()))].sort();
}

function normalizeSha256(value, code) {
  const digest = String(value || "").trim().toLowerCase();
  if (!SHA256.test(digest)) fail(code);
  return digest;
}

function safeId(value, fallback) {
  const id = String(value || "").trim();
  return /^[a-z0-9_-]{2,120}$/i.test(id) ? id : fallback;
}

function safeSlug(value, fallback) {
  const slug = String(value || "").trim();
  return /^[a-z0-9][a-z0-9._-]{0,119}$/i.test(slug) ? slug : fallback;
}

function safeText(value, limit) {
  return String(value || "").slice(0, limit);
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveInteger(value, min, max) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) fail("invalid_candidate_number");
  return number;
}

function normalizeIsoDate(value) {
  const date = value ? new Date(String(value)) : new Date();
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function fail(code, status = 400) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  throw error;
}
