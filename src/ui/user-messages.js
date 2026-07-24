// Pure, framework-free mapping of machine error codes/messages to user-facing Russian text.
// Goal (PHASE-5 criterion 9): no HTTP codes, poll-timeout tokens, stack traces or raw JSON
// ever reach the UI. Callers pass a caught error (or bare string) + a flow context; they get
// back one friendly sentence. Imported by the browser SPA (src/app.js) and unit-tested directly
// under node --test (test/unit/user-messages.test.mjs) — no DOM dependency.

// Known machine codes → friendly text. Keep keys 1:1 with codes thrown in app.js / returned in
// error.payload.code so the mapping stays discoverable.
const CODE_MESSAGES = Object.freeze({
  draft_poll_timeout: "Сборка черновика заняла слишком долго. Попробуй ещё раз или выбери более быструю модель.",
  local_render_poll_timeout: "Рендер занял слишком долго. Попробуй ещё раз.",
  draft_job_not_found: "Задача уже завершилась — обновлять нечего.",
  draft_job_not_cancellable: "Задачу уже нельзя отменить — она завершается.",
  local_media_job_not_found: "Рендер уже завершился — отменять нечего.",
  local_media_job_not_cancellable: "Рендер уже завершается — отмена невозможна.",
  api_key_required: "Нужен API-ключ выбранного провайдера.",
  bridge_unavailable: "Генерация недоступна: подключи свой API-ключ или запусти мост.",
  edition_language_required: "Выбери язык издания.",
  edition_language_invalid: "Такой язык издания не поддерживается.",
  edition_project_invalid: "Сначала собери готовый ролик, затем создай издание.",
  edition_model_invalid: "Модель перевода указана неверно. Проверь настройки."
});

// Per-flow generic fallback used only when no specific code matched. Keeps the message honest
// without inventing detail.
const CONTEXT_FALLBACK = Object.freeze({
  draft: "Не удалось собрать черновик. Попробуй ещё раз.",
  render: "Не удалось выполнить рендер. Попробуй ещё раз.",
  provider: "Ключ не принят. Проверь значение и попробуй снова.",
  account: "Сервис аккаунта сейчас недоступен. Попробуй позже.",
  research: "Не удалось получить источники. Попробуй ещё раз.",
  edition: "Не удалось создать издание. Попробуй ещё раз.",
  generic: "Что-то пошло не так. Попробуй ещё раз."
});

// Extract the most specific code we can from a caught error without ever returning free-form text.
// Priority: explicit backend code → error.message → synthesized http_<status>.
export function resolveErrorCode(error) {
  if (!error) return "";
  if (typeof error === "string") return error.trim();
  const payload = error.payload && typeof error.payload === "object" ? error.payload : null;
  const payloadCode = payload && typeof payload.code === "string" ? payload.code.trim() : "";
  if (payloadCode) return payloadCode;
  const message = typeof error.message === "string" ? error.message.trim() : "";
  if (message) return message;
  const status = payload && Number.isFinite(payload.status) ? payload.status : null;
  return status ? `http_${status}` : "";
}

// Map http_/catalog_<status> tokens to a friendly sentence by status class.
export function httpStatusMessage(code) {
  const match = /^(?:http|catalog)_(\d{3})$/.exec(String(code || ""));
  if (!match) return "";
  const status = Number(match[1]);
  if (status === 401 || status === 403) return "Нет доступа: проверь API-ключ или права.";
  if (status === 404) return "Ничего не найдено.";
  if (status === 408 || status === 429) return "Слишком много запросов или таймаут. Подожди и попробуй ещё раз.";
  if (status >= 400 && status < 500) return "Запрос отклонён. Проверь введённые данные.";
  if (status >= 500) return "Сервис временно недоступен. Попробуй ещё раз позже.";
  return "";
}

// True when text is a bare machine token (snake/kebab/dotted code, http_500, JSON-ish) with no
// human words — such strings must never be shown verbatim.
export function looksLikeMachineCode(text) {
  const value = String(text || "").trim();
  if (!value) return false;
  if (/[Ѐ-ӿ]/.test(value)) return false; // contains Cyrillic → human sentence
  if (/[{}\[\]<>]/.test(value)) return true;        // JSON / markup fragment
  if (/\s/.test(value)) return false;               // has spaces → treat as human phrase
  return /^[a-z0-9]+(?:[_:.\-][a-z0-9]+)*$/i.test(value); // token_like.code:v1
}

// Main entry: caught error + flow context → one friendly sentence, never a raw code.
export function friendlyErrorMessage(error, context = "generic") {
  const code = resolveErrorCode(error);
  if (code && Object.prototype.hasOwnProperty.call(CODE_MESSAGES, code)) return CODE_MESSAGES[code];
  const httpMessage = httpStatusMessage(code);
  if (httpMessage) return httpMessage;
  return CONTEXT_FALLBACK[context] || CONTEXT_FALLBACK.generic;
}

// For already-human backend detail strings (e.g. job.error): keep genuine RU detail, but scrub
// bare machine tokens/JSON to a friendly sentence. Returns "" for empty input.
export function humanizeDetail(text, context = "generic") {
  const value = String(text || "").trim();
  if (!value) return "";
  if (Object.prototype.hasOwnProperty.call(CODE_MESSAGES, value)) return CODE_MESSAGES[value];
  const httpMessage = httpStatusMessage(value);
  if (httpMessage) return httpMessage;
  if (looksLikeMachineCode(value)) return CONTEXT_FALLBACK[context] || CONTEXT_FALLBACK.generic;
  return value.slice(0, 160);
}
