// Лёгкий стор джобов для wizard-драфта: браузерный reasoning-мост думает
// минутами, поэтому HTTP отдаёт 202 + id, а клиент опрашивает статус.
// Отдельно от render job-manager: здесь нет очереди, артефактов и QC.

import { randomUUID } from "node:crypto";

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_JOBS = 32;
const FINISHED_STATUSES = ["completed", "failed", "cancelled"];

export function createDraftJobManager({
  runDraft,
  now = () => new Date().toISOString(),
  idFactory = () => `draft_${randomUUID()}`,
  ttlMs = DEFAULT_TTL_MS,
  maxJobs = DEFAULT_MAX_JOBS
} = {}) {
  if (typeof runDraft !== "function") throw new TypeError("runDraft is required");
  if (typeof now !== "function") throw new TypeError("now must be a function");
  if (typeof idFactory !== "function") throw new TypeError("idFactory must be a function");
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1000) throw new RangeError("ttlMs must be at least 1000");
  if (!Number.isSafeInteger(maxJobs) || maxJobs < 1 || maxJobs > 256) {
    throw new RangeError("maxJobs must be within 1..256");
  }

  const jobs = new Map();

  function submit(params = {}) {
    const topic = requireTopic(params.topic);
    evictJobs();
    if (jobs.size >= maxJobs) {
      throw Object.assign(new Error("draft_jobs_capacity"), {
        statusCode: 429,
        publicCode: "draft_jobs_capacity"
      });
    }

    const record = {
      id: String(idFactory()),
      status: "queued",
      createdAt: now(),
      finishedAt: null,
      controller: new AbortController(),
      board: null,
      warnings: [],
      error: null
    };
    jobs.set(record.id, record);
    // Параметры живут только в замыкании исполнителя: наружу через get() уходит
    // публичный вид, в котором их нет вовсе.
    void execute(record, { ...params, topic });
    return publicJob(record);
  }

  function get(id) {
    const record = jobs.get(String(id || ""));
    return record ? publicJob(record) : null;
  }

  // Контракт отмены (the cancel contract, «Правила идемпотентности»):
  //   queued|running → job СРАЗУ терминально cancelled (наружу не выходит
  //     промежуточный статус), abort прерывает таймеры/запросы исполнителя;
  //   cancelled → идемпотентный повтор: тот же исход "cancelled", без ошибки;
  //   completed|failed → терминальные состояния неизменны: "not_cancellable";
  //   неизвестный id → "not_found".
  // Возвращает { outcome: "cancelled"|"not_found"|"not_cancellable", job }.
  function cancel(id) {
    const record = jobs.get(String(id || ""));
    if (!record) return { outcome: "not_found", job: null };
    if (record.status === "cancelled") return { outcome: "cancelled", job: publicJob(record) };
    if (record.status === "completed" || record.status === "failed") {
      return { outcome: "not_cancellable", job: publicJob(record) };
    }
    markFinished(record, "cancelled");
    record.controller.abort(new Error("draft_job_cancelled"));
    return { outcome: "cancelled", job: publicJob(record) };
  }

  async function execute(record, params) {
    record.status = "running";
    try {
      const result = await runDraft({ ...params, signal: record.controller.signal });
      // Поздний успех после отмены отбрасывается: cancelled — терминальный
      // статус, job не имеет права стать completed (даже если upstream-HTTP
      // физически не прервался и всё же вернул борд).
      if (record.status === "cancelled" || record.controller.signal.aborted) return;
      record.board = result?.board ?? null;
      record.warnings = stringList(result?.warnings);
      markFinished(record, "completed");
    } catch (error) {
      // Поздняя ошибка после отмены тоже отбрасывается: статус и публичное
      // сообщение отменённого job не меняются.
      if (record.status === "cancelled" || record.controller.signal.aborted) {
        markFinished(record, "cancelled");
        return;
      }
      markFinished(record, "failed");
      record.error = sanitizeErrorMessage(error);
    }
  }

  // Терминальный переход фиксирует finishedAt один раз: от него (а не от
  // createdAt) считается TTL — long-draft, работавший дольше ttl, после
  // завершения остаётся опрашиваемым ещё полный ttl (resume после reload).
  function markFinished(record, status) {
    record.status = status;
    if (!record.finishedAt) record.finishedAt = now();
  }

  function evictJobs() {
    const deadline = Date.parse(now()) - ttlMs;
    for (const [id, record] of jobs) {
      // Активные (queued|running) не вычищаются НИКОГДА — только терминальные,
      // и только спустя ttl после их терминального перехода (терминал+TTL).
      if (!FINISHED_STATUSES.includes(record.status)) continue;
      const finishedAt = Date.parse(record.finishedAt || record.createdAt);
      if (Number.isFinite(deadline) && Number.isFinite(finishedAt) && finishedAt > deadline) continue;
      jobs.delete(id);
    }
    // Map хранит порядок вставки, поэтому первыми выбывают самые старые завершённые.
    for (const [id, record] of jobs) {
      if (jobs.size < maxJobs) break;
      if (!FINISHED_STATUSES.includes(record.status)) continue;
      jobs.delete(id);
    }
  }

  return Object.freeze({ submit, get, cancel });
}

function requireTopic(value) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError("draft topic is required");
  return value;
}

function publicJob(record) {
  return structuredClone({
    id: record.id,
    status: record.status,
    createdAt: record.createdAt,
    board: record.status === "completed" ? record.board : null,
    warnings: record.warnings,
    error: record.error
  });
}

function stringList(values) {
  return Array.isArray(values) ? values.map(String).filter(Boolean) : [];
}

// Наружу уходит только сообщение без стека и без абсолютных путей.
function sanitizeErrorMessage(error) {
  return String(error?.message || error || "draft_failed")
    .slice(0, 500)
    .replace(/[A-Za-z]:\\[^\s"'<>]+/gu, "<path>")
    .replace(/\/[^\s"'<>]+/gu, "<path>");
}
