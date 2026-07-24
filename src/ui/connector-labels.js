// Human-readable labels for the provider diagnostics panel (PHASE-5 criteria #2 and #10).
// Turns the machine states/blockers from /api/product?route=connectors/capabilities into
// friendly Russian labels, and derives a free/paid/no-key access badge from the catalog.
// Pure + DOM-free; unit-tested in test/unit/connector-labels.test.mjs.

const CAPABILITY_NAMES = Object.freeze({
  "text.generate": "Сценарий (генерация текста)",
  "research.search": "Поиск источников",
  "media.search": "Стоковые медиа",
  "image.generate": "Генерация изображений",
  "speech.synthesize": "Озвучка",
  "speech.transcribe": "Расшифровка речи",
  "video.generate": "Генерация видео",
  "storage.put": "Облачное хранилище",
  "publish.draft": "Публикация",
  "analytics.read": "Аналитика площадок"
});

export function capabilityName(id) {
  return CAPABILITY_NAMES[id] || String(id || "");
}

// Whole-capability status → {label, tone}. tone drives the colour class in the UI.
const CAPABILITY_STATUS = Object.freeze({
  working_adapter: { label: "Готово", tone: "ok" },
  configured_adapter: { label: "Готово", tone: "ok" },
  configured_but_adapter_missing: { label: "Настроено, коннектор не готов", tone: "warn" },
  oauth_skeleton: { label: "Нужно OAuth-подключение", tone: "muted" },
  approval_required: { label: "Только через ручное одобрение", tone: "warn" },
  blocked: { label: "Недоступно", tone: "muted" }
});

export function capabilityStatusLabel(capability) {
  const cap = capability || {};
  if (cap.executable) return { label: "Готово", tone: "ok" };
  return CAPABILITY_STATUS[cap.state] || { label: "Недоступно", tone: "muted" };
}

// Machine blocker code → human reason (empty string for unknown, so callers can skip it).
const BLOCKER_REASONS = Object.freeze({
  runtime_not_supported: "Недоступно в текущем режиме запуска.",
  adapter_not_implemented: "Коннектор ещё не реализован.",
  oauth_token_exchange_not_implemented: "Обмен OAuth-токена ещё не реализован.",
  provider_credentials_missing: "Не хватает ключа или доступа провайдера.",
  immutable_publish_candidate_required: "Нужен зафиксированный кандидат на публикацию.",
  explicit_human_approval_required: "Нужно явное одобрение человека.",
  autopublishing_disabled: "Автопубликация отключена."
});

export function blockerLabel(code) {
  return BLOCKER_REASONS[code] || "";
}

// First human-readable reason among a capability's blockers ("" when all unknown/none).
export function capabilityReason(capability) {
  const blockers = Array.isArray(capability?.blockers) ? capability.blockers : [];
  for (const code of blockers) {
    const reason = blockerLabel(code);
    if (reason) return reason;
  }
  return "";
}

// Per-provider state → installed/configured/healthy/unavailable label.
const PROVIDER_STATE = Object.freeze({
  working_adapter: { label: "готов", tone: "ok" },
  configured_adapter: { label: "настроен", tone: "ok" },
  configured_but_adapter_missing: { label: "настроен, коннектор не готов", tone: "warn" },
  oauth_skeleton: { label: "нужен OAuth", tone: "muted" },
  blocked: { label: "недоступен", tone: "muted" }
});

export function providerStateLabel(provider) {
  const state = provider && typeof provider === "object" ? provider.state : provider;
  return PROVIDER_STATE[state] || { label: "недоступен", tone: "muted" };
}

// Free vs paid vs no-key badge (criterion #10), from catalog freeMode + auth mode.
const ACCESS_BY_FREEMODE = Object.freeze({
  no_key: { label: "Без ключа", tone: "free" },
  free_tier: { label: "Бесплатный тариф", tone: "free" },
  free_plan: { label: "Бесплатный тариф", tone: "free" },
  paid_or_trial: { label: "Платный / триал", tone: "paid" }
});

export function accessBadge(provider = {}) {
  const auth = provider.auth;
  if (auth === "none") return { label: "Без ключа", tone: "free" };
  if (auth === "oauth") return { label: "OAuth-аккаунт", tone: "oauth" };
  const byFreeMode = ACCESS_BY_FREEMODE[provider.freeMode];
  if (byFreeMode) return byFreeMode;
  return { label: "Свой ключ", tone: "byok" };
}
