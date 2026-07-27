import { createReadStream } from "node:fs";
import { stat, rm } from "node:fs/promises";
import path from "node:path";

import { DURATION_PLAN_LIMITS } from "../domain/duration-plan.js";
import { renderProject } from "../media/render-project.js";
import { describeBridgeAvailability } from "../media/text-model.js";
import { createDraftJobManager } from "./draft-job-manager.js";
import { draftBoardService } from "./draft-service.js";
import { boardCommandService } from "./board-command-service.js";
import { planSeriesService } from "./series-service.js";
import { editionService, toPublicEdition } from "./edition-service.js";
import { createLocalMediaJobManager } from "./job-manager.js";
import { createProviderKeyStore } from "./provider-keys.js";

const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_DRAFT_TOPIC_CHARS = 2000;
const MIN_TARGET_DURATION_SECONDS = DURATION_PLAN_LIMITS.minTargetSeconds;
const MAX_TARGET_DURATION_SECONDS = DURATION_PLAN_LIMITS.maxTargetSeconds;
const MUTATION_HEADER = "x-hermest-local-media";
const API_PREFIX = "/api/local-media";

export function createLocalMediaVitePlugin({
  manager,
  draftManager,
  maxBodyBytes,
  persistVerifiedCandidate = null,
  providerKeys
} = {}) {
  const activeManager = manager || createLocalMediaJobManager({
    executeRender: ({ project, platform, signal, onProgress }) => renderProject({
      project,
      platform,
      signal,
      outputDir: "/tmp",
      onProgress
    }),
    persistVerifiedCandidate,
    cleanupRender: ({ outputDir }) => rm(outputDir, { recursive: true, force: true })
  });
  const activeDraftManager = draftManager || createDraftJobManager({
    runDraft: params => draftBoardService(params)
  });
  const handler = createLocalMediaRequestHandler({
    manager: activeManager,
    draftManager: activeDraftManager,
    maxBodyBytes,
    providerKeys: providerKeys || createProviderKeyStore()
  });
  return {
    name: "hermest-board-local-media",
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    }
  };
}

export function createLocalMediaRequestHandler({
  manager,
  draftManager = createDraftJobManager({ runDraft: params => draftBoardService(params) }),
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
  providerKeys = createProviderKeyStore(),
  describeBridge = describeBridgeAvailability,
  runEdition = editionService,
  planSeries = planSeriesService,
  runBoardCommand = boardCommandService
} = {}) {
  if (!manager || typeof manager.submit !== "function") {
    throw new TypeError("A local media job manager is required");
  }
  if (!draftManager || typeof draftManager.submit !== "function") {
    throw new TypeError("A draft job manager is required");
  }
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 64 || maxBodyBytes > DEFAULT_MAX_BODY_BYTES) {
    throw new RangeError(`maxBodyBytes must be within 64..${DEFAULT_MAX_BODY_BYTES}`);
  }

  const context = { manager, draftManager, maxBodyBytes, providerKeys, describeBridge, runEdition, planSeries, runBoardCommand };
  return function localMediaHandler(request, response, next) {
    void routeRequest(request, response, context, next).catch(error => {
      // Fail-closed: любой сбой обработчика (включая сбой самой отправки
      // ошибки) завершается ответом или разрывом соединения, но не роняет
      // vite-middleware процесса.
      try {
        if (response.headersSent) {
          response.destroy();
          return;
        }
        const status = Number(error?.statusCode) || statusForError(error);
        sendJson(response, status, {
          ok: false,
          error: publicError(error, status),
          code: errorCode(error, status)
        });
      } catch {
        try { response.destroy(); } catch { /* соединение уже закрыто */ }
      }
    });
  };
}

async function routeRequest(request, response, context, next) {
  const { manager, draftManager, maxBodyBytes, providerKeys, describeBridge, runEdition, planSeries, runBoardCommand } = context;
  const host = String(request.headers.host || "");
  if (!isLoopbackHost(host) || !isAllowedOrigin(request.headers.origin, host)) {
    throw new HttpError(403, "local_media_origin_forbidden");
  }

  const requestUrl = new URL(request.url || "/", `http://${host}`);
  const pathname = requestUrl.pathname;
  if (!pathname.startsWith(API_PREFIX)) {
    if (typeof next === "function") {
      next();
      return;
    }
    throw new HttpError(404, "not_found");
  }

  if (request.method === "GET" && pathname === `${API_PREFIX}/status`) {
    sendJson(response, 200, {
      ok: true,
      mode: "local_only",
      renderer: "hermest-board-media-r1",
      publishEnabled: false
    });
    return;
  }

  if (request.method === "GET" && pathname === `${API_PREFIX}/providers`) {
    sendJson(response, 200, { ok: true, providers: providerKeys.listProviders() });
    return;
  }

  // Состояние моста читаемо без mutation-header: UI показывает список
  // браузерных провайдеров ещё до первого драфта.
  if (request.method === "GET" && pathname === `${API_PREFIX}/bridge`) {
    // Fail-closed: сломанный probe моста — это 503 с кодом, а не упавший
    // middleware и не утёкшее сообщение провайдера.
    let availability;
    try {
      availability = await describeBridge();
    } catch {
      throw new HttpError(503, "bridge_status_unavailable");
    }
    sendJson(response, 200, {
      ok: true,
      available: availability.status === "executable",
      providers: Array.isArray(availability.providers) ? availability.providers : [],
      reason: availability.reason || null
    });
    return;
  }

  const providerMatch = pathname.match(new RegExp(`^${API_PREFIX}/providers/([a-z0-9-]+)/key$`));
  if (providerMatch && request.method === "POST") {
    requireMutationRequest(request);
    const body = await readJsonBody(request, maxBodyBytes);
    const provider = providerKeys.setKey(providerMatch[1], body.key);
    sendJson(response, 200, { ok: true, provider });
    return;
  }
  if (providerMatch && request.method === "DELETE") {
    requireMutationRequest(request);
    const provider = providerKeys.clearKey(providerMatch[1]);
    sendJson(response, 200, { ok: true, provider });
    return;
  }

  if (request.method === "POST" && pathname === `${API_PREFIX}/render`) {
    requireMutationRequest(request);
    const body = await readJsonBody(request, maxBodyBytes);
    validateRenderBody(body);
    const job = manager.submit({ project: body.project, projectId: body.projectId, platform: body.platform });
    sendJson(response, 202, { ok: true, job: decorateJob(job) });
    return;
  }

  // Мультиязычное издание: перевести повествование готового проекта и вернуть
  // переведённый board. Рендер идёт через существующий POST /render — новой
  // render-поверхности нет. voice_missing — обычный статус (200), не ошибка.
  if (request.method === "POST" && pathname === `${API_PREFIX}/edition`) {
    requireMutationRequest(request);
    const body = await readJsonBody(request, maxBodyBytes);
    validateEditionBody(body);
    const result = await runEdition({
      project: body.project,
      targetLanguage: body.targetLanguage,
      endpoint: sanitizeDraftEndpoint(body.endpoint),
      model: body.model
    });
    sendJson(response, 200, {
      ok: true,
      edition: toPublicEdition(result.edition),
      project: result.project || null
    });
    return;
  }

  // Драфт идёт через мост, который думает минутами: отдаём job и опрашиваем,
  // иначе прокси рвёт синхронный запрос по таймауту.
  if (request.method === "POST" && pathname === `${API_PREFIX}/draft`) {
    requireMutationRequest(request);
    const body = await readJsonBody(request, maxBodyBytes);
    validateDraftBody(body);
    const job = draftManager.submit({
      topic: body.topic,
      language: body.language,
      // Мультрежим — булев флаг и ничего больше: сценарий целиком строит домен,
      // из запроса не приходит ни труппа, ни реплики.
      cartoon: body.cartoon === true,
      // План сезона приходит от клиента, но доверия ему не больше, чем ответу
      // модели: domain перепроверит форму и упадёт с внятной ошибкой.
      series: body.series ?? null,
      episodeNumber: body.episodeNumber ?? null,
      sceneCount: body.sceneCount,
      targetDurationSeconds: body.targetDurationSeconds,
      voice: body.voice,
      narrationProvider: body.narrationProvider,
      research: body.research !== false,
      model: body.model,
      endpoint: sanitizeDraftEndpoint(body.endpoint)
    });
    sendJson(response, 202, { ok: true, job });
    return;
  }

  // План сезона — короткий синхронный вызов: одна реплика модели, никакого
  // рендера, поэтому job здесь был бы церемонией ради церемонии.
  if (request.method === "POST" && pathname === `${API_PREFIX}/series`) {
    requireMutationRequest(request);
    const body = await readJsonBody(request, maxBodyBytes);
    validateSeriesBody(body);
    const result = await planSeries({
      topic: body.topic,
      language: body.language,
      episodeCount: body.episodeCount,
      episodeDurationSeconds: body.episodeDurationSeconds ?? null,
      audience: body.audience,
      tone: body.tone,
      model: body.model,
      endpoint: sanitizeDraftEndpoint(body.endpoint)
    });
    sendJson(response, 200, { ok: true, ...result });
    return;
  }

  // Правка доски — короткий разговор, не рендер: одна реплика модели и ответ
  // с тем, что применилось и что отклонено.
  if (request.method === "POST" && pathname === `${API_PREFIX}/board-command`) {
    requireMutationRequest(request);
    const body = await readJsonBody(request, maxBodyBytes);
    validateBoardCommandBody(body);
    const result = await runBoardCommand({
      board: body.board,
      request: body.request,
      model: body.model,
      endpoint: sanitizeDraftEndpoint(body.endpoint)
    });
    sendJson(response, 200, { ok: true, ...result });
    return;
  }

  const draftJobMatch = pathname.match(new RegExp(`^${API_PREFIX}/draft/(draft_[A-Za-z0-9-]+)$`));
  if (draftJobMatch && request.method === "GET") {
    const job = draftManager.get(draftJobMatch[1]);
    if (!job) throw new HttpError(404, "draft_job_not_found");
    sendJson(response, 200, { ok: true, job });
    return;
  }
  if (draftJobMatch && request.method === "DELETE") {
    requireMutationRequest(request);
    // Контракт отмены (the cancel contract): queued/running и
    // повторная отмена → 202 идемпотентно; терминальные completed/failed →
    // детерминированный 409; неизвестный id → 404. Состояние job никогда
    // не превращается в 500.
    const cancelResult = draftManager.cancel(draftJobMatch[1]) || {};
    switch (cancelResult.outcome) {
      case "cancelled":
        sendJson(response, 202, { ok: true, job: cancelResult.job });
        return;
      case "not_cancellable":
        throw new HttpError(409, "draft_job_not_cancellable");
      case "not_found":
        throw new HttpError(404, "draft_job_not_found");
      default:
        // Менеджер нарушил собственный контракт исходов — честный 500 через
        // общий error-envelope; fail-closed обработчик не даёт упасть middleware.
        throw new HttpError(500, "draft_cancel_failed");
    }
  }

  const jobMatch = pathname.match(new RegExp(`^${API_PREFIX}/jobs/(job_[A-Za-z0-9-]+)$`));
  if (jobMatch && request.method === "GET") {
    const job = manager.get(jobMatch[1]);
    if (!job) throw new HttpError(404, "local_media_job_not_found");
    sendJson(response, 200, { ok: true, job: decorateJob(job) });
    return;
  }
  if (jobMatch && request.method === "DELETE") {
    requireMutationRequest(request);
    // Контракт отмены (the render-cancel contract): queued/running
    // и повторная отмена → 202 идемпотентно; терминальные completed/failed →
    // детерминированный 409; неизвестный id → 404. Состояние job никогда
    // не превращается в 500.
    const cancelResult = manager.cancel(jobMatch[1]) || {};
    switch (cancelResult.outcome) {
      case "cancelled":
        sendJson(response, 202, { ok: true, job: decorateJob(cancelResult.job) });
        return;
      case "not_cancellable":
        throw new HttpError(409, "local_media_job_not_cancellable");
      case "not_found":
        throw new HttpError(404, "local_media_job_not_found");
      default:
        // Менеджер нарушил собственный контракт исходов — честный 500 через
        // общий error-envelope; fail-closed обработчик не даёт упасть middleware.
        throw new HttpError(500, "local_media_cancel_failed");
    }
  }

  const artifactMatch = pathname.match(
    new RegExp(`^${API_PREFIX}/jobs/(job_[A-Za-z0-9-]+)/artifacts/([^/]+)$`)
  );
  if (artifactMatch && request.method === "GET") {
    let artifactName;
    try {
      artifactName = decodeURIComponent(artifactMatch[2]);
    } catch {
      throw new HttpError(400, "invalid_artifact_name");
    }
    const job = manager.get(artifactMatch[1]);
    const artifact = job?.artifacts?.find(item => item.name === artifactName);
    if (!artifact) throw new HttpError(404, "local_media_artifact_not_found");
    let artifactPath;
    try {
      artifactPath = manager.resolveArtifact(artifactMatch[1], artifactName);
    } catch {
      throw new HttpError(404, "local_media_artifact_not_found");
    }
    // Файл мог исчезнуть после resolveArtifact (cleanup, eviction): это 404
    // для клиента, а не внутренний сбой.
    let fileInfo;
    try {
      fileInfo = await stat(artifactPath);
    } catch {
      throw new HttpError(404, "local_media_artifact_not_found");
    }
    if (!fileInfo.isFile()) throw new HttpError(404, "local_media_artifact_not_found");
    response.statusCode = 200;
    response.setHeader("cache-control", "no-store");
    response.setHeader("content-type", artifact.type || "application/octet-stream");
    response.setHeader("content-length", String(fileInfo.size));
    response.setHeader("content-disposition", `attachment; filename="${path.basename(artifactName)}"`);
    response.setHeader("x-content-type-options", "nosniff");
    const artifactStream = createReadStream(artifactPath);
    // Без обработчика 'error' сбой чтения (EACCES, исчезнувший файл) — это
    // unhandled event и падение всего dev-сервера. Fail-closed: до отправки
    // заголовков — чистый JSON 500, после — разрыв соединения.
    artifactStream.on("error", () => {
      try {
        if (response.headersSent) {
          response.destroy();
          return;
        }
        sendJson(response, 500, {
          ok: false,
          error: "local_media_artifact_read_failed",
          code: "local_media_artifact_read_failed"
        });
      } catch {
        try { response.destroy(); } catch { /* соединение уже закрыто */ }
      }
    });
    artifactStream.pipe(response);
    return;
  }

  throw new HttpError(404, "not_found");
}

function requireMutationRequest(request) {
  if (request.headers[MUTATION_HEADER] !== "1") {
    throw new HttpError(403, "local_media_mutation_header_required");
  }
  if (!String(request.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "application_json_required");
  }
}

async function readJsonBody(request, maxBodyBytes) {
  const chunks = [];
  let bytes = 0;
  let oversized = false;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxBodyBytes) {
      oversized = true;
    } else {
      chunks.push(chunk);
    }
  }
  if (oversized) throw new HttpError(413, "local_media_request_too_large");
  if (bytes === 0) throw new HttpError(400, "local_media_json_body_required");
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError();
    return parsed;
  } catch {
    throw new HttpError(400, "invalid_local_media_json");
  }
}

// Граница доверия: любой ввод враждебен. Здесь проверяются только тип и
// границы длины с явными кодами — семантику (URL, allowlist моделей, схему
// board) по-прежнему валидируют менеджеры и адаптеры.
function validateBoardCommandBody(body) {
  const text = body.request;
  if (text === undefined || text === null || (typeof text === "string" && !text.trim())) {
    throw new HttpError(400, "board_command_required");
  }
  if (typeof text !== "string" || text.length > 500) {
    throw new HttpError(400, "board_command_invalid");
  }
  if (!body.board || typeof body.board !== "object" || Array.isArray(body.board) || !Array.isArray(body.board.cards)) {
    throw new HttpError(400, "board_command_board_required");
  }
  requireOptionalBoundedString(body.model, 64, "board_command_model_invalid");
}

function validateSeriesBody(body) {
  const topic = body.topic;
  if (topic === undefined || topic === null || (typeof topic === "string" && !topic.trim())) {
    throw new HttpError(400, "series_topic_required");
  }
  if (typeof topic !== "string" || topic.length > MAX_DRAFT_TOPIC_CHARS) {
    throw new HttpError(400, "series_topic_invalid");
  }
  requireOptionalBoundedString(body.language, 32, "series_language_invalid");
  requireOptionalBoundedString(body.audience, 200, "series_audience_invalid");
  requireOptionalBoundedString(body.tone, 200, "series_tone_invalid");
  requireOptionalBoundedString(body.model, 64, "series_model_invalid");
  if (body.episodeCount !== undefined && body.episodeCount !== null) {
    if (typeof body.episodeCount !== "number" || !Number.isFinite(body.episodeCount)) {
      throw new HttpError(400, "series_episode_count_invalid");
    }
  }
  if (body.episodeDurationSeconds !== undefined && body.episodeDurationSeconds !== null) {
    if (typeof body.episodeDurationSeconds !== "number" || !Number.isFinite(body.episodeDurationSeconds)) {
      throw new HttpError(400, "series_episode_duration_invalid");
    }
  }
}

function validateDraftBody(body) {
  const topic = body.topic;
  if (topic === undefined || topic === null || (typeof topic === "string" && !topic.trim())) {
    throw new HttpError(400, "draft_topic_required");
  }
  if (typeof topic !== "string" || topic.length > MAX_DRAFT_TOPIC_CHARS) {
    throw new HttpError(400, "draft_topic_invalid");
  }
  requireOptionalBoundedString(body.language, 32, "draft_language_invalid");
  requireOptionalBoundedString(body.voice, 200, "draft_voice_invalid");
  requireOptionalBoundedString(body.narrationProvider, 64, "draft_narration_provider_invalid");
  requireOptionalBoundedString(body.model, 64, "draft_model_invalid");
  if (body.sceneCount !== undefined && body.sceneCount !== null) {
    if (typeof body.sceneCount !== "number" || !Number.isFinite(body.sceneCount)) {
      throw new HttpError(400, "draft_scene_count_invalid");
    }
  }
  if (body.targetDurationSeconds !== undefined && body.targetDurationSeconds !== null) {
    if (typeof body.targetDurationSeconds !== "number"
      || !Number.isFinite(body.targetDurationSeconds)
      || body.targetDurationSeconds < MIN_TARGET_DURATION_SECONDS
      || body.targetDurationSeconds > MAX_TARGET_DURATION_SECONDS) {
      throw new HttpError(400, "draft_target_duration_invalid");
    }
  }
  if (body.episodeNumber !== undefined && body.episodeNumber !== null) {
    if (!Number.isSafeInteger(body.episodeNumber) || body.episodeNumber < 1) {
      throw new HttpError(400, "draft_episode_number_invalid");
    }
    if (!body.series || typeof body.series !== "object" || Array.isArray(body.series)) {
      throw new HttpError(400, "draft_series_plan_required");
    }
  }
  if (body.research !== undefined && body.research !== null && typeof body.research !== "boolean") {
    throw new HttpError(400, "draft_research_invalid");
  }
  validateDraftEndpoint(body.endpoint);
}

function validateDraftEndpoint(endpoint) {
  if (endpoint === undefined || endpoint === null) return;
  if (typeof endpoint !== "object" || Array.isArray(endpoint)) {
    throw new HttpError(400, "draft_endpoint_invalid");
  }
  if (endpoint.kind === "bridge") return;
  if (endpoint.kind !== "openai") throw new HttpError(400, "draft_endpoint_invalid");
  for (const [value, maxChars] of [[endpoint.baseUrl, 500], [endpoint.apiKey, 500], [endpoint.model, 200]]) {
    if (value === undefined || value === null) continue;
    if (typeof value !== "string" || value.length > maxChars) {
      throw new HttpError(400, "draft_endpoint_invalid");
    }
  }
}

function validateEditionBody(body) {
  const project = body.project;
  if (!project || typeof project !== "object" || Array.isArray(project)) {
    throw new HttpError(400, "edition_project_invalid");
  }
  const targetLanguage = body.targetLanguage;
  if (targetLanguage === undefined || targetLanguage === null
    || (typeof targetLanguage === "string" && !targetLanguage.trim())) {
    throw new HttpError(400, "edition_language_required");
  }
  if (typeof targetLanguage !== "string" || targetLanguage.length > 32) {
    throw new HttpError(400, "edition_language_invalid");
  }
  requireOptionalBoundedString(body.model, 64, "edition_model_invalid");
  validateDraftEndpoint(body.endpoint);
}

function validateRenderBody(body) {
  const project = body.project;
  if (!project || typeof project !== "object" || Array.isArray(project)) {
    throw new HttpError(400, "render_project_invalid");
  }
  if (body.platform !== undefined && body.platform !== null) {
    if (typeof body.platform !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(body.platform)) {
      throw new HttpError(400, "render_platform_invalid");
    }
  }
  if (body.projectId !== undefined && body.projectId !== null) {
    if (typeof body.projectId !== "string" || body.projectId.length > 120) {
      throw new HttpError(400, "render_project_id_invalid");
    }
  }
}

function requireOptionalBoundedString(value, maxChars, code) {
  if (value === undefined || value === null) return;
  if (typeof value !== "string" || value.length > maxChars) throw new HttpError(400, code);
}

// Роут только приводит форму: значения baseUrl/apiKey/model валидирует сам
// адаптер, а ключ дальше живёт исключительно в замыкании джобы.
function sanitizeDraftEndpoint(raw) {
  if (!raw || typeof raw !== "object") return undefined;
  if (raw.kind === "openai") {
    return {
      kind: "openai",
      baseUrl: String(raw.baseUrl || ""),
      apiKey: String(raw.apiKey || ""),
      model: String(raw.model || "")
    };
  }
  return { kind: "bridge" };
}

function decorateJob(job) {
  if (!job) return null;
  return {
    ...job,
    artifacts: (job.artifacts || []).map(artifact => ({
      ...artifact,
      url: `${API_PREFIX}/jobs/${encodeURIComponent(job.id)}/artifacts/${encodeURIComponent(artifact.name)}`
    }))
  };
}

function isLoopbackHost(host) {
  try {
    const hostname = new URL(`http://${host}`).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
  } catch {
    return false;
  }
}

function isAllowedOrigin(origin, host) {
  if (!origin) return true;
  try {
    const parsed = new URL(String(origin));
    return parsed.protocol === "http:" && parsed.host.toLowerCase() === host.toLowerCase() && isLoopbackHost(parsed.host);
  } catch {
    return false;
  }
}

function sendJson(response, status, payload) {
  const body = `${JSON.stringify(payload)}\n`;
  response.statusCode = status;
  response.setHeader("cache-control", "no-store");
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("content-length", String(Buffer.byteLength(body)));
  response.setHeader("x-content-type-options", "nosniff");
  response.end(body);
}

function statusForError(error) {
  if (error instanceof RangeError || error instanceof TypeError) return 400;
  if (/capacity/i.test(String(error?.message || ""))) return 429;
  return 500;
}

export function publicError(error, status) {
  if (typeof error?.publicCode === "string") return error.publicCode;
  if (status < 500) {
    return redactAbsolutePaths(String(error?.message || "invalid_request"))
      .replace(/\s+/g, " ")
      .slice(0, 300);
  }
  return "local_media_internal_error";
}

// Машинный код ошибки: явный publicCode, иначе — детерминированно от статуса.
// Сообщения провайдеров/валидаторов сюда не попадают.
function errorCode(error, status) {
  if (typeof error?.publicCode === "string") return error.publicCode;
  switch (status) {
    case 400: return "local_media_invalid_input";
    case 403: return "local_media_forbidden";
    case 404: return "not_found";
    case 409: return "local_media_conflict";
    case 413: return "local_media_request_too_large";
    case 415: return "application_json_required";
    case 429: return "local_media_capacity";
    case 503: return "local_media_upstream_unavailable";
    default: return "local_media_internal_error";
  }
}

function redactAbsolutePaths(message) {
  return message
    .replace(/[A-Za-z]:\\[^\s"'<>]+/gu, "<path>")
    .replace(/\/[^\s"'<>]+/gu, "<path>");
}

class HttpError extends Error {
  constructor(statusCode, publicCode) {
    super(publicCode);
    this.statusCode = statusCode;
    this.publicCode = publicCode;
  }
}
