import { createId } from "./storage.js";
import { normalizeCardImageUrl } from "../../src/card-image.js";

const MAX_CARDS = 250;
const MAX_TEXT = 50000;
const MAX_IMAGE = 900000;
// Подсказка композеру кадра: имя архетипа и его данные. Хранилище проверяет
// только форму и объём — словарь архетипов живёт в слое отрисовки.
const MAX_SCENE_TYPE = 40;
const MAX_SCENE_DATA_CHARS = 4000;
const DEFAULT_WORKSPACE_ID = "workspace_local";
const DEFAULT_OWNER_USER_ID = "local-dev";

export function normalizeProjectDocument(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const now = new Date().toISOString();
  return {
    id: safeId(source.id) || "",
    schemaVersion: Number(source.schemaVersion || 1),
    workspaceId: safeId(source.workspaceId) || "",
    ownerUserId: safeId(source.ownerUserId) || "",
    title: text(source.title || "Hermest Board", 180),
    view: object(source.view, { x: 0, y: 0, zoom: 1 }),
    plan: text(source.plan, MAX_TEXT),
    roadmap: text(source.roadmap, MAX_TEXT),
    script: text(source.script, MAX_TEXT),
    publish: object(source.publish, {}),
    links: normalizeLinks(source.links),
    cards: normalizeCards(source.cards),
    createdAt: source.createdAt || now,
    updatedAt: now
  };
}

export function createProjectRecord(body = {}, actor = null) {
  const project = normalizeProjectDocument(body.project || body);
  const now = new Date().toISOString();
  const id = safeId(project.id) || createId("prj");
  const workspaceId = safeId(body.workspaceId || project.workspaceId) || defaultWorkspaceId(actor);
  const ownerUserId = safeId(body.ownerUserId || project.ownerUserId) || defaultOwnerUserId(actor);
  const actorRecord = actorSnapshot(actor);
  project.id = id;
  project.workspaceId = workspaceId;
  project.ownerUserId = ownerUserId;
  project.createdAt = now;
  project.updatedAt = now;
  return {
    id,
    workspaceId,
    ownerUserId,
    title: project.title,
    project,
    publishPack: object(body.publishPack, null),
    stats: projectStats(project),
    createdBy: actorRecord,
    updatedBy: actorRecord,
    createdAt: now,
    updatedAt: now
  };
}

export function updateProjectRecord(existing, body = {}, actor = null) {
  const next = createProjectRecord({
    ...body,
    workspaceId: existing.workspaceId || existing.project?.workspaceId,
    ownerUserId: existing.ownerUserId || existing.project?.ownerUserId
  }, actor);
  next.id = existing.id;
  next.project.id = existing.id;
  next.workspaceId = existing.workspaceId || next.workspaceId;
  next.ownerUserId = existing.ownerUserId || next.ownerUserId;
  next.project.workspaceId = next.workspaceId;
  next.project.ownerUserId = next.ownerUserId;
  next.createdAt = existing.createdAt || next.createdAt;
  next.project.createdAt = existing.project?.createdAt || next.project.createdAt;
  next.createdBy = existing.createdBy || next.createdBy;
  next.updatedAt = new Date().toISOString();
  next.project.updatedAt = next.updatedAt;
  return next;
}

export function summarizeProject(record) {
  return {
    id: record.id,
    workspaceId: record.workspaceId || record.project?.workspaceId || "",
    ownerUserId: record.ownerUserId || record.project?.ownerUserId || "",
    title: record.title || record.project?.title || "Hermest Board",
    stats: record.stats || projectStats(record.project || {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function projectStats(project) {
  return {
    cards: Array.isArray(project.cards) ? project.cards.length : 0,
    links: Array.isArray(project.links) ? project.links.length : 0,
    platforms: Array.isArray(project.publish?.platforms) ? project.publish.platforms.length : 0,
    languages: String(project.publish?.languages || "")
      .split(",")
      .map(item => item.trim())
      .filter(Boolean).length
  };
}

function normalizeCards(cards) {
  if (!Array.isArray(cards)) return [];
  return cards.slice(0, MAX_CARDS).map(card => ({
    ...sceneComposition(card),
    id: safeId(card.id) || createId("card"),
    x: number(card.x, 0),
    y: number(card.y, 0),
    w: number(card.w, 320),
    h: number(card.h, 300),
    z: number(card.z, 1),
    rot: number(card.rot, 0),
    color: text(card.color || "#5eead4", 32),
    kicker: text(card.kicker, 80),
    title: text(card.title || "Card", 180),
    text: text(card.text, MAX_TEXT),
    tags: Array.isArray(card.tags) ? card.tags.slice(0, 32).map(tag => text(tag, 80)).filter(Boolean) : [],
    image: normalizeCardImageUrl(text(card.image, MAX_IMAGE))
  }));
}

/**
 * Необязательная композиция кадра. Ключи появляются только когда карточка их
 * несёт, поэтому документы прежних проектов остаются прежними байт в байт.
 */
function sceneComposition(card) {
  const composition = {};
  const sceneType = text(card.sceneType, MAX_SCENE_TYPE).trim().toLowerCase().replaceAll("_", "-");
  if (/^[a-z][a-z0-9-]{1,39}$/.test(sceneType)) composition.sceneType = sceneType;
  const sceneData = object(card.sceneData, null);
  if (sceneData) {
    let serialized = "";
    try {
      serialized = JSON.stringify(sceneData);
    } catch {
      return composition;
    }
    if (serialized.length <= MAX_SCENE_DATA_CHARS) composition.sceneData = JSON.parse(serialized);
  }
  return composition;
}

function normalizeLinks(links) {
  if (!Array.isArray(links)) return [];
  return links
    .map(link => Array.isArray(link) ? [safeId(link[0]), safeId(link[1])] : null)
    .filter(link => link?.[0] && link?.[1]);
}

function safeId(value) {
  const id = String(value || "").trim();
  return /^[a-z0-9_-]{2,120}$/i.test(id) ? id : "";
}

function text(value, limit) {
  return String(value || "").slice(0, limit);
}

function number(value, fallback) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function object(value, fallback) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function defaultWorkspaceId(actor) {
  if (actor?.workspaceId) return actor.workspaceId;
  if (actor?.mode === "owner-token") return "workspace_owner";
  return DEFAULT_WORKSPACE_ID;
}

function defaultOwnerUserId(actor) {
  return safeId(actor?.id) || DEFAULT_OWNER_USER_ID;
}

function actorSnapshot(actor) {
  if (!actor) {
    return {
      id: "unknown",
      mode: "unknown",
      authenticated: false
    };
  }
  return {
    id: text(actor.id || "unknown", 120),
    mode: text(actor.mode || "unknown", 80),
    authenticated: Boolean(actor.authenticated)
  };
}
