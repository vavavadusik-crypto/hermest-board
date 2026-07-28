import { normalizeCardImageUrl, renderCardImage } from "./card-image.js";
import { friendlyErrorMessage, humanizeDetail, resolveErrorCode } from "./ui/user-messages.js";
import {
  capabilityName,
  capabilityStatusLabel,
  capabilityReason,
  providerStateLabel,
  accessBadge
} from "./ui/connector-labels.js";
import { buildDemoProject } from "./ui/demo-project.js";
import {
  DEFAULT_TARGET_DURATION_SECONDS,
  DURATION_QUICK_MARKS,
  DURATION_SLIDER_MAX_POSITION,
  describeDurationHint,
  resolveTypedDuration,
  secondsToSliderPosition,
  sliderPositionToSeconds,
  snapDurationSeconds
} from "./ui/duration-input.js";
import {
  buildDurationWarning,
  countNarrationCharacters,
  deriveSceneCountFromDuration,
  describeDurationBudget,
  DURATION_PLAN_LIMITS,
  estimateNarrationDurationMs,
  formatDurationLabel,
  normalizeTargetDurationSeconds
} from "./domain/duration-plan.js";
import { createWireRenderer } from "./ui/wire-renderer.js";

    const STORAGE_KEY = "hermest-board:v1";
    const AI_SETTINGS_LOCAL_KEY = "hermest-board:ai-settings:v1";
    const AI_SETTINGS_SESSION_KEY = "hermest-board:ai-settings:session:v1";
    const USER_API_KEYS_LOCAL_KEY = "hermest-board:user-api-keys:v1";
    const USER_API_KEYS_SESSION_KEY = "hermest-board:user-api-keys:session:v1";
    const CONTENT_VERSION = 4;
    const BOARD_WIDTH = 3000;
    const BOARD_HEIGHT = 1800;
    const API_PROVIDER_CATEGORIES = [
      ["all", "Все"],
      ["ai_text", "AI text"],
      ["ai_router", "AI router"],
      ["image_video", "Фото / видео"],
      ["speech", "Голос"],
      ["search_research", "Поиск / research"],
      ["design_assets", "Дизайн / бренд-ассеты"],
      ["social_publish", "Публикация"],
      ["automation", "Automation"],
      ["storage_db", "Storage / DB"],
      ["email", "Email"],
      ["payments", "Payments"]
    ];
    const AI_PROVIDER_DEFAULT_MODELS = {
      openai: "gpt-4.1-mini",
      groq: "llama-3.3-70b-versatile",
      mistral: "mistral-small-latest",
      openrouter: "openai/gpt-4.1-mini",
      deepseek: "deepseek-chat",
      together: "meta-llama/Llama-3.3-70B-Instruct-Turbo"
    };
    const FALLBACK_API_PROVIDER_CATALOG = [
      { id: "openai", name: "OpenAI", category: "ai_text", auth: "api_key", freeMode: "paid_or_trial", env: "OPENAI_API_KEY", docs: "https://platform.openai.com/docs", signup: "https://platform.openai.com/api-keys", use: "Primary BYOK AI assistant", status: "working_ai" },
      { id: "gemini", name: "Google Gemini API", category: "ai_text", auth: "api_key", freeMode: "free_tier", env: "GEMINI_API_KEY", docs: "https://ai.google.dev/gemini-api/docs", signup: "https://aistudio.google.com/apikey", use: "Alternative multimodal AI provider", status: "key_slot" },
      { id: "groq", name: "Groq", category: "ai_text", auth: "api_key", freeMode: "free_plan", env: "GROQ_API_KEY", docs: "https://console.groq.com/docs/quickstart", signup: "https://console.groq.com/keys", use: "Fast OpenAI-compatible chat models", status: "key_slot" },
      { id: "wikipedia", name: "Wikipedia / Wikimedia APIs", category: "search_research", auth: "none", freeMode: "no_key", env: "", docs: "https://www.mediawiki.org/wiki/Wikimedia_APIs", signup: "", use: "No-key encyclopedic research", status: "working_public_search" },
      { id: "wikidata", name: "Wikidata", category: "search_research", auth: "none", freeMode: "no_key", env: "", docs: "https://www.wikidata.org/wiki/Wikidata:Data_access", signup: "", use: "No-key entity search", status: "working_public_search" },
      { id: "commons", name: "Wikimedia Commons", category: "image_video", auth: "none", freeMode: "no_key", env: "", docs: "https://commons.wikimedia.org/wiki/Commons:API", signup: "", use: "No-key media search with license metadata", status: "working_public_search" },
      { id: "crossref", name: "Crossref REST API", category: "search_research", auth: "none", freeMode: "no_key", env: "SUPPORT_EMAIL", docs: "https://www.crossref.org/documentation/retrieve-metadata/rest-api/", signup: "", use: "No-key publication metadata", status: "working_public_search" },
      { id: "openlibrary", name: "Open Library", category: "search_research", auth: "none", freeMode: "no_key", env: "", docs: "https://openlibrary.org/developers/api", signup: "", use: "No-key books and author metadata", status: "working_public_search" }
    ];
    const board = document.getElementById("board");
    const boardWrap = document.getElementById("boardWrap");
    const wire = document.getElementById("wire");
    const deckTitle = document.getElementById("deckTitle");
    const imageInput = document.getElementById("imageInput");
    const jsonInput = document.getElementById("jsonInput");
    const sidePanel = document.getElementById("sidePanel");
    const modePanelTitle = document.getElementById("modePanelTitle");
    const modeTablist = document.getElementById("modeTablist");
    const modeTabs = Array.from(modeTablist.querySelectorAll('[role="tab"]'));
    const togglePanelButton = document.getElementById("togglePanel");
    const statusEl = document.getElementById("status");
    const rotateInput = document.getElementById("rotateInput");
    const rotateValue = document.getElementById("rotateValue");
    const zoomInput = document.getElementById("zoomInput");
    const zoomValue = document.getElementById("zoomValue");
    const tagInput = document.getElementById("tagInput");
    const colorInput = document.getElementById("colorInput");
    const planInput = document.getElementById("planInput");
    const roadmapInput = document.getElementById("roadmapInput");
    const scriptOutput = document.getElementById("scriptOutput");
    const planFileInput = document.getElementById("planFileInput");
    const roadmapFileInput = document.getElementById("roadmapFileInput");
    const platformChecks = document.getElementById("platformChecks");
    const toolChecks = document.getElementById("toolChecks");
    const languageInput = document.getElementById("languageInput");
    const mediaBriefInput = document.getElementById("mediaBriefInput");
    const publishOutput = document.getElementById("publishOutput");
    const localRenderPlatform = document.getElementById("localRenderPlatform");
    const localRenderStatus = document.getElementById("localRenderStatus");
    const localRenderElapsed = document.getElementById("localRenderElapsed");
    const localRenderAnalytics = document.getElementById("localRenderAnalytics");
    const localRenderArtifacts = document.getElementById("localRenderArtifacts");
    const renderLocalVideoButton = document.getElementById("renderLocalVideo");
    const cancelLocalRenderButton = document.getElementById("cancelLocalRender");
    const editionPanel = document.getElementById("editionPanel");
    const editionLanguageSelect = document.getElementById("editionLanguage");
    const createEditionButton = document.getElementById("createEdition");
    const editionStatus = document.getElementById("editionStatus");
    const wizardTopicInput = document.getElementById("wizardTopic");
    const wizardSceneCountInput = document.getElementById("wizardSceneCount");
    const wizardResearchInput = document.getElementById("wizardResearch");
    const wizardCartoonInput = document.getElementById("wizardCartoon");
    const seriesTopicInput = document.getElementById("seriesTopic");
    const seriesEpisodesInput = document.getElementById("seriesEpisodes");
    const seriesPlanButton = document.getElementById("seriesPlan");
    const seriesStatus = document.getElementById("seriesStatus");
    const seriesList = document.getElementById("seriesList");
    const boardChatForm = document.getElementById("boardChat");
    const boardChatInput = document.getElementById("boardChatInput");
    const boardChatSend = document.getElementById("boardChatSend");
    const boardChatLog = document.getElementById("boardChatLog");
    const wizardDraftButton = document.getElementById("wizardDraft");
    const wizardCancelButton = document.getElementById("wizardCancel");
    const wizardModelSelect = document.getElementById("wizardModel");
    const wizardByokConfig = document.getElementById("wizardByokConfig");
    const wizardByokBaseUrl = document.getElementById("wizardByokBaseUrl");
    const wizardByokModel = document.getElementById("wizardByokModel");
    const wizardByokKey = document.getElementById("wizardByokKey");
    const wizardStatus = document.getElementById("wizardStatus");
    const wizardElapsed = document.getElementById("wizardElapsed");
    const commandBar = document.getElementById("commandBar");
    const commandSettings = document.getElementById("commandSettings");
    const durationSlider = document.getElementById("durationSlider");
    const durationValueInput = document.getElementById("durationValue");
    const durationHint = document.getElementById("durationHint");
    const durationWarning = document.getElementById("durationWarning");
    const durationNotice = document.getElementById("durationNotice");
    const durationQuick = document.getElementById("durationQuick");
    const durationMarks = document.getElementById("durationMarks");
    const sceneCountHint = document.getElementById("sceneCountHint");
    const topbar = document.querySelector(".topbar");

    // Топбар растёт вместе с командной строкой и раскрытыми настройками, поэтому
    // боковая панель узнаёт его фактическую высоту, а не догадывается о ней.
    function syncTopbarHeight() {
      if (!topbar) return;
      document.documentElement.style.setProperty("--topbar-height", `${Math.round(topbar.offsetHeight)}px`);
    }

    if (topbar && typeof ResizeObserver === "function") {
      new ResizeObserver(syncTopbarHeight).observe(topbar);
    }
    window.addEventListener("resize", syncTopbarHeight);
    syncTopbarHeight();

    // OpenAI-совместимые провайдеры: свой ключ ИЛИ бесплатный. baseUrl совпадает
    // с OPENAI_COMPATIBLE_PRESETS на сервере; "" = свой URL (пользователь вводит).
    const WIZARD_BYOK_PRESETS = [
      { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
      { id: "groq", label: "Groq", baseUrl: "https://api.groq.com/openai/v1" },
      { id: "together", label: "Together AI", baseUrl: "https://api.together.xyz/v1" },
      { id: "deepseek-api", label: "DeepSeek API", baseUrl: "https://api.deepseek.com" },
      { id: "mistral", label: "Mistral AI", baseUrl: "https://api.mistral.ai/v1" },
      { id: "huggingface", label: "Hugging Face", baseUrl: "https://router.huggingface.co/v1" },
      { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1" },
      { id: "ollama", label: "Ollama (локально)", baseUrl: "http://127.0.0.1:11434/v1" },
      { id: "custom", label: "Свой URL…", baseUrl: "" }
    ];
    const narrationLanguageSelect = document.getElementById("narrationLanguage");
    const narrationVoiceSelect = document.getElementById("narrationVoice");
const narrationVoicePreview = document.getElementById("narrationVoicePreview");
let voicePreviewPlayer = null;
    const narrationProviderSelect = document.getElementById("narrationProvider");
    const musicBedSelect = document.getElementById("musicBed");
    const generateVisualsToggle = document.getElementById("generateVisualsToggle");
    const brollModeSelect = document.getElementById("brollMode");
    // Держим в синхроне с VALID_BROLL_MODES в src/media/render-project.js
    const BROLL_MODES = ["auto", "free", "premium", "deterministic"];
    const narrationHint = document.getElementById("narrationHint");

    const NARRATION_LANGUAGES = [
      { code: "ru", label: "Русский", piper: true },
      { code: "en", label: "English", piper: true },
      { code: "es", label: "Español", piper: true },
      { code: "de", label: "Deutsch", piper: true },
      { code: "fr", label: "Français", piper: true },
      { code: "pt", label: "Português — ElevenLabs", piper: false },
      { code: "it", label: "Italiano — ElevenLabs", piper: false },
      { code: "ja", label: "日本語 — ElevenLabs", piper: false },
      { code: "zh", label: "中文 — ElevenLabs", piper: false }
    ];
    // Та же форма, что проверяет адаптер ElevenLabs перед запросом.
    const ELEVENLABS_VOICE_ID_PATTERN = /^[A-Za-z0-9]{8,64}$/;
    const NARRATION_VOICES = {
      ru: [
        { id: "", label: "Авто — Дмитрий (Piper)" },
        { id: "ru_RU-dmitri-medium", label: "Дмитрий (Piper)" },
        { id: "ru_RU-irina-medium", label: "Ирина (Piper)" }
      ],
      en: [
        { id: "", label: "Авто — Lessac (Piper)" },
        { id: "en_US-lessac-medium", label: "Lessac (Piper)" }
      ],
      es: [
        { id: "", label: "Авто — DaveFX (Piper)" },
        { id: "es_ES-davefx-medium", label: "DaveFX (Piper)" }
      ],
      de: [
        { id: "", label: "Авто — Thorsten (Piper)" },
        { id: "de_DE-thorsten-medium", label: "Thorsten (Piper)" }
      ],
      fr: [
        { id: "", label: "Авто — Siwis (Piper)" },
        { id: "fr_FR-siwis-medium", label: "Siwis (Piper)" }
      ]
    };
    const researchQueryInput = document.getElementById("researchQueryInput");
    const openSettingsButton = document.getElementById("openSettings");
    const settingsDialog = document.getElementById("settingsDialog");
    const closeSettingsButton = document.getElementById("closeSettings");
    const settingsTablist = document.getElementById("settingsTablist");
    const settingsTabs = Array.from(settingsTablist.querySelectorAll('[role="tab"]'));
    const aiProviderInput = document.getElementById("aiProvider");
    const aiModelInput = document.getElementById("aiModel");
    const aiKeyInput = document.getElementById("aiKey");
    const aiRememberInput = document.getElementById("aiRemember");
    const aiPromptInput = document.getElementById("aiPrompt");
    const aiResponseOutput = document.getElementById("aiResponseOutput");
    const accountStatus = document.getElementById("accountStatus");
    const accountEmailInput = document.getElementById("accountEmail");
    const accountDisplayNameInput = document.getElementById("accountDisplayName");
    const accountPasswordInput = document.getElementById("accountPassword");
    const userApiKeyList = document.getElementById("userApiKeyList");
    const apiCatalogCategory = document.getElementById("apiCatalogCategory");
    const userApiKeyProvider = document.getElementById("userApiKeyProvider");
    const apiProviderInfo = document.getElementById("apiProviderInfo");
    const userApiKeyLabel = document.getElementById("userApiKeyLabel");
    const userApiKeyValue = document.getElementById("userApiKeyValue");

    const state = loadState();
    let apiProviderCatalog = normalizeApiProviderCatalog(FALLBACK_API_PROVIDER_CATALOG);
    let aiSettings = loadAiSettings();
    let userApiKeys = loadUserApiKeys();
    let latestAiResponse = "";
    let selectedId = state.cards[0]?.id || null;
    let zCounter = Math.max(...state.cards.map(c => c.z || 1), 10);
    let mediaTargetId = null;
    let connectMode = false;
    let connectFirst = null;
    let tourAbort = false;
    let activeRecorder = null;
    let activeStream = null;
    let activeLocalRenderJobId = null;
    let localRenderPollToken = 0;
    let renderCancelInFlight = false;

    // Индикатор активности + истёкшее время для длинных операций (draft/render).
    // Элемент aria-hidden — тикающее время не спамит скринридер; статус объявляет live-region.
    function createElapsedTimer(el) {
      let intervalId = null;
      let startMs = 0;
      const paint = () => {
        const total = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
        el.textContent = `Идёт · ${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
      };
      const stop = () => {
        if (intervalId) { clearInterval(intervalId); intervalId = null; }
        el.hidden = true;
      };
      const start = fromMs => {
        stop();
        startMs = Number.isFinite(fromMs) ? fromMs : Date.now();
        el.hidden = false;
        paint();
        intervalId = setInterval(paint, 1000);
      };
      return { start, stop };
    }
    const wizardElapsedTimer = createElapsedTimer(wizardElapsed);
    const localRenderElapsedTimer = createElapsedTimer(localRenderElapsed);

    // Персист id активных задач, чтобы переподключиться к ним после reload.
    const ACTIVE_JOBS_KEY = "hermest-board:active-jobs:v1";
    function readActiveJobs() {
      try {
        const parsed = JSON.parse(localStorage.getItem(ACTIVE_JOBS_KEY) || "{}");
        return parsed && typeof parsed === "object" ? parsed : {};
      } catch {
        return {};
      }
    }
    function persistActiveJob(kind, jobId) {
      const next = readActiveJobs();
      next[kind] = jobId;
      try { localStorage.setItem(ACTIVE_JOBS_KEY, JSON.stringify(next)); } catch (_) {}
    }
    function clearActiveJob(kind) {
      const next = readActiveJobs();
      delete next[kind];
      try { localStorage.setItem(ACTIVE_JOBS_KEY, JSON.stringify(next)); } catch (_) {}
    }
    let drag = null;
    const cardElements = new Map();
    const wireRenderer = createWireRenderer({
      wire,
      boardWidth: BOARD_WIDTH,
      boardHeight: BOARD_HEIGHT
    });

    function starterState() {
      return {
        schemaVersion: CONTENT_VERSION,
        title: "Hermest: оболочка над ИИ-агентами",
        view: { x: -120, y: -120, zoom: 1 },
        // Фоны сцен включены с самого начала: Pollinations бесплатен и не просит
        // ключа, а «Собрать видео» без них отдаёт тёмную подложку вместо
        // обещанной интерфейсом картинки. Демо-доска остаётся на false осознанно
        // (см. demo-project.test.mjs) — пример обязан открываться офлайн.
        brief: { language: "ru", voice: "", narrationProvider: "", music: "", generateVisuals: true, brollMode: "auto" },
        plan: [
          "1. Объяснить проблему: один чат быстро превращается в хаос, если в нем смешаны роли, память, инструменты и задачи.",
          "2. Показать Hermest как оболочку: один управляемый слой над агентами, файлами, API, памятью и логами.",
          "3. Разложить архитектуру по карточкам: вход пользователя, ядро Hermest, маршрутизатор, агенты, инструменты, память, контроль, безопасность, результат.",
          "4. В конце показать, как из борда получается сценарий, озвучка, видео и roadmap продукта."
        ].join("\n"),
        roadmap: [
          "MVP: интерактивный борд, карточки, фото, связи, план, roadmap, сценарий и озвучка.",
          "Следующий шаг: подключить локальную память, Graphify, шаблоны ролей агентов и импорт материалов.",
          "Дальше: автосборка видео из борда, планов, найденных материалов и озвучки.",
          "Цель: инструмент, который помогает быстро превращать знания и разработки в обучающий контент и продукт."
        ].join("\n"),
        script: "",
        server: {
          projectId: "",
          lastSyncedAt: "",
          storageStatus: ""
        },
        publish: {
          platforms: ["tiktok", "youtube_video", "youtube_shorts", "instagram_reels"],
          tools: ["parser", "translator", "web_media", "generated_media", "rights_check", "scheduler"],
          languages: "ru, en, de",
          mediaBrief: "Собрать или сгенерировать вертикальные 9:16 фрагменты: нейросеть как рабочая среда, агентская маршрутизация, граф памяти, публикация контента. Стиль: техно-борд, киберпанель, чистая обучающая подача.",
          researchQuery: "Hermest AI agents automation knowledge graph content publishing",
          packageText: ""
        },
        links: [
          ["user", "hermest"],
          ["hermest", "router"],
          ["hermest", "agents"],
          ["hermest", "openlayer"],
          ["router", "tools"],
          ["router", "agents"],
          ["agents", "memory"],
          ["memory", "logs"],
          ["logs", "guardrails"],
          ["openlayer", "tools"],
          ["plan", "roadmap"],
          ["roadmap", "workflow"],
          ["workflow", "video"],
          ["video", "result"],
          ["video", "publish_agent"],
          ["publish_agent", "parser"],
          ["publish_agent", "translator"],
          ["publish_agent", "media_generator"],
          ["publish_agent", "platforms"],
          ["platforms", "auto_publish"],
          ["auto_publish", "business"],
          ["result", "business"]
        ],
        cards: [
          {
            id: "user", x: 110, y: 150, w: 310, h: 318, z: 2, rot: -3, color: "#5eead4",
            kicker: "идея",
            title: "Пользователь",
            text: "Ставит цель обычным языком: что объяснить, что собрать, что проверить, что снять на видео.",
            tags: ["input", "story"],
            image: visual("user", "USER INPUT", "цель, вопрос, контекст")
          },
          {
            id: "hermest", x: 500, y: 125, w: 380, h: 350, z: 12, rot: 0, color: "#f0abfc",
            kicker: "центр",
            title: "Hermest как оболочка",
            text: "Единый слой над ИИ-агентами: маршрутизация задач, роли, память, инструменты, права, логи и результат в одном управляемом контуре.",
            tags: ["agent wrapper", "control"],
            image: visual("core", "HERMEST CORE", "управляющий слой")
          },
          {
            id: "router", x: 970, y: 145, w: 330, h: 318, z: 7, rot: 2, color: "#38bdf8",
            kicker: "маршрутизация",
            title: "Маршрутизатор задач",
            text: "Разбирает запрос, выбирает нужного агента, модель, инструмент и формат результата. Так система работает предсказуемо.",
            tags: ["routing", "models"],
            image: visual("router", "TASK ROUTER", "выбор роли и инструмента")
          },
          {
            id: "agents", x: 1385, y: 135, w: 330, h: 330, z: 4, rot: 4, color: "#93c5fd",
            kicker: "агенты",
            title: "ИИ-агенты",
            text: "Каждый агент получает роль, контекст, инструменты и границы. Hermest держит их в системе, а не в хаотичном чате.",
            tags: ["roles", "tools"],
            image: visual("agents", "AI AGENTS", "команда ролей")
          },
          {
            id: "tools", x: 1800, y: 140, w: 330, h: 330, z: 5, rot: -2, color: "#60a5fa",
            kicker: "инструменты",
            title: "Инструменты и API",
            text: "Файлы, терминал, браузер, локальные сервисы, плагины и внешние API подключаются как управляемые способности.",
            tags: ["api", "terminal"],
            image: visual("tools", "TOOLS + API", "действия во внешнем мире")
          },
          {
            id: "workflow", x: 120, y: 555, w: 330, h: 330, z: 1, rot: -4, color: "#fb7185",
            kicker: "съёмка",
            title: "Сценарий видео",
            text: "Во время записи можно двигать блоки, показывать связи, приближать важное и постепенно раскрывать историю.",
            tags: ["video", "board"],
            image: visual("workflow", "VIDEO STORY", "объяснение через движение")
          },
          {
            id: "memory", x: 525, y: 555, w: 330, h: 330, z: 3, rot: 3, color: "#a7f3d0",
            kicker: "память",
            title: "Память и навыки",
            text: "Удачные решения превращаются в заметки, навыки, правила и повторяемые сценарии, чтобы не тратить токены заново.",
            tags: ["memory", "skills"],
            image: visual("memory", "MEMORY GRAPH", "знания и навыки")
          },
          {
            id: "openlayer", x: 940, y: 550, w: 360, h: 338, z: 6, rot: -2, color: "#facc15",
            kicker: "open layer",
            title: "Hermest как OpenClove",
            text: "Открытый слой, куда можно подключать плагины, локальные файлы, память, API, граф знаний и свои workflow.",
            tags: ["open", "plugins"],
            image: visual("open", "OPENCLOVE LAYER", "открытая оболочка")
          },
          {
            id: "logs", x: 1370, y: 545, w: 330, h: 330, z: 8, rot: 2, color: "#c084fc",
            kicker: "контроль",
            title: "Логи и проверка",
            text: "Каждое действие фиксируется: что сделано, почему, где результат, какие ошибки повторять нельзя.",
            tags: ["logs", "audit"],
            image: visual("logs", "TRACE LOGS", "проверяемость")
          },
          {
            id: "guardrails", x: 1790, y: 545, w: 330, h: 330, z: 9, rot: -3, color: "#f97316",
            kicker: "границы",
            title: "Права и безопасность",
            text: "Hermest должен понимать, что можно делать самому, где нужен контроль, какие действия опасны и что нельзя трогать.",
            tags: ["permissions", "safety"],
            image: visual("guard", "PERMISSION GATES", "границы действий")
          },
          {
            id: "plan", x: 295, y: 975, w: 360, h: 330, z: 10, rot: 1, color: "#22c55e",
            kicker: "план",
            title: "План проекта",
            text: "План прицеплен к борду: из него система понимает порядок объяснения, цель ролика и что нужно раскрыть подробно.",
            tags: ["plan", "attached"],
            image: visual("plan", "PROJECT PLAN", "структура объяснения")
          },
          {
            id: "roadmap", x: 745, y: 970, w: 360, h: 330, z: 11, rot: -2, color: "#eab308",
            kicker: "roadmap",
            title: "Roadmap",
            text: "Roadmap показывает этапы: MVP, подключение памяти, импорт материалов, генерация сценария, озвучка и видео.",
            tags: ["mvp", "roadmap"],
            image: visual("roadmap", "ROADMAP", "этапы продукта")
          },
          {
            id: "video", x: 1190, y: 970, w: 360, h: 330, z: 13, rot: 2, color: "#f472b6",
            kicker: "генератор",
            title: "Озвучка и видео",
            text: "Борд собирает сценарий из карточек, плана и roadmap, потом запускает авто-тур, озвучку и запись WebM.",
            tags: ["voice", "webm"],
            image: visual("voice", "VOICE + VIDEO", "авто-объяснение")
          },
          {
            id: "result", x: 1635, y: 965, w: 340, h: 330, z: 14, rot: -1, color: "#2dd4bf",
            kicker: "результат",
            title: "Готовый продукт",
            text: "На выходе получается не просто красивый борд, а производственная система: идея, знания, сценарий, видео и следующий шаг.",
            tags: ["output", "product"],
            image: visual("result", "FINAL OUTPUT", "контент и продукт")
          },
          {
            id: "business", x: 2045, y: 965, w: 330, h: 330, z: 15, rot: 3, color: "#fda4af",
            kicker: "монетизация",
            title: "Работа и заработок",
            text: "Цель системы - ускорять обучение, упаковку идей, демонстрации, поиск полезных инструментов и создание продаваемых материалов.",
            tags: ["business", "content"],
            image: visual("business", "VALUE LOOP", "знания в результат")
          },
          {
            id: "publish_agent", x: 115, y: 1350, w: 350, h: 330, z: 16, rot: -2, color: "#67e8f9",
            kicker: "агент",
            title: "Агент публикации",
            text: "Не останавливается на видео: собирает пакет, проверяет площадки, готовит версии и ведет очередь публикации.",
            tags: ["publishing", "agent"],
            image: visual("tools", "PUBLISH AGENT", "после генерации видео")
          },
          {
            id: "parser", x: 545, y: 1355, w: 330, h: 330, z: 17, rot: 2, color: "#34d399",
            kicker: "парсер",
            title: "Парсер источников",
            text: "Ищет материалы по теме, вытаскивает тезисы, ссылки, изображения, видео-референсы и складывает их в медиа-задачи.",
            tags: ["parser", "sources"],
            image: visual("logs", "SOURCE PARSER", "материалы и ссылки")
          },
          {
            id: "translator", x: 950, y: 1350, w: 330, h: 330, z: 18, rot: -1, color: "#a78bfa",
            kicker: "перевод",
            title: "Переводчик",
            text: "Готовит версии сценария, описаний, заголовков, субтитров и хэштегов под разные языки и аудитории.",
            tags: ["translate", "localize"],
            image: visual("open", "TRANSLATION", "мультиязычные версии")
          },
          {
            id: "media_generator", x: 1355, y: 1355, w: 350, h: 330, z: 19, rot: 1, color: "#fb7185",
            kicker: "медиа",
            title: "Генерация контекстного видео",
            text: "Создает или подбирает кадры под смысл: фон, b-roll, иллюстрации, вертикальные клипы, превью и обложки.",
            tags: ["video gen", "assets"],
            image: visual("voice", "MEDIA ENGINE", "контекстные кадры")
          },
          {
            id: "platforms", x: 1805, y: 1350, w: 350, h: 330, z: 20, rot: -2, color: "#facc15",
            kicker: "коннекторы",
            title: "TikTok / YouTube / Instagram",
            text: "Площадки подключаются через OAuth/API. До подключения борд готовит publish pack, после подключения агент сможет выкладывать сам.",
            tags: ["tiktok", "youtube", "instagram"],
            image: visual("roadmap", "PLATFORM CONNECTORS", "аккаунты и API")
          },
          {
            id: "auto_publish", x: 2245, y: 1348, w: 350, h: 330, z: 21, rot: 2, color: "#2dd4bf",
            kicker: "автопостинг",
            title: "Автопубликация и отчёт",
            text: "Агент публикует, сохраняет ссылки, статус, ошибки, метрики и задачу на следующий выпуск.",
            tags: ["queue", "metrics"],
            image: visual("result", "AUTO PUBLISH", "постинг и отчёт")
          }
        ]
      };
    }

    function loadState() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return normalize(JSON.parse(raw));
      } catch (_) {}
      return starterState();
    }

    function normalize(input) {
      const base = starterState();
      const shouldUpgrade = Number(input.schemaVersion || 0) < CONTENT_VERSION;
      const cards = Array.isArray(input.cards) && input.cards.length ? input.cards : [];
      const knownCards = new Map(cards.map(card => [card.id, card]));
      const mergedCards = cards.length ? [...cards] : [];
      for (const baseCard of base.cards) {
        const existing = knownCards.get(baseCard.id);
        if (existing) {
          if (!existing.image) existing.image = baseCard.image;
          if (!existing.color) existing.color = baseCard.color;
          if (!Array.isArray(existing.tags) || !existing.tags.length) existing.tags = baseCard.tags;
        } else if (shouldUpgrade) {
          mergedCards.push(JSON.parse(JSON.stringify(baseCard)));
        }
      }
      for (const card of mergedCards) {
        if (card && typeof card === "object") card.image = normalizeCardImageUrl(card.image);
      }
      const links = Array.isArray(input.links) ? [...input.links] : [];
      if (shouldUpgrade) {
        for (const baseLink of base.links) {
          const exists = links.some(link => link[0] === baseLink[0] && link[1] === baseLink[1]);
          if (!exists) links.push([...baseLink]);
        }
      }
      return {
        schemaVersion: CONTENT_VERSION,
        title: input.title || base.title,
        view: input.view || base.view,
        brief: normalizeBrief(input.brief, base.brief),
        plan: typeof input.plan === "string" && input.plan.trim() ? input.plan : base.plan,
        roadmap: typeof input.roadmap === "string" && input.roadmap.trim() ? input.roadmap : base.roadmap,
        script: typeof input.script === "string" ? input.script : base.script,
        server: normalizeServer(input.server, base.server),
        publish: normalizePublish(input.publish, base.publish),
        links,
        cards: mergedCards.length ? mergedCards : base.cards
      };
    }

    function normalizeBrief(input, fallback) {
      const source = input && typeof input === "object" ? input : {};
      const language = NARRATION_LANGUAGES.some(entry => entry.code === source.language)
        ? source.language
        : fallback.language;
      const piperCoversLanguage = NARRATION_LANGUAGES.find(entry => entry.code === language)?.piper === true;
      const narrationProvider = piperCoversLanguage
        ? (source.narrationProvider === "elevenlabs" ? "elevenlabs" : "")
        : "elevenlabs";
      // У Piper список голосов конечен и известен заранее. У ElevenLabs голоса
      // живут в аккаунте пользователя, поэтому здесь проверяется форма id —
      // сам id всё равно ещё раз проверяет адаптер перед запросом к провайдеру.
      const voice = narrationProvider === "elevenlabs"
        ? (typeof source.voice === "string" && ELEVENLABS_VOICE_ID_PATTERN.test(source.voice) ? source.voice : "")
        : ((NARRATION_VOICES[language] || []).some(entry => entry.id === source.voice) ? source.voice : "");
      const music = source.music === "off"
        ? "off"
        : typeof source.music === "string"
          ? source.music.trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 24)
          : (fallback.music === "off" ? "off" : fallback.music || "");
      const generateVisuals = typeof source.generateVisuals === "boolean"
        ? source.generateVisuals
        : Boolean(fallback.generateVisuals);
      const brollMode = BROLL_MODES.includes(source.brollMode)
        ? source.brollMode
        : (BROLL_MODES.includes(fallback.brollMode) ? fallback.brollMode : "auto");
      // Цель длительности приходит из JSON проекта — источник недоверенный:
      // мусор и выход за лимиты домена молча превращаются в «цель не задана».
      const targetDuration = safeTargetDuration(source.targetDurationSeconds)
        ?? safeTargetDuration(fallback.targetDurationSeconds);
      return {
        language,
        voice,
        narrationProvider,
        music,
        generateVisuals,
        brollMode,
        ...(targetDuration === null ? {} : { targetDurationSeconds: targetDuration })
      };
    }

    function safeTargetDuration(value) {
      try {
        return normalizeTargetDurationSeconds(value ?? null);
      } catch (_) {
        return null;
      }
    }

    function normalizeServer(input, fallback) {
      const source = input && typeof input === "object" ? input : {};
      return {
        projectId: typeof source.projectId === "string" ? source.projectId : fallback.projectId,
        lastSyncedAt: typeof source.lastSyncedAt === "string" ? source.lastSyncedAt : fallback.lastSyncedAt,
        storageStatus: typeof source.storageStatus === "string" ? source.storageStatus : fallback.storageStatus
      };
    }

    function normalizePublish(input, fallback) {
      const source = input && typeof input === "object" ? input : {};
      return {
        platforms: Array.isArray(source.platforms) ? source.platforms : fallback.platforms,
        tools: Array.isArray(source.tools) ? source.tools : fallback.tools,
        languages: typeof source.languages === "string" && source.languages.trim() ? source.languages : fallback.languages,
        mediaBrief: typeof source.mediaBrief === "string" && source.mediaBrief.trim() ? source.mediaBrief : fallback.mediaBrief,
        researchQuery: typeof source.researchQuery === "string" && source.researchQuery.trim() ? source.researchQuery : fallback.researchQuery,
        packageText: typeof source.packageText === "string" ? source.packageText : fallback.packageText
      };
    }

    function saveState(message = "Сохранено") {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        statusEl.textContent = message;
      } catch (_) {
        statusEl.textContent = "Слишком много данных: уменьши фото или сделай экспорт JSON";
      }
      clearTimeout(saveState.timer);
      saveState.timer = setTimeout(() => statusEl.textContent = "Автосохранение включено", 1200);
    }

    function cardById(id) {
      return state.cards.find(c => c.id === id);
    }

    function setSelected(id) {
      selectedId = id;
      const card = cardById(id);
      document.querySelectorAll(".card").forEach(el => el.classList.toggle("selected", el.dataset.id === id));
      if (card) {
        rotateInput.value = card.rot || 0;
        rotateValue.textContent = `${Math.round(card.rot || 0)}°`;
        tagInput.value = (card.tags || []).join(", ");
        colorInput.value = card.color || "#5eead4";
      }
    }

    function render() {
      deckTitle.value = state.title;
      planInput.value = state.plan || "";
      roadmapInput.value = state.roadmap || "";
      scriptOutput.value = state.script || "";
      languageInput.value = state.publish?.languages || "";
      mediaBriefInput.value = state.publish?.mediaBrief || "";
      publishOutput.value = state.publish?.packageText || "";
      researchQueryInput.value = state.publish?.researchQuery || "";
      syncChecks(platformChecks, state.publish?.platforms || []);
      syncChecks(toolChecks, state.publish?.tools || []);
      board.querySelectorAll(".card").forEach(el => el.remove());
      cardElements.clear();
      for (const card of state.cards) {
        board.appendChild(createCard(card));
      }
      applyView();
      setSelected(selectedId);
      drawLinks();
      // Подсказка о длительности живёт от объёма текста доски — он меняется здесь.
      refreshDurationFeedback();
    }

    function createCard(card) {
      const el = document.createElement("article");
      el.className = "card";
      el.dataset.id = card.id;
      renderCardGeometry(el, card);
      el.style.zIndex = card.z || 1;
      el.style.setProperty("--card-accent", card.color || "#5eead4");
      cardElements.set(card.id, el);
      el.innerHTML = `
        <div class="card-head">
          <div class="card-kicker" contenteditable="true" spellcheck="false"></div>
          <div class="card-tools">
            <button type="button" data-act="left" title="Повернуть влево">↺</button>
            <button type="button" data-act="right" title="Повернуть вправо">↻</button>
            <button type="button" data-act="photo" title="Фото">▧</button>
            <button type="button" data-act="delete" title="Удалить карточку">×</button>
          </div>
        </div>
        <div class="media" title="Добавить или заменить фото"></div>
        <div class="card-body">
          <div class="card-title" contenteditable="true" spellcheck="false"></div>
          <div class="card-text" contenteditable="true" spellcheck="false"></div>
          <div class="card-tags"></div>
        </div>
        <div class="resize-handle" title="Изменить размер"></div>
      `;
      const kicker = el.querySelector(".card-kicker");
      const title = el.querySelector(".card-title");
      const text = el.querySelector(".card-text");
      const media = el.querySelector(".media");
      const tags = el.querySelector(".card-tags");
      kicker.textContent = card.kicker || "блок";
      title.textContent = card.title || "Новый блок";
      text.textContent = card.text || "Текст можно редактировать прямо здесь.";
      renderCardImage(media, card.image);
      tags.innerHTML = (card.tags || []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join("");

      el.addEventListener("pointerdown", event => {
        if (event.target.closest("button") || event.target.isContentEditable || event.target.classList.contains("media")) return;
        setSelected(card.id);
        bringToFront(card.id);
      });

      el.querySelector(".card-head").addEventListener("pointerdown", event => {
        if (event.target.closest("button") || event.target.isContentEditable) return;
        startCardDrag(event, card.id);
      });
      el.querySelector(".resize-handle").addEventListener("pointerdown", event => startResize(event, card.id));
      media.addEventListener("click", () => pickImage(card.id));

      kicker.addEventListener("input", () => {
        card.kicker = kicker.textContent.trim();
        saveState();
      });
      title.addEventListener("input", () => {
        card.title = title.textContent.trim();
        saveState();
      });
      text.addEventListener("input", () => {
        card.text = text.textContent.trim();
        saveState();
      });

      el.addEventListener("click", event => {
        const act = event.target.closest("button")?.dataset.act;
        if (!act) return;
        event.stopPropagation();
        setSelected(card.id);
        if (act === "left") rotateCard(card.id, -6);
        if (act === "right") rotateCard(card.id, 6);
        if (act === "photo") pickImage(card.id);
        if (act === "delete") deleteCard(card.id);
      });

      return el;
    }

    function renderCardGeometry(el, card) {
      const width = `${card.w}px`;
      const height = `${card.h}px`;
      const transform = `translate3d(${card.x}px, ${card.y}px, 0) rotate(${card.rot || 0}deg)`;
      if (el.style.width !== width) el.style.width = width;
      if (el.style.height !== height) el.style.height = height;
      if (el.style.transform !== transform) el.style.transform = transform;
    }

    function startCardDrag(event, id) {
      if (event.button !== 0) return;
      event.preventDefault();
      const card = cardById(id);
      if (!card) return;
      setSelected(id);
      bringToFront(id);
      drag = {
        type: "card",
        id,
        sx: event.clientX,
        sy: event.clientY,
        x: card.x,
        y: card.y
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    }

    function startResize(event, id) {
      event.preventDefault();
      event.stopPropagation();
      const card = cardById(id);
      if (!card) return;
      setSelected(id);
      drag = {
        type: "resize",
        id,
        sx: event.clientX,
        sy: event.clientY,
        w: card.w,
        h: card.h
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    }

    boardWrap.addEventListener("pointerdown", event => {
      if (event.target !== boardWrap && event.target !== board) return;
      drag = {
        type: "pan",
        sx: event.clientX,
        sy: event.clientY,
        x: state.view.x,
        y: state.view.y
      };
      boardWrap.classList.add("panning");
      boardWrap.setPointerCapture(event.pointerId);
    });

    window.addEventListener("pointermove", event => {
      if (!drag) return;
      if (drag.type === "card") {
        const card = cardById(drag.id);
        const dx = (event.clientX - drag.sx) / state.view.zoom;
        const dy = (event.clientY - drag.sy) / state.view.zoom;
        card.x = Math.round(drag.x + dx);
        card.y = Math.round(drag.y + dy);
        scheduleRenderCard(card);
      }
      if (drag.type === "resize") {
        const card = cardById(drag.id);
        const dx = (event.clientX - drag.sx) / state.view.zoom;
        const dy = (event.clientY - drag.sy) / state.view.zoom;
        card.w = Math.max(220, Math.round(drag.w + dx));
        card.h = Math.max(230, Math.round(drag.h + dy));
        scheduleRenderCard(card);
      }
      if (drag.type === "pan") {
        state.view.x = Math.round(drag.x + event.clientX - drag.sx);
        state.view.y = Math.round(drag.y + event.clientY - drag.sy);
        applyView();
      }
    });

    window.addEventListener("pointerup", () => {
      if (!drag) return;
      drag = null;
      boardWrap.classList.remove("panning");
      saveState();
    });

    function scheduleRenderCard(card) {
      const el = cardElements.get(card.id);
      if (!el) return;
      renderCardGeometry(el, card);
      drawLinks(card.id);
    }

    boardWrap.addEventListener("wheel", event => {
      event.preventDefault();
      const oldZoom = state.view.zoom;
      const next = clamp(oldZoom * (event.deltaY < 0 ? 1.08 : 0.92), 0.45, 1.6);
      const rect = boardWrap.getBoundingClientRect();
      const mx = event.clientX - rect.left;
      const my = event.clientY - rect.top;
      state.view.x = mx - ((mx - state.view.x) / oldZoom) * next;
      state.view.y = my - ((my - state.view.y) / oldZoom) * next;
      state.view.zoom = next;
      zoomInput.value = Math.round(next * 100);
      zoomValue.textContent = `${Math.round(next * 100)}%`;
      applyView();
      saveState();
    }, { passive: false });

    function applyView() {
      board.style.transform = `translate(${state.view.x}px, ${state.view.y}px) scale(${state.view.zoom})`;
      zoomInput.value = Math.round(state.view.zoom * 100);
      zoomValue.textContent = `${Math.round(state.view.zoom * 100)}%`;
    }

    function drawLinks(changedCardId = null) {
      wireRenderer.drawLinks({
        nextLinks: state.links,
        nextCards: state.cards,
        changedCardId
      });
    }

    function bringToFront(id) {
      const card = cardById(id);
      if (!card) return;
      card.z = ++zCounter;
      const el = cardElements.get(id);
      if (el) el.style.zIndex = card.z;
      saveState();
    }

    function rotateCard(id, delta) {
      const card = cardById(id);
      if (!card) return;
      card.rot = clamp((card.rot || 0) + delta, -24, 24);
      rotateInput.value = card.rot;
      rotateValue.textContent = `${Math.round(card.rot)}°`;
      scheduleRenderCard(card);
      saveState();
    }

    function pickImage(id) {
      mediaTargetId = id;
      imageInput.value = "";
      imageInput.click();
    }

    imageInput.addEventListener("change", () => {
      const file = imageInput.files?.[0];
      if (!file || !mediaTargetId) return;
      statusEl.textContent = "Фото сжимается";
      prepareImage(file).then(dataUrl => {
        const card = cardById(mediaTargetId);
        if (!card) return;
        card.image = dataUrl;
        render();
        saveState("Фото добавлено");
      }).catch(() => {
        statusEl.textContent = "Фото не прочитано";
      });
    });

    document.getElementById("addCard").addEventListener("click", () => {
      const id = `card_${Date.now()}`;
      const card = {
        id,
        x: Math.round((window.innerWidth / 2 - state.view.x) / state.view.zoom - 160),
        y: Math.round((window.innerHeight / 2 - state.view.y) / state.view.zoom - 140),
        w: 330,
        h: 310,
        z: ++zCounter,
        rot: 0,
        color: "#5eead4",
        kicker: "новое",
        title: "Новый блок",
        text: "Впиши сюда тезис, который нужно показать в видео.",
        tags: ["draft"],
        image: ""
      };
      state.cards.push(card);
      selectedId = id;
      render();
      saveState("Карточка добавлена");
    });

    document.getElementById("duplicateCard").addEventListener("click", () => {
      const card = cardById(selectedId);
      if (!card) return;
      const copy = JSON.parse(JSON.stringify(card));
      copy.id = `card_${Date.now()}`;
      copy.x += 38;
      copy.y += 38;
      copy.z = ++zCounter;
      copy.title = `${copy.title} копия`;
      state.cards.push(copy);
      selectedId = copy.id;
      render();
      saveState("Карточка скопирована");
    });

    function deleteCard(id = selectedId) {
      if (!id) return;
      const idx = state.cards.findIndex(c => c.id === id);
      if (idx < 0) return;
      state.cards.splice(idx, 1);
      state.links = state.links.filter(([a, b]) => a !== id && b !== id);
      selectedId = state.cards[0]?.id || null;
      render();
      saveState("Карточка удалена");
    }

    document.getElementById("deleteCard").addEventListener("click", () => deleteCard(selectedId));

    document.getElementById("bringFront").addEventListener("click", () => bringToFront(selectedId));

    document.getElementById("connectMode").addEventListener("click", event => {
      connectMode = !connectMode;
      connectFirst = null;
      event.currentTarget.dataset.active = String(connectMode);
      statusEl.textContent = connectMode ? "Выбери две карточки для связи" : "Режим связей выключен";
    });

    board.addEventListener("click", event => {
      const cardEl = event.target.closest(".card");
      if (!connectMode || !cardEl) return;
      const id = cardEl.dataset.id;
      if (!connectFirst) {
        connectFirst = id;
        statusEl.textContent = "Выбери вторую карточку";
        return;
      }
      if (connectFirst !== id && !state.links.some(([a, b]) => a === connectFirst && b === id)) {
        state.links.push([connectFirst, id]);
        drawLinks();
        saveState("Связь добавлена");
      }
      connectFirst = null;
    });

    rotateInput.addEventListener("input", () => {
      const card = cardById(selectedId);
      if (!card) return;
      card.rot = Number(rotateInput.value);
      rotateValue.textContent = `${Math.round(card.rot)}°`;
      scheduleRenderCard(card);
      saveState();
    });

    zoomInput.addEventListener("input", () => {
      state.view.zoom = Number(zoomInput.value) / 100;
      zoomValue.textContent = `${Math.round(state.view.zoom * 100)}%`;
      applyView();
      saveState();
    });

    tagInput.addEventListener("change", () => {
      const card = cardById(selectedId);
      if (!card) return;
      card.tags = tagInput.value.split(",").map(t => t.trim()).filter(Boolean);
      render();
      saveState();
    });

    colorInput.addEventListener("input", () => {
      const card = cardById(selectedId);
      if (!card) return;
      card.color = colorInput.value;
      render();
      saveState();
    });

    deckTitle.addEventListener("input", () => {
      state.title = deckTitle.value;
      saveState();
    });

    planInput.addEventListener("input", () => {
      state.plan = planInput.value;
      saveState();
    });

    roadmapInput.addEventListener("input", () => {
      state.roadmap = roadmapInput.value;
      saveState();
    });

    scriptOutput.addEventListener("input", () => {
      state.script = scriptOutput.value;
      saveState();
    });

    platformChecks.addEventListener("change", () => {
      state.publish.platforms = selectedChecks(platformChecks);
      saveState("Площадки обновлены");
    });

    toolChecks.addEventListener("change", () => {
      state.publish.tools = selectedChecks(toolChecks);
      saveState("Инструменты обновлены");
    });

    languageInput.addEventListener("input", () => {
      state.publish.languages = languageInput.value;
      saveState();
    });

    mediaBriefInput.addEventListener("input", () => {
      state.publish.mediaBrief = mediaBriefInput.value;
      saveState();
    });

    researchQueryInput.addEventListener("input", () => {
      state.publish.researchQuery = researchQueryInput.value;
      saveState();
    });

    publishOutput.addEventListener("input", () => {
      state.publish.packageText = publishOutput.value;
      saveState();
    });

    document.getElementById("loadPlanFile").addEventListener("click", () => {
      planFileInput.value = "";
      planFileInput.click();
    });

    document.getElementById("loadRoadmapFile").addEventListener("click", () => {
      roadmapFileInput.value = "";
      roadmapFileInput.click();
    });

    planFileInput.addEventListener("change", () => readTextFile(planFileInput, "plan"));
    roadmapFileInput.addEventListener("change", () => readTextFile(roadmapFileInput, "roadmap"));

    document.getElementById("buildScript").addEventListener("click", () => {
      state.script = buildScriptFromState();
      scriptOutput.value = state.script;
      saveState("Сценарий собран");
    });

    document.getElementById("speakScript").addEventListener("click", async () => {
      const text = state.script?.trim() || buildScriptFromState();
      state.script = text;
      scriptOutput.value = text;
      saveState("Озвучка запущена");
      await speakText(text);
      if (!tourAbort) statusEl.textContent = "Озвучка завершена";
    });

    document.getElementById("playTour").addEventListener("click", () => {
      playTour({ speak: true });
    });

    document.getElementById("stopPlayback").addEventListener("click", stopPlayback);
    document.getElementById("recordVideo").addEventListener("click", recordVideo);
    renderLocalVideoButton.addEventListener("click", () => renderLocalVideo());
    cancelLocalRenderButton.addEventListener("click", cancelLocalRender);
    createEditionButton.addEventListener("click", createEdition);
    // Кнопка сборки — submit командной строки: Enter в поле темы и клик идут
    // одним путём, поэтому отдельного click-обработчика у неё нет.
    wizardCancelButton.addEventListener("click", cancelDraftJob);
    void loadBridgeModels();

    // ——— Свободная длительность ролика ———
    // Ползунок, поле m:ss и быстрые метки — три вида на одно значение. Оно живёт
    // здесь, а не в трёх DOM-узлах, чтобы виды не разъезжались.
    const DRAFT_MIN_SCENES = 2;
    const DRAFT_MAX_SCENES = 12;

    let targetDurationSeconds = DEFAULT_TARGET_DURATION_SECONDS;

    function initDurationControls() {
      durationSlider.max = String(DURATION_SLIDER_MAX_POSITION);
      durationSlider.min = "0";
      durationSlider.step = "1";
      durationMarks.replaceChildren(...DURATION_QUICK_MARKS.map(seconds => {
        const option = document.createElement("option");
        option.value = String(secondsToSliderPosition(seconds));
        option.label = formatDurationLabel(seconds);
        return option;
      }));
      durationQuick.replaceChildren(...DURATION_QUICK_MARKS.map(seconds => {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.seconds = String(seconds);
        button.textContent = formatDurationLabel(seconds);
        button.setAttribute("aria-pressed", "false");
        button.setAttribute("aria-label", `Выбрать длительность ${formatDurationLabel(seconds)}`);
        button.addEventListener("click", () => applyTargetDuration(seconds));
        return button;
      }));
      syncDurationFromBrief();
    }

    /**
     * Единственная точка записи значения: обновляет оба контрола, метки, бриф и
     * подсказку. persist=false — «показать то, что уже выбрано в проекте», без
     * навязывания цели проекту, который её не задавал.
     */
    function applyTargetDuration(seconds, { persist = true, syncTextField = true } = {}) {
      const value = snapDurationSeconds(seconds);
      targetDurationSeconds = value;
      const label = formatDurationLabel(value);
      durationSlider.value = String(secondsToSliderPosition(value));
      durationSlider.setAttribute("aria-valuetext", label);
      if (syncTextField) {
        durationValueInput.value = label;
        durationValueInput.removeAttribute("aria-invalid");
        // Значение пришло не из набора — прошлое замечание о наборе устарело.
        showDurationNotice("");
      }
      for (const button of durationQuick.querySelectorAll("button")) {
        button.setAttribute("aria-pressed", String(Number(button.dataset.seconds) === value));
      }
      if (persist && state.brief) state.brief.targetDurationSeconds = value;
      refreshDurationFeedback();
    }

    // Проект без выбранной цели не получает её задним числом: ползунок просто
    // показывает, на сколько тянет уже написанный текст доски.
    function syncDurationFromBrief() {
      const stored = normalizeTargetDurationSeconds(state.brief?.targetDurationSeconds ?? null);
      if (stored !== null) {
        applyTargetDuration(stored, { persist: false });
        return;
      }
      applyTargetDuration(estimateBoardDurationSeconds(), { persist: false });
    }

    function estimateBoardDurationSeconds() {
      const characters = boardNarrationCharacters();
      if (characters === 0) return DEFAULT_TARGET_DURATION_SECONDS;
      const scenes = Math.max(1, state.cards.length);
      const estimatedMs = estimateNarrationDurationMs(characters)
        + scenes * DURATION_PLAN_LIMITS.anchorPaddingMs;
      return snapDurationSeconds(Math.round(estimatedMs / 1000));
    }

    // Рендер озвучивает заголовок и текст карточки (buildStoryboard склеивает их
    // в одну реплику), поэтому объём считается по тем же двум полям.
    function boardNarrationCharacters() {
      return state.cards.reduce(
        (total, card) => total + countNarrationCharacters(`${card.title || ""} ${card.text || ""}`),
        0
      );
    }

    function manualSceneCount() {
      const value = Number(wizardSceneCountInput.value);
      if (!Number.isFinite(value) || value < DRAFT_MIN_SCENES) return null;
      return Math.min(DRAFT_MAX_SCENES, Math.trunc(value));
    }

    function effectiveSceneCount() {
      const manual = manualSceneCount();
      if (manual !== null) return manual;
      // На непустой доске сцен ровно столько, сколько карточек: врать про
      // расчётное число, когда фактическое видно глазами, нельзя.
      if (state.cards.length > 0) return state.cards.length;
      return deriveSceneCountFromDuration(targetDurationSeconds, {
        minScenes: DRAFT_MIN_SCENES,
        maxScenes: DRAFT_MAX_SCENES
      }).sceneCount;
    }

    function refreshDurationFeedback() {
      const sceneCount = effectiveSceneCount();
      const narrationCharacters = boardNarrationCharacters();
      const budget = describeDurationBudget({ targetDurationSeconds, narrationCharacters, sceneCount });
      const hint = describeDurationHint({ budget, sceneCount, hasBoard: state.cards.length > 0 });
      durationHint.textContent = hint.text;
      durationHint.dataset.status = hint.status;
      showDurationWarning(budget, sceneCount, narrationCharacters);
      updateSceneCountHint(sceneCount);
    }

    function updateSceneCountHint(sceneCount) {
      const derived = deriveSceneCountFromDuration(targetDurationSeconds, {
        minScenes: DRAFT_MIN_SCENES,
        maxScenes: DRAFT_MAX_SCENES
      });
      const capped = derived.capped
        ? ` Под ${formatDurationLabel(targetDurationSeconds)} просится ${derived.recommendedSceneCount}, но за один проход собирается не больше ${DRAFT_MAX_SCENES} — остальное добавь карточками.`
        : "";
      sceneCountHint.textContent = manualSceneCount() === null
        ? `Пусто — система возьмёт ${derived.sceneCount} под выбранную длительность.${capped}`
        : `Ручное значение ${sceneCount} сильнее автоматики (система предложила бы ${derived.sceneCount}).${capped}`;
    }

    // То же предупреждение, что планировщик пишет в manifest после рендера, но
    // с оценкой вместо замера: честнее сказать заранее, чем после десяти минут
    // синтеза.
    function showDurationWarning(budget, sceneCount, narrationCharacters) {
      if (narrationCharacters === 0 || budget.status === "ok" || budget.status === "unset") {
        durationWarning.hidden = true;
        durationWarning.textContent = "";
        return;
      }
      const projectedDurationMs = estimateNarrationDurationMs(narrationCharacters)
        + sceneCount * DURATION_PLAN_LIMITS.anchorPaddingMs;
      durationWarning.textContent = buildDurationWarning({
        target: targetDurationSeconds,
        projectedDurationMs,
        budget
      });
      durationWarning.hidden = false;
    }

    // Замечание о наборе живёт отдельно от статуса сборки: иначе «поправил на
    // 1:00:00» висело бы поверх хода задачи и после исправленного ввода.
    function showDurationNotice(text) {
      durationNotice.textContent = text || "";
      durationNotice.hidden = !text;
    }

    function commitTypedDuration() {
      const typed = durationValueInput.value;
      const result = resolveTypedDuration(typed, targetDurationSeconds);
      applyTargetDuration(result.seconds, { syncTextField: false });
      durationValueInput.value = result.label;
      if (!result.accepted) {
        durationValueInput.setAttribute("aria-invalid", "true");
        // Ввод пользователя показываем только через textContent и обрезанным.
        showDurationNotice(`Не понял «${String(typed).slice(0, 24)}» — оставил ${result.label}. Формат: минуты:секунды, например 2:35.`);
        return;
      }
      durationValueInput.removeAttribute("aria-invalid");
      showDurationNotice(result.clamped
        ? `Ближайшая доступная длительность — ${result.label} (диапазон ${formatDurationLabel(DURATION_PLAN_LIMITS.minTargetSeconds)} … ${formatDurationLabel(DURATION_PLAN_LIMITS.maxTargetSeconds)}).`
        : "");
    }

    durationSlider.addEventListener("input", () => {
      applyTargetDuration(sliderPositionToSeconds(durationSlider.value));
    });
    durationValueInput.addEventListener("change", commitTypedDuration);
    durationValueInput.addEventListener("blur", commitTypedDuration);
    wizardSceneCountInput.addEventListener("input", refreshDurationFeedback);
    commandBar.addEventListener("submit", event => {
      event.preventDefault();
      // Enter в поле m:ss обязан применить набранное до запуска сборки.
      commitTypedDuration();
      void draftFromTopic();
    });
    initDurationControls();

    // Заполняет селект моделей живым списком провайдеров моста; deepseek — дефолт
    // (сейчас самый надёжный для JSON-драфта), известные особенности ffmpeg.
    async function loadBridgeModels() {
      const labels = {
        deepseek: "DeepSeek (бесплатно)",
        chatgpt: "ChatGPT (бесплатно)",
        gemini: "Gemini (бесплатно)",
        perplexity: "Perplexity (бесплатно)"
      };
      try {
        const data = await fetchJson("/api/local-media/bridge");
        const providers = Array.isArray(data.providers) ? data.providers : [];
        if (!data.available || providers.length === 0) {
          // Мост не отдаёт провайдеров, но BYOK (свой/бесплатный OpenAI-совместимый ключ) работает и без моста.
          wizardModelSelect.replaceChildren(new Option("Мост недоступен — выбери свой API ниже", ""), buildByokOptGroup());
          wizardModelSelect.disabled = false;
        } else {
          const bridgeOptions = providers.map(id => new Option(labels[id] || id, id));
          wizardModelSelect.replaceChildren(...bridgeOptions, buildByokOptGroup());
          wizardModelSelect.disabled = false;
          wizardModelSelect.value = providers.includes("deepseek") ? "deepseek" : providers[0];
        }
      } catch {
        wizardModelSelect.replaceChildren(new Option("Мост недоступен", ""), buildByokOptGroup());
        wizardModelSelect.disabled = false;
      }
      syncWizardByokConfig();
    }

    function buildByokOptGroup() {
      const group = document.createElement("optgroup");
      group.label = "Свой API (OpenAI-совместимый)";
      group.append(...WIZARD_BYOK_PRESETS.map(preset => new Option(preset.label, `byok:${preset.id}`)));
      return group;
    }

    function selectedByokPreset() {
      const value = wizardModelSelect.value || "";
      if (!value.startsWith("byok:")) return null;
      const id = value.slice("byok:".length);
      return WIZARD_BYOK_PRESETS.find(preset => preset.id === id) || null;
    }

    function syncWizardByokConfig() {
      const preset = selectedByokPreset();
      wizardByokConfig.hidden = !preset;
      // Пресет с известным URL подставляет его; "Свой URL…" оставляет поле пользователю.
      if (preset && preset.id !== "custom") wizardByokBaseUrl.value = preset.baseUrl;
    }

    wizardModelSelect.addEventListener("change", syncWizardByokConfig);

    // Жизненный цикл draft-job живёт в замыкании: id активной задачи + флаг «отмена в процессе».
    let activeDraftJobId = null;
    let draftCancelInFlight = false;

    function setWizardBusy(busy) {
      wizardDraftButton.disabled = busy;
      wizardCancelButton.hidden = !busy;
      if (busy) wizardCancelButton.disabled = false;
    }

    async function draftFromTopic({ series = null, episodeNumber = null } = {}) {
      if (activeDraftJobId) return; // гард: сборка уже идёт — не запускать вторую
      // У серии своя тема — она собрана планом сезона из названия и логлайна,
      // поэтому поле темы для неё не обязательно.
      const topic = episodeNumber === null
        ? wizardTopicInput.value.trim()
        : (wizardTopicInput.value.trim() || seriesTopicInput.value.trim() || "серия сериала");
      if (!topic) {
        wizardStatus.textContent = "Сначала введи тему ролика.";
        wizardTopicInput.focus();
        return;
      }
      // Число сцен считает система из выбранной длительности; ручное значение
      // из «Настроек» отправляется, только когда пользователь его задал.
      const sceneCount = manualSceneCount();
      const byokPreset = selectedByokPreset();
      let endpoint;
      let model = wizardModelSelect.value || undefined;
      if (byokPreset) {
        const byokModel = wizardByokModel.value.trim();
        const baseUrl = wizardByokBaseUrl.value.trim();
        if (!baseUrl || !byokModel) {
          wizardStatus.textContent = "Укажи Base URL и модель для своего API.";
          return;
        }
        endpoint = { kind: "openai", baseUrl, apiKey: wizardByokKey.value, model: byokModel };
        model = undefined;
      }
      // Запуск сборки — явный выбор: показанная длительность становится целью проекта.
      if (state.brief) state.brief.targetDurationSeconds = targetDurationSeconds;
      setWizardBusy(true);
      wizardElapsedTimer.start();
      wizardStatus.textContent = byokPreset
        ? "Собираю через ваш API… можно отменить."
        : "Ставлю задачу ИИ-модели (reasoning-чат думает минутами) — можно отменить.";
      let submitted;
      try {
        // Draft асинхронный: reasoning-чат думает минутами, синхронный HTTP рвался в 504.
        submitted = await fetchJson("/api/local-media/draft", {
          method: "POST",
          headers: { "content-type": "application/json", "x-hermest-local-media": "1" },
          body: JSON.stringify({
            topic,
            ...(sceneCount === null ? {} : { sceneCount }),
            targetDurationSeconds,
            research: wizardResearchInput.checked,
            cartoon: wizardCartoonInput?.checked === true,
            ...(series && episodeNumber !== null ? { series, episodeNumber } : {}),
            model,
            endpoint,
            language: state.brief?.language || "ru",
            voice: state.brief?.voice || "",
            narrationProvider: state.brief?.narrationProvider || ""
          })
        });
      } catch (error) {
        wizardStatus.textContent = draftErrorText(error, byokPreset);
        setWizardBusy(false);
        wizardElapsedTimer.stop();
        return;
      }
      activeDraftJobId = submitted.job.id;
      persistActiveJob("draft", activeDraftJobId);
      wizardStatus.textContent = "Идёт сборка карточек… можно отменить.";
      await settleDraftJob(activeDraftJobId, byokPreset);
    }

    // Опрос и применение результата draft-job. Общее для нового запуска и reconnect после reload.
    async function settleDraftJob(jobId, byokPreset) {
      let cancelledView = false;
      try {
        // Backend-authoritative: poll вернёт cancelled, когда сервер отменит job (без клиентской гонки).
        const job = await pollDraftJob(jobId);
        if (job.status === "cancelled") {
          cancelledView = true;
          wizardStatus.textContent = "Сборка отменена. Поправь тему или настройки и запусти снова.";
          return;
        }
        if (job.status !== "completed" || !job.board) {
          throw new Error(job.error || `черновик не собран (${job.status})`);
        }
        applyProjectDocument(job.board);
        render();
        saveState("Черновик собран из темы");
        const warnings = Array.isArray(job.warnings) ? job.warnings.filter(Boolean) : [];
        wizardStatus.textContent = [
          `Готово: ${state.cards.length} карточек на доске.`,
          warnings.length ? `Предупреждения: ${warnings.join("; ")}` : ""
        ].filter(Boolean).join(" ");
      } catch (error) {
        wizardStatus.textContent = draftErrorText(error, byokPreset);
      } finally {
        activeDraftJobId = null;
        draftCancelInFlight = false;
        clearActiveJob("draft");
        setWizardBusy(false);
        wizardElapsedTimer.stop();
        if (cancelledView) wizardTopicInput.focus();
      }
    }

    // Сезон живёт дольше одной вкладки: сериал снимается сериями и не за один
    // вечер, поэтому план переживает перезагрузку. Хранится отдельно от доски —
    // доска это одна серия, план это весь сериал.
    const SERIES_KEY = "hermest-board:series:v1";
    let seasonPlan = null;

    function loadSeasonPlan() {
      try {
        const raw = localStorage.getItem(SERIES_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed?.episodes) && parsed.episodes.length ? parsed : null;
      } catch (_) {
        return null;
      }
    }

    function storeSeasonPlan(plan) {
      seasonPlan = plan;
      try {
        if (plan) localStorage.setItem(SERIES_KEY, JSON.stringify(plan));
        else localStorage.removeItem(SERIES_KEY);
      } catch (_) { /* приватный режим или переполнение — план просто не переживёт вкладку */ }
    }

    function renderSeasonPlan() {
      seriesList.textContent = "";
      if (!seasonPlan) {
        seriesList.hidden = true;
        return;
      }
      for (const episode of seasonPlan.episodes) {
        const item = document.createElement("li");
        const text = document.createElement("div");
        const title = document.createElement("div");
        title.className = "series-episode-title";
        title.textContent = `${episode.number}. ${episode.title}`;
        const logline = document.createElement("div");
        logline.className = "series-episode-logline";
        logline.textContent = episode.logline || "";
        text.append(title, logline);
        const shoot = document.createElement("button");
        shoot.type = "button";
        shoot.className = "btn-secondary";
        shoot.textContent = "Снять";
        shoot.title = `Собрать доску серии ${episode.number} с учётом предыдущих`;
        shoot.addEventListener("click", () => {
          seriesStatus.hidden = false;
          seriesStatus.textContent = `Собираю серию ${episode.number}: «${episode.title}».`;
          void draftFromTopic({ series: seasonPlan, episodeNumber: episode.number });
        });
        item.append(text, shoot);
        seriesList.append(item);
      }
      seriesList.hidden = false;
    }

    async function planSeason() {
      const topic = seriesTopicInput.value.trim();
      if (!topic) {
        seriesStatus.hidden = false;
        seriesStatus.textContent = "Сначала опиши, о чём сериал.";
        seriesTopicInput.focus();
        return;
      }
      const episodeCount = Number(seriesEpisodesInput.value) || 4;
      const byokPreset = selectedByokPreset();
      let endpoint;
      let model = wizardModelSelect.value || undefined;
      if (byokPreset) {
        const byokModel = wizardByokModel.value.trim();
        const baseUrl = wizardByokBaseUrl.value.trim();
        if (!baseUrl || !byokModel) {
          seriesStatus.hidden = false;
          seriesStatus.textContent = "Укажи Base URL и модель для своего API.";
          return;
        }
        endpoint = { kind: "openai", baseUrl, apiKey: wizardByokKey.value, model: byokModel };
        model = undefined;
      }
      seriesPlanButton.disabled = true;
      seriesStatus.hidden = false;
      seriesStatus.textContent = "Планирую сезон…";
      try {
        const result = await fetchJson("/api/local-media/series", {
          method: "POST",
          headers: { "content-type": "application/json", "x-hermest-local-media": "1" },
          body: JSON.stringify({
            topic,
            episodeCount,
            language: state.brief?.language || "ru",
            episodeDurationSeconds: state.brief?.targetDurationSeconds ?? null,
            model,
            endpoint
          })
        });
        storeSeasonPlan(result.plan);
        renderSeasonPlan();
        seriesStatus.textContent = `Сезон «${result.plan.series.title}»: ${result.plan.episodes.length} серий. Жми «Снять» у нужной.`;
      } catch (error) {
        seriesStatus.textContent = friendlyErrorMessage(error, "draft");
      } finally {
        seriesPlanButton.disabled = false;
      }
    }

    seriesPlanButton?.addEventListener("click", () => void planSeason());
    seasonPlan = loadSeasonPlan();
    if (seasonPlan) renderSeasonPlan();

    // Разговор с доской. Модель не переписывает доску целиком — она предлагает
    // операции, домен их проверяет и применяет, а человеку показывается и то,
    // что сделано, и то, что отклонено: молчаливо съеденный отказ хуже отказа.
    function showBoardChat(text, kind = "info") {
      boardChatLog.hidden = false;
      boardChatLog.dataset.kind = kind;
      boardChatLog.textContent = text;
    }

    async function sendBoardCommand() {
      const request = boardChatInput.value.trim();
      if (!request) {
        showBoardChat("Скажи, что поправить: например «убери третью сцену».");
        boardChatInput.focus();
        return;
      }
      if (!state.cards.length) {
        showBoardChat("Доска пуста — сначала собери ролик из темы.", "error");
        return;
      }
      const byokPreset = selectedByokPreset();
      let endpoint;
      let model = wizardModelSelect.value || undefined;
      if (byokPreset) {
        const byokModel = wizardByokModel.value.trim();
        const baseUrl = wizardByokBaseUrl.value.trim();
        if (!baseUrl || !byokModel) {
          showBoardChat("Укажи Base URL и модель для своего API.", "error");
          return;
        }
        endpoint = { kind: "openai", baseUrl, apiKey: wizardByokKey.value, model: byokModel };
        model = undefined;
      }
      boardChatSend.disabled = true;
      showBoardChat("Правлю доску…");
      try {
        const result = await fetchJson("/api/local-media/board-command", {
          method: "POST",
          headers: { "content-type": "application/json", "x-hermest-local-media": "1" },
          body: JSON.stringify({ board: buildProjectDocument(), request, model, endpoint })
        });
        applyProjectDocument(result.board);
        render();
        saveState("Доска поправлена по просьбе");
        const rejected = Array.isArray(result.rejected) ? result.rejected : [];
        showBoardChat([
          result.summary || `Готово: ${state.cards.length} карточек.`,
          rejected.length ? `Не сделано: ${rejected.map(item => item.reason).join("; ")}` : ""
        ].filter(Boolean).join(" "), rejected.length ? "error" : "info");
        boardChatInput.value = "";
      } catch (error) {
        showBoardChat(friendlyErrorMessage(error, "draft"), "error");
      } finally {
        boardChatSend.disabled = false;
      }
    }

    boardChatForm?.addEventListener("submit", event => {
      event.preventDefault();
      void sendBoardCommand();
    });

    function draftErrorText(error, byokPreset) {
      // Подсказка зависит от пути: BYOK (свой API) не использует мост — не сбивать пользователя с толку.
      const hint = byokPreset
        ? "Проверь Base URL, название модели и ключ своего API."
        : "Проверь, что мост browser-ai-bridge запущен (:8788) и провайдер залогинен.";
      return [friendlyErrorMessage(error, "draft"), hint].join(" ");
    }

    // Переподключение к draft-job после reload (id сохранён в localStorage).
    async function resumeDraftJob(jobId) {
      if (activeDraftJobId) return;
      let data;
      try {
        data = await fetchJson(`/api/local-media/draft/${encodeURIComponent(jobId)}`);
      } catch {
        clearActiveJob("draft"); // 404/вычищен — тихо сбрасываем
        return;
      }
      const job = data.job || {};
      if (job.status !== "queued" && job.status !== "running") {
        clearActiveJob("draft"); // терминальный — не авто-применяем: пользователь мог менять доску
        return;
      }
      activeDraftJobId = jobId;
      setWizardBusy(true);
      wizardElapsedTimer.start(Date.parse(job.createdAt));
      wizardStatus.textContent = "Продолжаю прежнюю сборку… можно отменить.";
      await settleDraftJob(jobId, null);
    }

    async function cancelDraftJob() {
      // Гард от двойного нажатия и отмены без активной задачи (конкурирующие submit/cancel).
      if (!activeDraftJobId || draftCancelInFlight) return;
      const jobId = activeDraftJobId;
      draftCancelInFlight = true;
      wizardCancelButton.disabled = true;
      wizardStatus.textContent = "Отменяю задачу…";
      try {
        await fetchJson(`/api/local-media/draft/${encodeURIComponent(jobId)}`, {
          method: "DELETE",
          // Worker требует application/json на местных маршрутах — иначе 415 (проверено против реального backend).
          headers: { "x-hermest-local-media": "1", "content-type": "application/json" }
        });
        // 202: сервер отменяет job; финальное «отменено» покажет poll в draftFromTopic. Держим «Отменяю…».
      } catch (error) {
        const code = error.payload && error.payload.code;
        if (code === "draft_job_not_found") {
          wizardStatus.textContent = "Задача уже завершилась — отменять нечего.";
        } else if (code === "draft_job_not_cancellable") {
          // Job уже завершается (completed/failed) — poll покажет фактический итог.
          wizardStatus.textContent = "Задача уже завершается — отмена невозможна.";
        } else {
          // Ошибка самой отмены — разрешаем повторить, задача продолжает опрашиваться.
          wizardStatus.textContent = "Не удалось отменить. Попробуй ещё раз.";
          if (activeDraftJobId) wizardCancelButton.disabled = false;
        }
      } finally {
        draftCancelInFlight = false;
      }
    }

    async function pollDraftJob(jobId) {
      const deadline = Date.now() + 8 * 60 * 1000;
      while (Date.now() < deadline) {
        const data = await fetchJson(`/api/local-media/draft/${encodeURIComponent(jobId)}`);
        if (["completed", "failed", "cancelled"].includes(data.job.status)) return data.job;
        await wait(1500);
      }
      throw new Error("draft_poll_timeout");
    }

    const byokProviders = document.getElementById("byokProviders");

    async function loadProviderKeys() {
      let providers;
      try {
        const data = await fetchJson("/api/local-media/providers");
        providers = data.providers || [];
      } catch (_) {
        byokProviders.replaceChildren();
        const note = document.createElement("div");
        note.className = "mini-note";
        note.textContent = "BYOK-ключи доступны только при локальном `npm run dev` (worker недоступен).";
        byokProviders.append(note);
        return;
      }
      byokProviders.replaceChildren(...providers.map(provider => buildProviderKeyRow(provider)));
    }

    function buildProviderKeyRow(provider) {
      const row = document.createElement("div");
      row.className = "panel-row two";
      const status = document.createElement("span");
      status.textContent = provider.configured
        ? `${provider.label}: ключ активен (${provider.source === "session" ? "сессия" : "env"})`
        : `${provider.label}: ключ не задан`;
      const keyInput = document.createElement("input");
      keyInput.type = "password";
      keyInput.placeholder = provider.configured ? "заменить ключ…" : "вставить ключ…";
      keyInput.autocomplete = "off";
      const saveButton = document.createElement("button");
      saveButton.textContent = "Сохранить";
      saveButton.addEventListener("click", async () => {
        const key = keyInput.value.trim();
        if (!key) return;
        saveButton.disabled = true;
        try {
          await fetchJson(`/api/local-media/providers/${encodeURIComponent(provider.id)}/key`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-hermest-local-media": "1" },
            body: JSON.stringify({ key })
          });
          flashStatus(`${provider.label}: ключ передан локальному worker`);
          // Новый ключ — новый аккаунт: старый каталог голосов больше не про него.
          if (provider.id === "elevenlabs") {
            resetElevenLabsCatalogue();
            syncNarrationControls();
          }
        } catch (error) {
          flashStatus(`${provider.label}: ${friendlyErrorMessage(error, "provider")}`);
        } finally {
          keyInput.value = "";
          saveButton.disabled = false;
          await loadProviderKeys();
        }
      });
      row.append(status, keyInput, saveButton);
      if (provider.configured && provider.source === "session") {
        const clearButton = document.createElement("button");
        clearButton.textContent = "Убрать";
        clearButton.addEventListener("click", async () => {
          clearButton.disabled = true;
          try {
            await fetchJson(`/api/local-media/providers/${encodeURIComponent(provider.id)}/key`, {
              method: "DELETE",
              headers: { "content-type": "application/json", "x-hermest-local-media": "1" },
              body: "{}"
            });
          } catch (_) {}
          if (provider.id === "elevenlabs") {
            resetElevenLabsCatalogue();
            syncNarrationControls();
          }
          await loadProviderKeys();
        });
        row.append(clearButton);
      }
      return row;
    }

    void loadProviderKeys();

    // Каталог голосов ElevenLabs приходит от локального worker. Ключ остаётся у
    // worker: в браузер попадают только имя, id и ссылка на превью провайдера.
    const elevenLabsCatalogue = { state: "idle", configured: false, voices: [] };
    let elevenLabsCatalogueRequest = null;

    function resetElevenLabsCatalogue() {
      elevenLabsCatalogue.state = "idle";
      elevenLabsCatalogue.voices = [];
      elevenLabsCatalogue.configured = false;
    }

    function ensureElevenLabsVoices() {
      if (elevenLabsCatalogue.state !== "idle") return elevenLabsCatalogueRequest;
      elevenLabsCatalogue.state = "loading";
      elevenLabsCatalogueRequest = (async () => {
        try {
          const data = await fetchJson("/api/local-media/narration-voices?provider=elevenlabs", {
            headers: { "x-hermest-local-media": "1" }
          });
          elevenLabsCatalogue.configured = data.configured === true;
          elevenLabsCatalogue.voices = Array.isArray(data.voices) ? data.voices : [];
          elevenLabsCatalogue.state = "ready";
        } catch (_) {
          elevenLabsCatalogue.state = "failed";
        } finally {
          elevenLabsCatalogueRequest = null;
          syncNarrationControls();
        }
      })();
      return elevenLabsCatalogueRequest;
    }

    function elevenLabsVoiceOptions() {
      const auto = { id: "", label: "Авто — голос ElevenLabs по умолчанию" };
      if (elevenLabsCatalogue.state !== "ready" || elevenLabsCatalogue.voices.length === 0) return [auto];
      return [auto, ...elevenLabsCatalogue.voices.map(voice => ({
        id: voice.id,
        label: voice.language ? `${voice.name} · ${voice.language}` : voice.name
      }))];
    }

    function elevenLabsVoiceHint(piperCoversLanguage) {
      if (elevenLabsCatalogue.state === "loading") return "Загружаю каталог голосов ElevenLabs…";
      if (elevenLabsCatalogue.state === "failed") {
        return "Каталог голосов ElevenLabs недоступен: проверьте ключ и сеть. Озвучка пойдёт голосом по умолчанию.";
      }
      if (elevenLabsCatalogue.state === "ready" && !elevenLabsCatalogue.configured) {
        return "Добавьте ключ ElevenLabs в настройках — и здесь появятся ваши голоса, включая созданные вами.";
      }
      if (elevenLabsCatalogue.state === "ready") {
        return `Голосов в аккаунте: ${elevenLabsCatalogue.voices.length}. Свои — в начале списка.`;
      }
      return piperCoversLanguage
        ? "Премиум-озвучка ElevenLabs: нужен свой API-ключ (BYOK)."
        : "Язык вне матрицы Piper — доступно через ElevenLabs (BYOK), нужен свой API-ключ.";
    }

    function selectedElevenLabsVoice() {
      if (state.brief.narrationProvider !== "elevenlabs") return null;
      return elevenLabsCatalogue.voices.find(voice => voice.id === state.brief.voice) || null;
    }

    function syncVoicePreviewButton() {
      if (!narrationVoicePreview) return;
      const voice = selectedElevenLabsVoice();
      const playable = Boolean(voice?.previewUrl);
      narrationVoicePreview.hidden = !playable;
      narrationVoicePreview.disabled = !playable;
    }

    if (narrationVoicePreview) {
      narrationVoicePreview.addEventListener("click", () => {
        const voice = selectedElevenLabsVoice();
        if (!voice?.previewUrl) return;
        if (voicePreviewPlayer) voicePreviewPlayer.pause();
        voicePreviewPlayer = new Audio(voice.previewUrl);
        voicePreviewPlayer.play().catch(() => flashStatus("Превью голоса не воспроизвелось"));
      });
    }

    function syncNarrationControls() {
      narrationLanguageSelect.replaceChildren(...NARRATION_LANGUAGES.map(entry => {
        const option = document.createElement("option");
        option.value = entry.code;
        option.textContent = entry.label;
        return option;
      }));
      narrationLanguageSelect.value = state.brief.language;
      const piperCoversLanguage = NARRATION_LANGUAGES.find(entry => entry.code === state.brief.language)?.piper === true;
      narrationProviderSelect.value = state.brief.narrationProvider;
      narrationProviderSelect.disabled = !piperCoversLanguage;
      const usesElevenLabs = state.brief.narrationProvider === "elevenlabs";
      if (usesElevenLabs) void ensureElevenLabsVoices();
      const voices = usesElevenLabs ? elevenLabsVoiceOptions() : NARRATION_VOICES[state.brief.language] || [];
      narrationVoiceSelect.replaceChildren(...voices.map(entry => {
        const option = document.createElement("option");
        option.value = entry.id;
        option.textContent = entry.label;
        return option;
      }));
      narrationVoiceSelect.value = state.brief.voice;
      // Выбранного голоса может не быть в каталоге (сменился аккаунт, ключ убрали):
      // тогда select молча падает на первый пункт, и бриф обязан это отразить.
      if (narrationVoiceSelect.value !== state.brief.voice) {
        narrationVoiceSelect.value = "";
        state.brief.voice = "";
      }
      narrationVoiceSelect.disabled = usesElevenLabs && elevenLabsCatalogue.state === "loading";
      narrationHint.textContent = usesElevenLabs
        ? elevenLabsVoiceHint(piperCoversLanguage)
        : "Piper синтезирует локально и бесплатно. Языку соответствует свой каталог голосов.";
      syncVoicePreviewButton();
      musicBedSelect.value = state.brief.music === "off" ? "off" : "";
      generateVisualsToggle.checked = state.brief.generateVisuals === true;
      if (brollModeSelect) {
        brollModeSelect.value = BROLL_MODES.includes(state.brief.brollMode) ? state.brief.brollMode : "auto";
      }
    }

    narrationLanguageSelect.addEventListener("change", () => {
      const previousLanguagePiper =
        NARRATION_LANGUAGES.find(entry => entry.code === state.brief.language)?.piper === true;
      state.brief = normalizeBrief(
        {
          language: narrationLanguageSelect.value,
          voice: "",
          // ElevenLabs выбранный явно — сохраняем; навязанный языком вне матрицы — сбрасываем на авто.
          narrationProvider: previousLanguagePiper ? state.brief.narrationProvider : ""
        },
        state.brief
      );
      syncNarrationControls();
      saveState("Язык озвучки сохранён");
    });
    narrationProviderSelect.addEventListener("change", () => {
      state.brief = normalizeBrief(
        { language: state.brief.language, voice: "", narrationProvider: narrationProviderSelect.value },
        state.brief
      );
      syncNarrationControls();
      saveState("TTS-провайдер сохранён");
    });
    narrationVoiceSelect.addEventListener("change", () => {
      state.brief = normalizeBrief(
        { language: state.brief.language, voice: narrationVoiceSelect.value, narrationProvider: state.brief.narrationProvider },
        state.brief
      );
      syncNarrationControls();
      saveState("Голос озвучки сохранён");
    });
    musicBedSelect.addEventListener("change", () => {
      state.brief = normalizeBrief(
        {
          language: state.brief.language,
          voice: state.brief.voice,
          narrationProvider: state.brief.narrationProvider,
          music: musicBedSelect.value
        },
        state.brief
      );
      syncNarrationControls();
      saveState("Настройка музыки сохранена");
    });
    if (brollModeSelect) {
      brollModeSelect.addEventListener("change", () => {
        state.brief = normalizeBrief(
          { ...state.brief, brollMode: brollModeSelect.value },
          state.brief
        );
        syncNarrationControls();
        saveState("Режим B-roll сохранён");
      });
    }
    generateVisualsToggle.addEventListener("change", () => {
      state.brief = normalizeBrief(
        { ...state.brief, generateVisuals: generateVisualsToggle.checked },
        state.brief
      );
      saveState(generateVisualsToggle.checked ? "Генерация фонов включена" : "Генерация фонов выключена");
    });
    syncNarrationControls();
    document.getElementById("buildMediaBrief").addEventListener("click", () => {
      state.publish.packageText = buildMediaBrief();
      publishOutput.value = state.publish.packageText;
      saveState("Медиа ТЗ собрано");
    });
    document.getElementById("buildTranslationPack").addEventListener("click", () => {
      state.publish.packageText = buildTranslationPack();
      publishOutput.value = state.publish.packageText;
      saveState("Задача перевода собрана");
    });
    document.getElementById("runResearchSearch").addEventListener("click", runResearchSearch);
    document.getElementById("showConnectorGuide").addEventListener("click", showConnectorGuide);
    document.getElementById("showReadinessReport").addEventListener("click", showReadinessReport);
    document.getElementById("checkProviderDiagnostics").addEventListener("click", loadProviderDiagnostics);
    document.getElementById("showStorageStatus").addEventListener("click", showStorageStatus);
    document.getElementById("saveProjectApi").addEventListener("click", saveProjectApi);
    document.getElementById("loadProjectApi").addEventListener("click", loadProjectApi);
    document.getElementById("runAgentPlan").addEventListener("click", runAgentPlan);
    document.getElementById("checkAccountStatus").addEventListener("click", () => checkAccountStatus(true));
    document.getElementById("signupAccount").addEventListener("click", signupAccount);
    document.getElementById("loginAccount").addEventListener("click", loginAccount);
    document.getElementById("logoutAccount").addEventListener("click", logoutAccount);
    // Рейка режимов повторяет тот же roving-tabindex подход, что и вкладки
    // модального окна настроек: активна одна вкладка и одна связанная панель.
    const activateModeTab = nextTab => {
      modeTabs.forEach(tab => {
        const isActive = tab === nextTab;
        tab.setAttribute("aria-selected", String(isActive));
        tab.tabIndex = isActive ? 0 : -1;
        document.getElementById(tab.getAttribute("aria-controls")).hidden = !isActive;
      });
      const label = nextTab.querySelector(".mode-tab-label");
      modePanelTitle.textContent = label?.textContent?.trim() || "Режим";
      sidePanel.hidden = false;
      togglePanelButton.setAttribute("aria-expanded", "true");
      togglePanelButton.setAttribute("aria-label", "Свернуть панель режимов");
      togglePanelButton.title = "Свернуть панель режимов";
      sidePanel.scrollTop = 0;
      nextTab.focus();
    };
    modeTablist.addEventListener("click", event => {
      const tab = event.target.closest('[role="tab"]');
      if (tab && modeTabs.includes(tab)) activateModeTab(tab);
    });
    modeTablist.addEventListener("keydown", event => {
      const tab = event.target.closest('[role="tab"]');
      if (!tab || !modeTabs.includes(tab)) return;
      const direction = {
        ArrowRight: 1,
        ArrowDown: 1,
        ArrowLeft: -1,
        ArrowUp: -1
      }[event.key];
      if (!direction) return;
      event.preventDefault();
      const nextIndex = (modeTabs.indexOf(tab) + direction + modeTabs.length) % modeTabs.length;
      activateModeTab(modeTabs[nextIndex]);
    });
    const activateSettingsTab = nextTab => {
      settingsTabs.forEach(tab => {
        const isActive = tab === nextTab;
        tab.setAttribute("aria-selected", String(isActive));
        tab.tabIndex = isActive ? 0 : -1;
        document.getElementById(tab.getAttribute("aria-controls")).hidden = !isActive;
      });
      nextTab.focus();
    };
    openSettingsButton.addEventListener("click", () => {
      if (!settingsDialog.open) settingsDialog.showModal();
      (settingsTabs.find(tab => tab.getAttribute("aria-selected") === "true") || settingsTabs[0]).focus();
    });
    closeSettingsButton.addEventListener("click", () => {
      settingsDialog.close();
    });
    settingsDialog.addEventListener("close", () => {
      openSettingsButton.focus();
    });
    settingsDialog.addEventListener("click", event => {
      if (event.target === settingsDialog) settingsDialog.close();
    });
    settingsTablist.addEventListener("click", event => {
      const tab = event.target.closest('[role="tab"]');
      if (tab && settingsTabs.includes(tab)) activateSettingsTab(tab);
    });
    settingsTablist.addEventListener("keydown", event => {
      const tab = event.target.closest('[role="tab"]');
      if (!tab || !settingsTabs.includes(tab)) return;
      const direction = {
        ArrowRight: 1,
        ArrowDown: 1,
        ArrowLeft: -1,
        ArrowUp: -1
      }[event.key];
      if (!direction) return;
      event.preventDefault();
      const nextIndex = (settingsTabs.indexOf(tab) + direction + settingsTabs.length) % settingsTabs.length;
      activateSettingsTab(settingsTabs[nextIndex]);
    });
    document.getElementById("saveAiSettings").addEventListener("click", () => {
      saveAiSettingsFromForm();
    });
    aiProviderInput.addEventListener("change", () => {
      const provider = aiProviderInput.value;
      const defaultModel = AI_PROVIDER_DEFAULT_MODELS[provider] || AI_PROVIDER_DEFAULT_MODELS.openai;
      if (!aiModelInput.value.trim() || Object.values(AI_PROVIDER_DEFAULT_MODELS).includes(aiModelInput.value.trim())) {
        aiModelInput.value = defaultModel;
      }
      const savedKey = userApiKeys.find(item => item.provider === provider && item.key);
      if (savedKey) aiKeyInput.value = savedKey.key;
    });
    document.getElementById("clearAiSettings").addEventListener("click", () => {
      clearAiSettings();
    });
    document.getElementById("testAiConnection").addEventListener("click", testAiConnection);
    document.getElementById("runAiAssistant").addEventListener("click", runAiAssistant);
    document.getElementById("addAiResponseCard").addEventListener("click", addAiResponseCard);
    document.getElementById("saveUserApiKey").addEventListener("click", saveUserApiKeyFromForm);
    document.getElementById("clearUserApiKeys").addEventListener("click", clearUserApiKeys);
    document.getElementById("openProviderDocs").addEventListener("click", openSelectedProviderDocs);
    document.getElementById("activateNoKeyProvider").addEventListener("click", activateSelectedNoKeyProvider);
    apiCatalogCategory.addEventListener("change", () => {
      renderApiProviderControls();
      updateApiProviderInfo();
    });
    userApiKeyProvider.addEventListener("change", updateApiProviderInfo);
    userApiKeyList.addEventListener("click", event => {
      const id = event.target.closest("button")?.dataset.deleteKey;
      if (id) deleteUserApiKey(id);
    });
    document.getElementById("buildPublishPack").addEventListener("click", () => {
      state.publish.packageText = buildPublishPackageText();
      publishOutput.value = state.publish.packageText;
      saveState("Пакет публикации собран");
    });
    document.getElementById("downloadPublishPack").addEventListener("click", () => {
      const pack = buildPublishPackageObject();
      downloadBlob(new Blob([JSON.stringify(pack, null, 2)], { type: "application/json" }), `hermest-publish-pack-${timestampSlug()}.json`);
      saveState("JSON пакета скачан");
    });

    document.getElementById("fitView").addEventListener("click", fitView);
    togglePanelButton.addEventListener("click", () => {
      sidePanel.hidden = !sidePanel.hidden;
      const isExpanded = !sidePanel.hidden;
      togglePanelButton.setAttribute("aria-expanded", String(isExpanded));
      togglePanelButton.setAttribute("aria-label", isExpanded ? "Свернуть панель режимов" : "Развернуть панель режимов");
      togglePanelButton.title = isExpanded ? "Свернуть панель режимов" : "Развернуть панель режимов";
    });
    document.getElementById("recordMode").addEventListener("click", event => {
      document.body.classList.toggle("recording");
      event.currentTarget.dataset.active = String(document.body.classList.contains("recording"));
    });

    document.getElementById("exportJson").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "hermest-board.json";
      a.click();
      URL.revokeObjectURL(a.href);
    });

    document.getElementById("importJson").addEventListener("click", () => {
      jsonInput.value = "";
      jsonInput.click();
    });

    jsonInput.addEventListener("change", () => {
      const file = jsonInput.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const incoming = normalize(JSON.parse(reader.result));
          state.title = incoming.title;
          state.view = incoming.view;
          state.plan = incoming.plan;
          state.roadmap = incoming.roadmap;
          state.script = incoming.script;
          state.publish = incoming.publish;
          state.links = incoming.links;
          state.cards = incoming.cards;
          selectedId = state.cards[0]?.id || null;
          render();
          saveState("Импортировано");
        } catch (_) {
          statusEl.textContent = "JSON не прочитан";
        }
      };
      reader.readAsText(file);
    });

    window.addEventListener("keydown", event => {
      if (event.target.isContentEditable || ["INPUT", "TEXTAREA"].includes(event.target.tagName)) return;
      if (event.key === "Delete") document.getElementById("deleteCard").click();
      if (event.key.toLowerCase() === "r") document.getElementById("recordMode").click();
      if (event.key === "0") fitView();
      if (event.key === "[") rotateCard(selectedId, -3);
      if (event.key === "]") rotateCard(selectedId, 3);
    });

    function orderedCards() {
      const order = [
        "user", "hermest", "router", "agents", "tools", "openlayer", "memory",
        "logs", "guardrails", "plan", "roadmap", "workflow", "video", "publish_agent",
        "parser", "translator", "media_generator", "platforms", "auto_publish", "result", "business"
      ];
      return [...state.cards].sort((a, b) => {
        const ai = order.indexOf(a.id);
        const bi = order.indexOf(b.id);
        if (ai >= 0 || bi >= 0) return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
        return (a.y - b.y) || (a.x - b.x);
      });
    }

    function buildScriptFromState() {
      const lines = [];
      lines.push(`${state.title}.`);
      lines.push("Главная мысль: Hermest можно объяснять как управляющую оболочку над ИИ-агентами. Он не заменяет агента, а собирает агентов, инструменты, память, права, логи и результат в одну систему.");
      lines.push("Теперь пройдемся по карте борда.");
      orderedCards().forEach((card, index) => {
        const tags = Array.isArray(card.tags) && card.tags.length ? ` Теги: ${card.tags.join(", ")}.` : "";
        lines.push(`${index + 1}. ${card.title}. ${card.text}${tags}`);
      });
      if (state.plan?.trim()) {
        lines.push(`План проекта. ${state.plan.trim()}`);
      }
      if (state.roadmap?.trim()) {
        lines.push(`Roadmap. ${state.roadmap.trim()}`);
      }
      lines.push("Вывод: такой борд нужен не для красивой картинки, а для работы. Он превращает идею в структуру, структуру в сценарий, сценарий в озвучку и видео, а дальше в продукт, который можно развивать и монетизировать.");
      return lines.join("\n\n");
    }

    function selectedChecks(container) {
      return [...container.querySelectorAll("input[type='checkbox']:checked")].map(input => input.value);
    }

    function syncChecks(container, values) {
      const set = new Set(values);
      container.querySelectorAll("input[type='checkbox']").forEach(input => {
        input.checked = set.has(input.value);
      });
    }

    function selectedLanguages() {
      return String(state.publish.languages || "")
        .split(",")
        .map(item => item.trim())
        .filter(Boolean);
    }

    function platformLabel(platform) {
      return {
        tiktok: "TikTok",
        youtube_video: "YouTube видео",
        youtube_shorts: "YouTube Shorts",
        instagram_reels: "Instagram Reels",
        instagram_feed: "Instagram лента 1:1"
      }[platform] || platform;
    }

    function toolLabel(tool) {
      return {
        parser: "парсер источников",
        translator: "переводчик",
        web_media: "поиск фото/видео из интернета",
        generated_media: "генерация фото/видео",
        rights_check: "проверка прав и источников",
        scheduler: "очередь публикаций"
      }[tool] || tool;
    }

    function buildMediaBrief() {
      const cards = orderedCards().map(card => `${card.title}: ${card.text}`).join("\n");
      return [
        "Задача для медиа-агента:",
        "1. Разобрать борд и сценарий.",
        "2. Для каждого смыслового блока подобрать или сгенерировать визуальный ряд.",
        "3. Основной формат: вертикальное видео 9:16 для TikTok, YouTube Shorts и Instagram Reels.",
        "4. Дополнительный формат: горизонтальное 16:9 для полного YouTube-видео.",
        "5. Стиль: техно-обучение, агентская система, карта знаний, интерфейсная среда, чистая демонстрация без лишнего шума.",
        "6. Все внешние материалы должны иметь понятный источник и право использования.",
        "",
        "Смысловые блоки:",
        cards,
        "",
        "Дополнительные требования:",
        state.publish.mediaBrief || "Сгенерировать b-roll, превью, обложки, фоновые кадры и короткие переходы под контекст объяснения."
      ].join("\n");
    }

    function buildTranslationPack() {
      const script = state.script?.trim() || buildScriptFromState();
      const languages = selectedLanguages();
      return [
        "Задача для переводчика агента:",
        `Языки: ${languages.join(", ") || "ru, en"}.`,
        "Нужно перевести не дословно, а локализовать под зрителя: сохранить смысл, темп видео, технические термины и энергичную подачу.",
        "На каждый язык подготовить:",
        "- сценарий озвучки;",
        "- короткое описание;",
        "- 3 варианта заголовка;",
        "- 10-20 хэштегов;",
        "- субтитры сегментами по 1-2 строки;",
        "- предупреждения, где перевод может исказить смысл.",
        "",
        "Исходный сценарий:",
        script
      ].join("\n");
    }

    async function runResearchSearch() {
      const query = (researchQueryInput.value || state.publish.researchQuery || state.title).trim();
      if (!query) {
        statusEl.textContent = "Впиши запрос для public parser";
        return;
      }
      state.publish.researchQuery = query;
      publishOutput.value = "Public search запущен...";
      statusEl.textContent = "Ищу публичные источники";
      try {
        const data = await fetchJson(`/api/research/search?q=${encodeURIComponent(query)}`);
        state.publish.packageText = formatResearchResults(data);
        publishOutput.value = state.publish.packageText;
        saveState("Public search готов");
      } catch (_) {
        state.publish.packageText = [
          "Public search пока недоступен в этом режиме.",
          "",
          "Он работает после Vercel/backend deploy через endpoint:",
          `/api/research/search?q=${query}`,
          "",
          "Безопасные публичные источники:",
          "- Wikipedia / MediaWiki REST",
          "- Crossref",
          "- arXiv",
          "- GitHub public search",
          "- OpenAlex при добавленном OPENALEX_API_KEY",
          "",
          "Важно: внешние фото/видео всегда нужно проверять по правам использования."
        ].join("\n");
        publishOutput.value = state.publish.packageText;
        saveState("Public search требует backend deploy");
      }
    }

    function showConnectorGuide() {
      const lines = [
        "USER ACCOUNT CONNECTION FLOW",
        "",
        "Главное правило: пользователи НЕ видят личные секреты владельца продукта.",
        "Каждый пользователь подключает свои аккаунты через OAuth.",
        "",
        "YouTube:",
        "1. Пользователь нажимает Connect YouTube.",
        "2. Backend отправляет его в Google OAuth.",
        "3. Пользователь разрешает upload.",
        "4. Backend сохраняет encrypted refresh token.",
        "5. Агент может создавать draft/upload только для этого пользователя.",
        "",
        "TikTok:",
        "1. Пользователь нажимает Connect TikTok.",
        "2. Backend открывает TikTok OAuth.",
        "3. Публикация работает только после разрешений и approval от TikTok.",
        "",
        "Instagram Reels:",
        "1. Нужен professional/business Instagram.",
        "2. Нужна связанная Facebook Page.",
        "3. Backend работает через Meta Graph API.",
        "",
        "Что уже есть в backend skeleton:",
        "- /api/connectors/status",
        "- /api/connectors/start?provider=youtube",
        "- /api/connectors/start?provider=tiktok",
        "- /api/connectors/start?provider=instagram",
        "- /api/user-config/schema",
        "",
        "Что ещё нужно для настоящей работы:",
        "- user accounts",
        "- sessions",
        "- OAuth callback token exchange",
        "- encrypted token storage",
        "- publish approval screen",
        "- upload workers"
      ];
      state.publish.packageText = lines.join("\n");
      publishOutput.value = state.publish.packageText;
      saveState("Схема аккаунтов показана");
    }

    const providerDiagnostics = document.getElementById("providerDiagnostics");
    const providerDiagnosticsStatus = document.getElementById("providerDiagnosticsStatus");
    const providerDiagnosticsList = document.getElementById("providerDiagnosticsList");

    // Диагностика провайдеров: человеко-читаемо «готов/настроен/недоступен + причина» и бейдж
    // бесплатно/платно. Тянет per-capability статус из backend, бесплатность — из локального каталога.
    async function loadProviderDiagnostics() {
      providerDiagnostics.hidden = false;
      providerDiagnosticsList.replaceChildren();
      providerDiagnosticsStatus.textContent = "Проверяю провайдеров…";
      try {
        const data = await fetchJson(productApi("connectors/capabilities"));
        const capabilities = Array.isArray(data.capabilities) ? data.capabilities : [];
        if (!capabilities.length) {
          providerDiagnosticsStatus.textContent = "Данные о провайдерах сейчас недоступны.";
          return;
        }
        renderProviderDiagnostics(capabilities);
        const ready = capabilities.filter(capability => capability.executable).length;
        providerDiagnosticsStatus.textContent =
          `Готово к работе: ${ready} из ${capabilities.length}. Бесплатные пути работают без ключа; свой ключ добавь в «Локальные API ключи».`;
      } catch (error) {
        providerDiagnosticsList.replaceChildren();
        providerDiagnosticsStatus.textContent = friendlyErrorMessage(error, "generic");
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "diagnostics-retry";
        retry.textContent = "Повторить";
        retry.addEventListener("click", loadProviderDiagnostics);
        providerDiagnosticsList.appendChild(retry);
      }
    }

    function renderProviderDiagnostics(capabilities) {
      providerDiagnosticsList.replaceChildren();
      for (const capability of capabilities) {
        const row = document.createElement("div");
        row.className = "diagnostic-row";

        const head = document.createElement("div");
        head.className = "diagnostic-head";
        const name = document.createElement("span");
        name.className = "diagnostic-name";
        name.textContent = capabilityName(capability.id);
        const status = capabilityStatusLabel(capability);
        const pill = document.createElement("span");
        pill.className = `diagnostic-pill tone-${status.tone}`;
        pill.textContent = status.label;
        head.append(name, pill);
        row.appendChild(head);

        const reason = capabilityReason(capability);
        if (reason && status.tone !== "ok") {
          const reasonEl = document.createElement("div");
          reasonEl.className = "diagnostic-reason";
          reasonEl.textContent = reason;
          row.appendChild(reasonEl);
        }

        const providers = Array.isArray(capability.providers) ? capability.providers : [];
        if (providers.length) {
          const chips = document.createElement("div");
          chips.className = "diagnostic-providers";
          for (const provider of providers) {
            const catalogEntry = catalogProviderById(provider.id) || {};
            const access = accessBadge({ auth: provider.auth || catalogEntry.auth, freeMode: catalogEntry.freeMode });
            const state = providerStateLabel(provider);
            const chip = document.createElement("span");
            chip.className = `diagnostic-provider tone-${state.tone}`;
            chip.textContent = `${provider.name || provider.id} · ${state.label}`;
            const badge = document.createElement("span");
            badge.className = `access-badge access-${access.tone}`;
            badge.textContent = access.label;
            chip.appendChild(badge);
            chips.appendChild(chip);
          }
          row.appendChild(chips);
        }
        providerDiagnosticsList.appendChild(row);
      }
    }

    async function showReadinessReport() {
      statusEl.textContent = "Проверяю готовность 1.0";
      try {
        const data = await fetchJson(productApi("preflight"));
        state.publish.packageText = formatReadinessReport(data);
        publishOutput.value = state.publish.packageText;
        saveState(data.launchReady ? "1.0 gate готов" : "1.0 gate ещё заблокирован");
      } catch (error) {
        state.publish.packageText = [
          "HERMEST BOARD 1.0 READINESS",
          "",
          "Preflight API недоступен.",
          "",
          `Ошибка: ${friendlyErrorMessage(error)}`,
          "",
          "Локально проверь: npm run check",
          "На production проверь: /api/product?route=preflight"
        ].join("\n");
        publishOutput.value = state.publish.packageText;
        saveState("1.0 preflight недоступен");
      }
    }

    async function showStorageStatus() {
      statusEl.textContent = "Проверяю backend-хранилище";
      try {
        const data = await fetchJson(productApi("storage/status"));
        state.server.storageStatus = data.adapter || "";
        state.publish.packageText = formatStorageStatus(data);
        publishOutput.value = state.publish.packageText;
        saveState(data.writeEnabled ? "Backend storage доступен" : "Backend storage только для чтения");
      } catch (error) {
        state.publish.packageText = [
          "BACKEND STORAGE STATUS",
          "",
          "API хранилище недоступно в этом режиме.",
          "",
          `Ошибка: ${friendlyErrorMessage(error)}`,
          "",
          "Локальный fallback работает через localStorage и экспорт JSON."
        ].join("\n");
        publishOutput.value = state.publish.packageText;
        saveState("Storage API недоступен");
      }
    }

    async function checkAccountStatus(showOutput = true) {
      statusEl.textContent = "Проверяю аккаунт";
      try {
        const data = await fetchJson(productApi("auth/status"), {
          credentials: "include"
        });
        renderAccountStatus(data);
        if (showOutput) {
          state.publish.packageText = formatAccountStatus(data);
          publishOutput.value = state.publish.packageText;
          saveState(data.actor?.authenticated ? "Аккаунт активен" : "Аккаунт не подключён");
        }
        return data;
      } catch (error) {
        accountStatus.textContent = `Аккаунт: ${friendlyErrorMessage(error, "account")}`;
        if (showOutput) saveState("Account API недоступен");
        return null;
      }
    }

    async function signupAccount() {
      await submitAccountAuth("auth/signup", "Signup");
    }

    async function loginAccount() {
      await submitAccountAuth("auth/login", "Login");
    }

    async function logoutAccount() {
      statusEl.textContent = "Выхожу из аккаунта";
      try {
        const data = await fetchJson(productApi("auth/logout"), {
          method: "POST",
          credentials: "include"
        });
        accountPasswordInput.value = "";
        renderAccountStatus({ actor: data.actor, accountAuth: data.accountAuth });
        state.publish.packageText = [
          "ACCOUNT LOGOUT",
          "",
          "Сессия очищена в httpOnly cookie.",
          "Локальный browser board остаётся на устройстве."
        ].join("\n");
        publishOutput.value = state.publish.packageText;
        saveState("Выход выполнен");
      } catch (error) {
        accountStatus.textContent = `Выход: ${friendlyErrorMessage(error, "account")}`;
        saveState("Logout недоступен");
      }
    }

    async function submitAccountAuth(route, label) {
      const email = accountEmailInput.value.trim();
      const password = accountPasswordInput.value;
      const displayName = accountDisplayNameInput.value.trim();
      if (!email || !password) {
        flashStatus("Нужны email и пароль");
        return;
      }
      statusEl.textContent = `${label}: отправляю запрос`;
      try {
        const data = await fetchJson(productApi(route), {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password, displayName })
        });
        accountPasswordInput.value = "";
        renderAccountStatus({
          actor: data.actor,
          accountAuth: data.accountAuth || { ready: true },
          account: data.account
        });
        state.publish.packageText = [
          `ACCOUNT ${label.toUpperCase()} RESULT`,
          "",
          `User: ${data.account?.displayName || data.account?.email || "unknown"}`,
          `Email: ${data.account?.email || "unknown"}`,
          `Workspace: ${data.account?.workspaceId || data.actor?.workspaceId || "unknown"}`,
          `Session cookie: ${data.tokenReturned === false ? "httpOnly only" : "unknown"}`,
          `Expires: ${data.expiresAt || "unknown"}`,
          "",
          "API token/password values are not printed, exported, or stored in board JSON."
        ].join("\n");
        publishOutput.value = state.publish.packageText;
        saveState(`${label} выполнен`);
      } catch (error) {
        accountStatus.textContent = `${label}: ${friendlyErrorMessage(error, "account")}`;
        state.publish.packageText = [
          `ACCOUNT ${label.toUpperCase()} BLOCKED`,
          "",
          `Ошибка: ${friendlyErrorMessage(error)}`,
          error.payload?.note ? `Note: ${error.payload.note}` : "",
          "",
          "Для включения нужны server env:",
          "- HERMEST_ACCOUNT_AUTH=1",
          "- HERMEST_SESSION_SECRET",
          "- writable storage: local dev, demo storage, or durable Postgres"
        ].filter(Boolean).join("\n");
        publishOutput.value = state.publish.packageText;
        saveState(`${label} недоступен`);
      }
    }

    function renderAccountStatus(data = {}) {
      const actor = data.actor || {};
      const accountAuth = data.accountAuth || data.auth?.accountAuth || {};
      accountStatus.textContent = [
        `Session: ${actor.authenticated ? "authenticated" : "anonymous"} (${actor.mode || "unknown"})`,
        actor.workspaceId ? `Workspace: ${actor.workspaceId}` : "",
        `Account auth: ${accountAuth.ready ? "ready" : accountAuth.enabled ? "enabled but blocked" : "disabled"}`,
        accountAuth.blockers?.length ? `Blockers: ${accountAuth.blockers.join(", ")}` : "Blockers: none"
      ].filter(Boolean).join("\n");
    }

    function formatAccountStatus(data = {}) {
      const actor = data.actor || {};
      const accountAuth = data.accountAuth || data.auth?.accountAuth || {};
      return [
        "ACCOUNT STATUS",
        "",
        `Authenticated: ${actor.authenticated ? "yes" : "no"}`,
        `Actor: ${actor.id || "anonymous"}`,
        `Mode: ${actor.mode || "unknown"}`,
        `Workspace: ${actor.workspaceId || "none"}`,
        "",
        "Account auth:",
        `Implemented: ${accountAuth.implemented ? "yes" : "no"}`,
        `Enabled: ${accountAuth.enabled ? "yes" : "no"}`,
        `Ready: ${accountAuth.ready ? "yes" : "no"}`,
        `Password hashing: ${accountAuth.passwordHashing || "unknown"}`,
        `Cookie session: ${accountAuth.cookieSession ? "yes" : "no"}`,
        "",
        accountAuth.blockers?.length
          ? `Blockers: ${accountAuth.blockers.join(", ")}`
          : "Blockers: none"
      ].join("\n");
    }

    async function saveProjectApi() {
      statusEl.textContent = "Сохраняю проект через API";
      const payload = {
        project: buildProjectDocument(),
        publishPack: buildPublishPackageObject()
      };
      const id = state.server?.projectId;
      try {
        const data = await fetchJson(productApi(id ? `projects/${id}` : "projects"), {
          method: id ? "PUT" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload)
        });
        const project = data.project?.project || data.project;
        if (project?.id) state.server.projectId = project.id;
        state.server.lastSyncedAt = new Date().toISOString();
        state.server.storageStatus = data.storage?.adapter || "";
        state.publish.packageText = [
          "API SAVE RESULT",
          "",
          `Project ID: ${state.server.projectId || "unknown"}`,
          `Storage: ${data.storage?.adapter || "unknown"}`,
          `Durable: ${data.storage?.durable ? "yes" : "no"}`,
          `Write enabled: ${data.storage?.writeEnabled ? "yes" : "no"}`,
          "",
          data.storage?.warnings?.length ? `Warnings: ${data.storage.warnings.join(", ")}` : "Warnings: none"
        ].join("\n");
        publishOutput.value = state.publish.packageText;
        saveState("Проект сохранён через API");
      } catch (error) {
        state.publish.packageText = [
          "API SAVE BLOCKED",
          "",
          `Ошибка: ${friendlyErrorMessage(error)}`,
          "",
          "Это нормально для публичного Vercel без постоянной базы.",
          "Борд всё равно сохранён локально в браузере. Для переноса используй экспорт JSON.",
          "",
          "Для настоящего server save нужны:",
          "- durable storage adapter;",
          "- user accounts;",
          "- per-user authorization."
        ].join("\n");
        publishOutput.value = state.publish.packageText;
        saveState("API save недоступен, локально сохранено");
      }
    }

    async function loadProjectApi() {
      statusEl.textContent = "Загружаю проект через API";
      try {
        const list = await fetchJson(productApi("projects"));
        const latest = list.projects?.[0];
        if (!latest) {
          state.publish.packageText = [
            "API LOAD RESULT",
            "",
            "На backend пока нет сохранённых проектов.",
            "",
            "Если storage write отключён, используй экспорт/импорт JSON."
          ].join("\n");
          publishOutput.value = state.publish.packageText;
          saveState("На API нет проектов");
          return;
        }
        const data = await fetchJson(productApi(`projects/${latest.id}`));
        applyProjectDocument(data.project?.project || data.project);
        state.server.projectId = latest.id;
        state.server.lastSyncedAt = new Date().toISOString();
        render();
        saveState("Проект загружен через API");
      } catch (error) {
        state.publish.packageText = [
          "API LOAD BLOCKED",
          "",
          `Ошибка: ${friendlyErrorMessage(error)}`,
          "",
          "Локальный борд не изменён."
        ].join("\n");
        publishOutput.value = state.publish.packageText;
        saveState("API load недоступен");
      }
    }

    async function runAgentPlan() {
      statusEl.textContent = "Строю backend-план агента";
      try {
        const data = await fetchJson(productApi("agent/plan"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ publishPack: buildPublishPackageObject() })
        });
        state.publish.packageText = formatAgentPlan(data);
        publishOutput.value = state.publish.packageText;
        saveState("План агента готов");
      } catch (error) {
        state.publish.packageText = [
          "AGENT PLAN ERROR",
          "",
          `Ошибка: ${friendlyErrorMessage(error)}`,
          "",
          "Локально можно собрать publish pack кнопкой Пакет."
        ].join("\n");
        publishOutput.value = state.publish.packageText;
        saveState("План агента недоступен");
      }
    }

    function loadAiSettings() {
      const fallback = {
        provider: "openai",
        model: "gpt-4.1-mini",
        apiKey: "",
        remember: false
      };
      try {
        const sessionRaw = sessionStorage.getItem(AI_SETTINGS_SESSION_KEY);
        if (sessionRaw) return normalizeAiSettings(JSON.parse(sessionRaw), fallback);
      } catch (_) {}
      try {
        const localRaw = localStorage.getItem(AI_SETTINGS_LOCAL_KEY);
        if (localRaw) return normalizeAiSettings(JSON.parse(localRaw), { ...fallback, remember: true });
      } catch (_) {}
      return fallback;
    }

    function normalizeAiSettings(input, fallback) {
      const source = input && typeof input === "object" ? input : {};
      const provider = AI_PROVIDER_DEFAULT_MODELS[source.provider] ? source.provider : fallback.provider;
      return {
        provider,
        model: typeof source.model === "string" && source.model.trim() ? source.model.trim() : AI_PROVIDER_DEFAULT_MODELS[provider],
        apiKey: typeof source.apiKey === "string" ? source.apiKey : fallback.apiKey,
        remember: Boolean(source.remember)
      };
    }

    function syncAiSettingsForm() {
      aiProviderInput.value = aiSettings.provider || "openai";
      aiModelInput.value = aiSettings.model || "gpt-4.1-mini";
      aiKeyInput.value = aiSettings.apiKey || "";
      aiRememberInput.checked = Boolean(aiSettings.remember);
      if (!aiPromptInput.value.trim()) {
        aiPromptInput.value = "Проанализируй текущий Hermest Board и предложи следующий сильный шаг для продукта. Ответ дай структурно и без лишней воды.";
      }
      renderUserApiKeyList();
    }

    function readAiSettingsForm() {
      const provider = AI_PROVIDER_DEFAULT_MODELS[aiProviderInput.value] ? aiProviderInput.value : "openai";
      return {
        provider,
        model: aiModelInput.value.trim() || AI_PROVIDER_DEFAULT_MODELS[provider],
        apiKey: aiKeyInput.value.trim(),
        remember: aiRememberInput.checked
      };
    }

    function saveAiSettingsFromForm(message = "AI настройки сохранены") {
      const next = readAiSettingsForm();
      aiSettings = next;
      try {
        localStorage.removeItem(AI_SETTINGS_LOCAL_KEY);
        sessionStorage.removeItem(AI_SETTINGS_SESSION_KEY);
        const storage = next.remember ? localStorage : sessionStorage;
        const key = next.remember ? AI_SETTINGS_LOCAL_KEY : AI_SETTINGS_SESSION_KEY;
        storage.setItem(key, JSON.stringify(next));
        persistUserApiKeys("", false);
        flashStatus(message);
        return true;
      } catch (_) {
        flashStatus("AI настройки не сохранены");
        return false;
      }
    }

    function clearAiSettings() {
      localStorage.removeItem(AI_SETTINGS_LOCAL_KEY);
      sessionStorage.removeItem(AI_SETTINGS_SESSION_KEY);
      aiSettings = {
        provider: "openai",
        model: "gpt-4.1-mini",
        apiKey: "",
        remember: false
      };
      syncAiSettingsForm();
      flashStatus("AI ключ удалён из браузера");
    }

    async function loadApiProviderCatalog() {
      try {
        const response = await fetch("./api-provider-catalog.json", { cache: "no-store" });
        if (!response.ok) throw new Error(`catalog_${response.status}`);
        const data = await response.json();
        const providers = normalizeApiProviderCatalog(data.providers);
        if (providers.length) {
          apiProviderCatalog = providers;
          userApiKeys = normalizeUserApiKeys(userApiKeys);
          renderApiProviderControls();
          renderUserApiKeyList();
        }
      } catch (_) {
        renderApiProviderControls();
      }
    }

    function normalizeApiProviderCatalog(providers) {
      return (Array.isArray(providers) ? providers : []).map(provider => ({
        id: String(provider.id || "").trim(),
        name: String(provider.name || "").trim(),
        category: String(provider.category || "other").trim(),
        auth: String(provider.auth || "api_key").trim(),
        freeMode: String(provider.freeMode || "unknown").trim(),
        env: String(provider.env || "").trim(),
        docs: String(provider.docs || "").trim(),
        signup: String(provider.signup || "").trim(),
        use: String(provider.use || "").trim(),
        status: String(provider.status || "key_slot").trim()
      })).filter(provider => provider.id && provider.name);
    }

    function renderApiProviderControls() {
      const currentCategory = apiCatalogCategory.value || "all";
      apiCatalogCategory.innerHTML = API_PROVIDER_CATEGORIES.map(([id, label]) =>
        `<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`
      ).join("");
      apiCatalogCategory.value = API_PROVIDER_CATEGORIES.some(([id]) => id === currentCategory) ? currentCategory : "all";

      const selectedId = userApiKeyProvider.value || "openai";
      const filtered = apiProviderCatalog.filter(provider => apiCatalogCategory.value === "all" || provider.category === apiCatalogCategory.value);
      const list = filtered.length ? filtered : apiProviderCatalog;
      userApiKeyProvider.innerHTML = list.map(provider =>
        `<option value="${escapeHtml(provider.id)}">${escapeHtml(provider.name)}</option>`
      ).join("");
      userApiKeyProvider.value = list.some(provider => provider.id === selectedId) ? selectedId : list[0]?.id || "";
      updateApiProviderInfo();
    }

    function updateApiProviderInfo() {
      const provider = selectedCatalogProvider();
      if (!provider) {
        apiProviderInfo.textContent = "Каталог API пока не загружен.";
        return;
      }
      const needsSecret = providerNeedsSecret(provider);
      userApiKeyLabel.placeholder = provider.name;
      userApiKeyValue.disabled = provider.auth === "none" || provider.auth === "oauth" || provider.status === "server_secret_required";
      userApiKeyValue.placeholder = needsSecret ? (provider.env || "Вставь ключ или webhook URL") : authHint(provider);
      apiProviderInfo.innerHTML = [
        `<strong>${escapeHtml(provider.name)}</strong>`,
        escapeHtml(provider.use || ""),
        `<div class="provider-pills">`,
        `<span class="provider-pill">${escapeHtml(categoryLabel(provider.category))}</span>`,
        `<span class="provider-pill">${escapeHtml(authLabel(provider.auth))}</span>`,
        `<span class="provider-pill">${escapeHtml(freeModeLabel(provider.freeMode))}</span>`,
        `<span class="provider-pill">${escapeHtml(statusLabel(provider.status))}</span>`,
        provider.env ? `<span class="provider-pill">${escapeHtml(provider.env)}</span>` : "",
        `</div>`
      ].filter(Boolean).join("");
    }

    function selectedCatalogProvider() {
      return catalogProviderById(userApiKeyProvider.value) || apiProviderCatalog[0] || null;
    }

    function catalogProviderById(id) {
      const value = String(id || "").trim();
      return apiProviderCatalog.find(provider => provider.id === value) || null;
    }

    function providerNeedsSecret(provider) {
      return !["none", "oauth"].includes(provider?.auth) && provider?.status !== "server_secret_required";
    }

    function openSelectedProviderDocs() {
      const provider = selectedCatalogProvider();
      const url = provider?.signup || provider?.docs;
      if (!url) {
        flashStatus("У провайдера нет ссылки");
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
      flashStatus("Открываю официальный API docs");
    }

    function activateSelectedNoKeyProvider() {
      const provider = selectedCatalogProvider();
      if (!provider) return;
      if (provider.auth !== "none") {
        flashStatus("Для этого провайдера нужен ключ или OAuth");
        return;
      }
      addOrUpdateUserApiKey({
        provider: provider.id,
        label: provider.name,
        key: "",
        auth: provider.auth,
        category: provider.category,
        docs: provider.docs,
        status: provider.status
      });
      persistUserApiKeys("No-key источник активирован");
      renderUserApiKeyList();
    }

    function loadUserApiKeys() {
      try {
        const sessionRaw = sessionStorage.getItem(USER_API_KEYS_SESSION_KEY);
        if (sessionRaw) return normalizeUserApiKeys(JSON.parse(sessionRaw));
      } catch (_) {}
      try {
        const localRaw = localStorage.getItem(USER_API_KEYS_LOCAL_KEY);
        if (localRaw) return normalizeUserApiKeys(JSON.parse(localRaw));
      } catch (_) {}
      return [];
    }

    function normalizeUserApiKeys(input) {
      const items = Array.isArray(input) ? input : [];
      return items.slice(0, 40).map(item => {
        const provider = catalogProviderById(item.provider) || catalogProviderById("openai") || {};
        const auth = String(item.auth || provider.auth || "api_key").trim();
        const key = String(item.key || "").trim();
        return {
          id: typeof item.id === "string" && item.id ? item.id : `key_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          provider: String(item.provider || provider.id || "openai").trim(),
          label: String(item.label || provider.name || "").trim().slice(0, 80),
          key,
          auth,
          category: String(item.category || provider.category || "other").trim(),
          docs: String(item.docs || provider.docs || "").trim(),
          status: String(item.status || provider.status || "key_slot").trim(),
          createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString()
        };
      }).filter(item => item.key || item.auth === "none" || item.auth === "oauth" || item.status === "server_secret_required");
    }

    function saveUserApiKeyFromForm() {
      const providerMeta = selectedCatalogProvider();
      if (!providerMeta) return;
      const key = userApiKeyValue.value.trim();
      const label = userApiKeyLabel.value.trim() || providerMeta.name;
      if (providerMeta.status === "server_secret_required") {
        flashStatus("Этот ключ должен храниться на backend, не в браузере");
        return;
      }
      if (providerMeta.auth === "oauth") {
        flashStatus("Для этого провайдера нужен OAuth flow через Аккаунты");
        return;
      }
      if (providerNeedsSecret(providerMeta) && !key) {
        flashStatus("Вставь ключ или URL");
        return;
      }
      addOrUpdateUserApiKey({
        provider: providerMeta.id,
        label,
        key,
        auth: providerMeta.auth,
        category: providerMeta.category,
        docs: providerMeta.docs,
        status: providerMeta.status
      });
      if (AI_PROVIDER_DEFAULT_MODELS[providerMeta.id]) {
        aiProviderInput.value = providerMeta.id;
        if (!aiModelInput.value.trim() || Object.values(AI_PROVIDER_DEFAULT_MODELS).includes(aiModelInput.value.trim())) {
          aiModelInput.value = AI_PROVIDER_DEFAULT_MODELS[providerMeta.id];
        }
        aiKeyInput.value = key;
        aiSettings = readAiSettingsForm();
        saveAiSettingsFromForm(`${providerMeta.name} ключ сохранён`);
      } else {
        persistUserApiKeys("API ключ сохранён");
      }
      userApiKeyValue.value = "";
      renderUserApiKeyList();
    }

    function addOrUpdateUserApiKey(entry) {
      const label = String(entry.label || "").trim();
      const provider = String(entry.provider || "").trim();
      const existing = userApiKeys.find(item => item.provider === provider && item.label.toLowerCase() === label.toLowerCase());
      const next = {
        id: existing?.id || `key_${Date.now()}`,
        provider,
        label,
        key: String(entry.key || "").trim(),
        auth: String(entry.auth || "api_key").trim(),
        category: String(entry.category || "other").trim(),
        docs: String(entry.docs || "").trim(),
        status: String(entry.status || "key_slot").trim(),
        createdAt: new Date().toISOString()
      };
      if (existing) Object.assign(existing, next);
      else userApiKeys.push(next);
    }

    function persistUserApiKeys(message = "API ключи сохранены", showStatus = true) {
      try {
        localStorage.removeItem(USER_API_KEYS_LOCAL_KEY);
        sessionStorage.removeItem(USER_API_KEYS_SESSION_KEY);
        const remember = Boolean(aiRememberInput.checked || aiSettings.remember);
        const storage = remember ? localStorage : sessionStorage;
        const key = remember ? USER_API_KEYS_LOCAL_KEY : USER_API_KEYS_SESSION_KEY;
        storage.setItem(key, JSON.stringify(userApiKeys));
        if (showStatus && message) flashStatus(message);
        return true;
      } catch (_) {
        if (showStatus) flashStatus("API ключи не сохранены");
        return false;
      }
    }

    function deleteUserApiKey(id) {
      userApiKeys = userApiKeys.filter(item => item.id !== id);
      persistUserApiKeys("API ключ удалён");
      renderUserApiKeyList();
    }

    function clearUserApiKeys() {
      userApiKeys = [];
      localStorage.removeItem(USER_API_KEYS_LOCAL_KEY);
      sessionStorage.removeItem(USER_API_KEYS_SESSION_KEY);
      renderUserApiKeyList();
      flashStatus("Локальные API ключи очищены");
    }

    function renderUserApiKeyList() {
      if (!userApiKeyList) return;
      if (!userApiKeys.length) {
        userApiKeyList.innerHTML = `<div class="mini-note">Локальных ключей пока нет.</div>`;
        return;
      }
      userApiKeyList.innerHTML = userApiKeys.map(item => `
        <div class="settings-key-row">
          <div class="settings-key-main">
            <div class="settings-key-title">${escapeHtml(item.label || userKeyProviderLabel(item.provider))}</div>
            <div class="settings-key-meta">${escapeHtml(userKeyProviderLabel(item.provider))} · ${escapeHtml(authLabel(item.auth))} · ${escapeHtml(maskSecret(item.key, item.auth))}</div>
          </div>
          <button type="button" data-delete-key="${escapeHtml(item.id)}" title="Удалить ключ">×</button>
        </div>
      `).join("");
    }

    function userKeyProviderLabel(provider) {
      return catalogProviderById(provider)?.name || provider || "Other";
    }

    function maskSecret(value, auth = "api_key") {
      if (auth === "none") return "no key";
      if (auth === "oauth") return "OAuth";
      const clean = String(value || "").trim();
      if (!clean) return "empty";
      if (/^https?:\/\//i.test(clean)) {
        try {
          return new URL(clean).host;
        } catch (_) {
          return "webhook URL";
        }
      }
      if (clean.length <= 8) return "••••";
      return `••••${clean.slice(-4)}`;
    }

    function categoryLabel(category) {
      return API_PROVIDER_CATEGORIES.find(([id]) => id === category)?.[1] || category || "Other";
    }

    function authLabel(auth) {
      return {
        none: "no key",
        api_key: "API key",
        optional_api_key: "optional key",
        oauth: "OAuth",
        webhook: "webhook URL",
        connection_string: "connection string",
        server_secret: "server secret"
      }[auth] || auth || "API key";
    }

    function authHint(provider) {
      if (provider.auth === "none") return "Ключ не нужен";
      if (provider.auth === "oauth") return "Подключается через OAuth";
      if (provider.status === "server_secret_required") return "Только backend env";
      return provider.env || "Вставь ключ";
    }

    function freeModeLabel(mode) {
      return {
        no_key: "free no-key",
        no_key_with_limits: "no-key limits",
        free_key: "free key",
        free_plan: "free plan",
        free_tier: "free tier",
        free_credits: "free credits",
        free_mode: "free mode",
        free_models_available: "free models",
        free_quota: "free quota",
        free_webhook: "free webhook",
        paid_or_trial: "trial/paid",
        paid: "paid",
        account_key: "account key",
        approval_required: "approval",
        test_keys: "test keys",
        self_hosted_or_cloud: "self-host/cloud"
      }[mode] || mode || "unknown";
    }

    function statusLabel(status) {
      return {
        working_ai: "working",
        working_ai_compatible: "working AI",
        working_public_search: "working public",
        key_slot: "key slot",
        server_optional_key: "server optional",
        oauth_skeleton: "OAuth skeleton",
        server_secret_required: "backend only"
      }[status] || status || "slot";
    }

    async function testAiConnection() {
      aiResponseOutput.value = "Проверяю AI подключение...";
      try {
        const data = await callAi("Ответь одной короткой фразой: Hermest AI connected.", "");
        latestAiResponse = data.text || "";
        aiResponseOutput.value = latestAiResponse || "AI ответил пустым текстом.";
        flashStatus("AI подключение работает");
      } catch (error) {
        showAiError(error);
      }
    }

    async function runAiAssistant() {
      const prompt = aiPromptInput.value.trim();
      if (!prompt) {
        flashStatus("Впиши задачу для AI");
        return;
      }
      aiResponseOutput.value = "AI анализирует текущий борд...";
      try {
        const data = await callAi(prompt, buildAiBoardContext());
        latestAiResponse = data.text || "";
        aiResponseOutput.value = latestAiResponse || "AI ответил пустым текстом.";
        flashStatus("AI ответ готов");
      } catch (error) {
        showAiError(error);
      }
    }

    async function callAi(prompt, context) {
      const settings = readAiSettingsForm();
      aiSettings = settings;
      if (!settings.apiKey) {
        throw new Error("api_key_required");
      }
      saveAiSettingsFromForm("AI настройки применены");
      return fetchJson("/api/ai/respond", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "authorization": `Bearer ${settings.apiKey}`
        },
        body: JSON.stringify({
          provider: settings.provider,
          model: settings.model,
          prompt,
          context,
          maxOutputTokens: 1400
        })
      });
    }

    function showAiError(error) {
      // AI-мост кладёт код в payload.error; резолвер иначе смотрит payload.code/message.
      const code = error?.payload?.error || resolveErrorCode(error);
      const details = humanizeDetail(error?.payload?.message || error?.payload?.note || "");
      aiResponseOutput.value = [
        "Ошибка AI-запроса",
        "",
        friendlyErrorMessage(code, "generic"),
        details ? `Детали: ${details}` : "",
        "",
        code === "api_key_required" ? "Добавь свой OpenAI API key в AI настройки и повтори запрос." : "Проверь ключ, модель, лимиты аккаунта и доступ к сети."
      ].filter(Boolean).join("\n");
      flashStatus("AI запрос не выполнен");
    }

    function buildAiBoardContext() {
      const cards = orderedCards().map((card, index) => [
        `${index + 1}. ${card.title}`,
        card.text,
        Array.isArray(card.tags) && card.tags.length ? `Tags: ${card.tags.join(", ")}` : ""
      ].filter(Boolean).join("\n")).join("\n\n");
      return [
        `Title: ${state.title}`,
        "",
        "Plan:",
        trimForAi(state.plan, 1800),
        "",
        "Roadmap:",
        trimForAi(state.roadmap, 1800),
        "",
        "Publish settings:",
        JSON.stringify({
          platforms: state.publish?.platforms || [],
          tools: state.publish?.tools || [],
          languages: state.publish?.languages || "",
          researchQuery: state.publish?.researchQuery || ""
        }, null, 2),
        "",
        "Cards:",
        trimForAi(cards, 8000)
      ].join("\n");
    }

    function addAiResponseCard() {
      const text = (latestAiResponse || aiResponseOutput.value || "").trim();
      if (!text || text.startsWith("AI ERROR")) {
        flashStatus("Нет готового AI ответа для карточки");
        return;
      }
      const id = `ai_${Date.now()}`;
      const card = {
        id,
        x: Math.round((window.innerWidth / 2 - state.view.x) / state.view.zoom - 170),
        y: Math.round((window.innerHeight / 2 - state.view.y) / state.view.zoom - 155),
        w: 360,
        h: 330,
        z: ++zCounter,
        rot: 0,
        color: "#93c5fd",
        kicker: "ai ответ",
        title: "AI предложение",
        text: trimForAi(text, 1200),
        tags: ["ai", "draft"],
        image: visual("agents", "AI RESPONSE", "ответ внутри борда")
      };
      state.cards.push(card);
      selectedId = id;
      render();
      saveState("AI ответ добавлен на борд");
    }

    function trimForAi(text, limit) {
      const value = String(text || "").trim();
      if (value.length <= limit) return value;
      return `${value.slice(0, limit - 3)}...`;
    }

    function flashStatus(message) {
      statusEl.textContent = message;
      clearTimeout(flashStatus.timer);
      flashStatus.timer = setTimeout(() => statusEl.textContent = "Автосохранение включено", 1400);
    }

    function buildProjectDocument() {
      return {
        id: state.server?.projectId || "",
        schemaVersion: CONTENT_VERSION,
        title: state.title,
        view: state.view,
        brief: state.brief,
        plan: state.plan,
        roadmap: state.roadmap,
        script: state.script,
        server: state.server,
        publish: state.publish,
        links: state.links,
        cards: state.cards
      };
    }

    function applyProjectDocument(project) {
      const incoming = normalize(project || {});
      state.title = incoming.title;
      state.view = incoming.view;
      state.brief = incoming.brief;
      syncNarrationControls();
      state.plan = incoming.plan;
      state.roadmap = incoming.roadmap;
      state.script = incoming.script;
      state.server = incoming.server;
      state.publish = incoming.publish;
      state.links = incoming.links;
      state.cards = incoming.cards;
      selectedId = state.cards[0]?.id || null;
      // Только после того, как карточки на месте: оценка длительности читает их.
      syncDurationFromBrief();
    }

    function formatStorageStatus(data) {
      return [
        "BACKEND STORAGE STATUS",
        "",
        `Adapter: ${data.adapter || "unknown"}`,
        `Durable: ${data.durable ? "yes" : "no"}`,
        `Write enabled: ${data.writeEnabled ? "yes" : "no"}`,
        `Demo storage: ${data.demoStorageEnabled ? "enabled" : "disabled"}`,
        `External config present: ${data.externalConfigPresent ? "yes" : "no"}`,
        "",
        "Production requirements:",
        ...(data.requiredForProduction || []).map(item => `- ${item}`),
        "",
        "Warnings:",
        ...(data.warnings?.length ? data.warnings.map(item => `- ${item}`) : ["- none"])
      ].join("\n");
    }

    function formatReadinessReport(data) {
      const gates = Array.isArray(data.gates) ? data.gates : [];
      const blockers = Array.isArray(data.blockers) ? data.blockers : [];
      const nextWork = Array.isArray(data.nextRequiredWork) ? data.nextRequiredWork : [];
      const connectors = Object.entries(data.connectors || {}).map(([key, value]) =>
        `- ${key}: ${value?.configured ? "configured" : `missing ${Array.isArray(value?.missing) ? value.missing.join(", ") : "config"}`}`
      );
      return [
        "HERMEST BOARD 1.0 READINESS",
        "",
        `Version: ${data.version || "unknown"}`,
        `Status: ${data.status || "unknown"}`,
        `Launch ready: ${data.launchReady ? "yes" : "no"}`,
        `Private data safe: ${data.canAcceptPrivateData ? "yes" : "no"}`,
        `Production writes: ${data.canWriteProductionProjects ? "enabled" : "blocked"}`,
        `Agent jobs: ${data.canRunAgentJobs ? "enabled" : "blocked"}`,
        `Autopublish: ${data.canAutopublish ? "enabled" : "blocked"}`,
        "",
        "Gates:",
        ...(gates.length ? gates.map(gate => `- ${gate.ready ? "ready" : "blocked"}: ${gate.id} - ${gate.note}`) : ["- no gate data"]),
        "",
        "Connectors:",
        ...(connectors.length ? connectors : ["- no connector data"]),
        "",
        "Blockers:",
        ...(blockers.length ? blockers.map(item => `- ${item}`) : ["- none"]),
        "",
        "Next required work:",
        ...(nextWork.length ? nextWork.map((item, index) => `${index + 1}. ${item}`) : ["1. No next work returned by API."]),
        "",
        "Decision:",
        data.launchReady
          ? "Можно начинать production launch checklist."
          : "Оставить продукт в alpha/demo режиме до закрытия storage/auth/worker/OAuth gates."
      ].join("\n");
    }

    function formatAgentPlan(data) {
      return [
        "BACKEND AGENT PLAN",
        "",
        `Status: ${data.status || "unknown"}`,
        `Autopublish: ${data.canAutopublish ? "enabled" : "disabled"}`,
        "",
        "Connectors:",
        ...Object.entries(data.connectors || {}).map(([key, value]) => {
          const configured = typeof value === "object" ? Boolean(value?.configured) : Boolean(value);
          const status = typeof value === "object" && value?.status ? ` (${value.status})` : "";
          return `- ${key}: ${configured ? "configured" : "missing"}${status}`;
        }),
        "",
        "Steps:",
        ...(data.steps || []).map((step, index) => `${index + 1}. ${step.status} - ${step.description}`),
        "",
        "Blockers:",
        ...(data.blockers?.length ? data.blockers.map(item => `- ${item}`) : ["- none"]),
        "",
        data.note || ""
      ].join("\n");
    }

    function formatResearchResults(data) {
      const results = Array.isArray(data.results) ? data.results : [];
      const lines = [
        "PUBLIC RESEARCH RESULTS",
        `Запрос: ${data.query || state.publish.researchQuery || ""}`,
        "",
        "Эти источники можно использовать для анализа и сценария. Фото/видео из внешних источников нужно проверять по лицензии.",
        ""
      ];
      if (!results.length) {
        lines.push("Ничего не найдено или backend вернул пустой результат.");
      }
      results.forEach((item, index) => {
        lines.push(`${index + 1}. [${item.source}] ${item.title || "Untitled"}`);
        if (item.summary) lines.push(`   ${item.summary}`);
        if (item.url) lines.push(`   ${item.url}`);
      });
      if (Array.isArray(data.errors) && data.errors.length) {
        lines.push("", "Errors:", ...data.errors.map(error => `- ${error}`));
      }
      return lines.join("\n");
    }

    async function renderLocalVideo(projectOverride) {
      if (activeLocalRenderJobId) {
        flashStatus("Локальный render уже выполняется");
        return;
      }
      // Издание переиспользует этот проверенный путь: переданный переведённый
      // проект рендерится как отдельный MP4, доска не затрагивается.
      const project = projectOverride && typeof projectOverride === "object" && Array.isArray(projectOverride.cards)
        ? projectOverride
        : buildProjectDocument();
      const platform = localRenderPlatform.value || "youtube_video";
      const pollToken = ++localRenderPollToken;
      renderLocalVideoButton.disabled = true;
      localRenderPlatform.disabled = true;
      cancelLocalRenderButton.disabled = true;
      localRenderArtifacts.replaceChildren();
      renderRenderAnalytics(null);
      localRenderStatus.textContent = "Проверяю board и ставлю локальный render в очередь…";
      localRenderElapsedTimer.start();
      let data;
      try {
        data = await fetchJson("/api/local-media/render", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-hermest-local-media": "1"
          },
          body: JSON.stringify({
            project,
            projectId: state.server?.projectId || "",
            platform
          })
        });
      } catch (error) {
        localRenderStatus.textContent = renderErrorText(error);
        if (pollToken === localRenderPollToken) {
          renderLocalVideoButton.disabled = false;
          localRenderPlatform.disabled = false;
          cancelLocalRenderButton.disabled = true;
          localRenderElapsedTimer.stop();
        }
        return;
      }
      activeLocalRenderJobId = data.job.id;
      persistActiveJob("render", activeLocalRenderJobId);
      cancelLocalRenderButton.disabled = false;
      renderLocalJobStatus(data.job);
      await settleRenderJob(data.job.id, pollToken);
    }

    // Опрос и финализация render-job. Общее для запуска и reconnect после reload.
    async function settleRenderJob(jobId, pollToken) {
      try {
        const completed = await pollLocalRenderJob(jobId, pollToken);
        if (completed?.status === "completed") {
          renderLocalArtifactLinks(completed);
          renderRenderAnalytics(completed);
          revealEditionPanel();
        }
      } catch (error) {
        localRenderStatus.textContent = renderErrorText(error);
      } finally {
        if (pollToken === localRenderPollToken) {
          activeLocalRenderJobId = null;
          renderLocalVideoButton.disabled = false;
          localRenderPlatform.disabled = false;
          cancelLocalRenderButton.disabled = true;
          clearActiveJob("render");
          localRenderElapsedTimer.stop();
        }
      }
    }

    function renderErrorText(error) {
      return [
        "Локальный worker недоступен или render отклонён.",
        friendlyErrorMessage(error, "render"),
        "Запусти `npm run dev` локально либо используй `npm run render:project -- --input board.json --platform youtube_video`."
      ].join("\n");
    }

    // --- Мультиязычные издания: готовый ролик на другом языке ---
    let editionInFlight = false;

    function revealEditionPanel() {
      populateEditionLanguages();
      editionPanel.hidden = false;
    }

    function populateEditionLanguages() {
      const source = state.brief?.language || "ru";
      const options = NARRATION_LANGUAGES.filter(entry => entry.code !== source);
      const previous = editionLanguageSelect.value;
      editionLanguageSelect.replaceChildren(...options.map(entry => new Option(entry.label, entry.code)));
      if (options.some(entry => entry.code === previous)) editionLanguageSelect.value = previous;
    }

    function setEditionStatus(text) {
      editionStatus.textContent = text;
      editionStatus.hidden = false;
    }

    async function createEdition() {
      if (editionInFlight) return; // гард двойного запуска
      const targetLanguage = editionLanguageSelect.value;
      if (!targetLanguage) {
        setEditionStatus("Выбери язык издания.");
        return;
      }
      const label = NARRATION_LANGUAGES.find(entry => entry.code === targetLanguage)?.label || targetLanguage;
      const byokPreset = selectedByokPreset();
      let endpoint;
      let model = wizardModelSelect.value || undefined;
      if (byokPreset) {
        const byokModel = wizardByokModel.value.trim();
        const baseUrl = wizardByokBaseUrl.value.trim();
        if (!baseUrl || !byokModel) {
          setEditionStatus("Укажи Base URL и модель для своего API (панель сборки из темы).");
          return;
        }
        endpoint = { kind: "openai", baseUrl, apiKey: wizardByokKey.value, model: byokModel };
        model = undefined;
      }
      editionInFlight = true;
      createEditionButton.disabled = true;
      setEditionStatus(`Перевожу издание на «${label}»… reasoning-модель думает минутами.`);
      let data;
      try {
        data = await fetchJson("/api/local-media/edition", {
          method: "POST",
          headers: { "content-type": "application/json", "x-hermest-local-media": "1" },
          body: JSON.stringify({ project: buildProjectDocument(), targetLanguage, endpoint, model })
        });
      } catch (error) {
        setEditionStatus(friendlyErrorMessage(error, "edition"));
        editionInFlight = false;
        createEditionButton.disabled = false;
        return;
      }
      const edition = data.edition || {};
      editionInFlight = false;
      createEditionButton.disabled = false;
      if (edition.status === "ready" && data.project) {
        // Готовый перевод рендерится тем же проверенным путём как отдельный MP4.
        setEditionStatus(`Перевод на «${label}» готов. Рендерю MP4 издания…`);
        await renderLocalVideo(data.project);
        return;
      }
      if (edition.status === "voice_missing" || edition.status === "error") {
        setEditionStatus(humanizeDetail(edition.message, "edition") || "Издание недоступно для этого языка.");
        return;
      }
      setEditionStatus(friendlyErrorMessage(null, "edition"));
    }

    // Переподключение к render-job после reload (id сохранён в localStorage).
    async function resumeRenderJob(jobId) {
      if (activeLocalRenderJobId) return;
      let data;
      try {
        data = await fetchJson(`/api/local-media/jobs/${encodeURIComponent(jobId)}`);
      } catch {
        clearActiveJob("render");
        return;
      }
      const job = data.job || {};
      if (job.status !== "queued" && job.status !== "running") {
        clearActiveJob("render");
        return;
      }
      const pollToken = ++localRenderPollToken;
      activeLocalRenderJobId = jobId;
      renderLocalVideoButton.disabled = true;
      localRenderPlatform.disabled = true;
      cancelLocalRenderButton.disabled = false;
      localRenderElapsedTimer.start(Date.parse(job.createdAt));
      renderLocalJobStatus(job);
      await settleRenderJob(jobId, pollToken);
    }

    async function pollLocalRenderJob(jobId, pollToken) {
      const deadline = Date.now() + 10 * 60 * 1000;
      while (Date.now() < deadline && pollToken === localRenderPollToken) {
        const data = await fetchJson(`/api/local-media/jobs/${encodeURIComponent(jobId)}`);
        renderLocalJobStatus(data.job);
        if (["completed", "failed", "cancelled"].includes(data.job.status)) return data.job;
        await wait(750);
      }
      throw new Error("local_render_poll_timeout");
    }

    async function cancelLocalRender() {
      const jobId = activeLocalRenderJobId;
      // Гард от двойного нажатия и отмены без активного рендера.
      if (!jobId || renderCancelInFlight) return;
      renderCancelInFlight = true;
      cancelLocalRenderButton.disabled = true;
      localRenderStatus.textContent = "Отменяю рендер…";
      try {
        const data = await fetchJson(`/api/local-media/jobs/${encodeURIComponent(jobId)}`, {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
            "x-hermest-local-media": "1"
          },
          body: "{}"
        });
        // 202 → сервер отменяет; финальный статус подтвердит poll. Показываем ответ сразу.
        renderLocalJobStatus(data.job);
      } catch (error) {
        const code = error.payload && error.payload.code;
        if (code === "local_media_job_not_found") {
          localRenderStatus.textContent = "Рендер уже завершился — отменять нечего.";
        } else if (code === "local_media_job_not_cancellable") {
          localRenderStatus.textContent = "Рендер уже завершается — отмена невозможна.";
        } else {
          // Ошибка самой отмены — разрешаем повтор, рендер продолжает опрашиваться.
          localRenderStatus.textContent = "Не удалось отменить рендер. Попробуй ещё раз.";
          if (activeLocalRenderJobId) cancelLocalRenderButton.disabled = false;
        }
      } finally {
        renderCancelInFlight = false;
      }
    }

    function renderLocalJobStatus(job = {}) {
      // Ведущая строка — на понятном пользователю языке; developer-детали идут вторичными.
      const status = job.status || "unknown";
      const progressLabel = typeof job.progress?.label === "string" ? job.progress.label.slice(0, 120) : "";
      const base = {
        queued: "Рендер в очереди…",
        running: "Идёт рендер MP4… можно отменить.",
        cancelling: "Отменяю рендер…",
        cancelled: "Рендер отменён. Можешь изменить настройки и запустить снова.",
        failed: "Рендер не удался.",
        completed: "Готово: MP4 собран."
      }[status] || `Статус: ${status}`;
      // Пока рендер идёт — показываем этап от worker (напр. «Сцена 3 из 6»), если он прислан.
      const headline = status === "running" && progressLabel ? `${progressLabel}… можно отменить.` : base;
      const details = [
        job.blockers?.length ? `Что мешает: ${job.blockers.join(", ")}` : "",
        job.candidate?.blockers?.length ? `Требует внимания: ${job.candidate.blockers.join(", ")}` : "",
        job.warnings?.length ? `Предупреждения: ${job.warnings.join(", ")}` : "",
        job.error ? `Детали: ${humanizeDetail(job.error, "render")}` : ""
      ].filter(Boolean);
      localRenderStatus.textContent = [headline, ...details].join("\n");
    }

    function renderLocalArtifactLinks(job) {
      localRenderArtifacts.replaceChildren();
      for (const artifact of job.artifacts || []) {
        if (!artifact.url) continue;
        const link = document.createElement("a");
        link.href = artifact.url;
        link.download = artifact.name;
        link.textContent = artifact.name;
        link.rel = "noopener";
        const meta = document.createElement("span");
        meta.textContent = artifact.bytes ? `${artifact.type} · ${artifact.bytes} bytes` : artifact.type;
        const row = document.createElement("div");
        row.className = "artifact-row";
        row.append(link, meta);
        localRenderArtifacts.append(row);
      }
    }

    function formatMediaBytes(bytes) {
      const value = Number(bytes);
      if (!Number.isFinite(value) || value <= 0) return "—";
      if (value >= 1048576) return `${(value / 1048576).toFixed(1)} МБ`;
      if (value >= 1024) return `${(value / 1024).toFixed(1)} КБ`;
      return `${value} B`;
    }

    function formatDurationSeconds(seconds) {
      const value = Number(seconds);
      if (!Number.isFinite(value) || value < 0) return "—";
      const total = Math.round(value);
      return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
    }

    function analyticsResolutionText(analytics) {
      const res = analytics.resolution;
      if (!res || !Number.isFinite(res.width) || !Number.isFinite(res.height)) return "—";
      return analytics.aspectRatio ? `${res.width}×${res.height} · ${analytics.aspectRatio}` : `${res.width}×${res.height}`;
    }

    function analyticsQcText(qcPassed) {
      if (qcPassed === true) return "пройдена ✓";
      if (qcPassed === false) return "не пройдена ✗";
      return "—";
    }

    // Аналитика ролика: честная сводка из job.analytics (backend деривирует из verified manifest).
    // Пустое состояние — блок скрыт; отсутствующие значения показываются как «—», без undefined/NaN.
    function renderRenderAnalytics(job) {
      const analytics = job && typeof job.analytics === "object" ? job.analytics : null;
      if (!analytics) {
        localRenderAnalytics.hidden = true;
        localRenderAnalytics.replaceChildren();
        return;
      }
      const rows = [
        ["Длительность", formatDurationSeconds(analytics.durationSeconds)],
        ["Разрешение", analyticsResolutionText(analytics)],
        ["Формат", analytics.recipeId || "—"],
        ["Проверка (QC)", analyticsQcText(analytics.qcPassed)],
        ["Громкость", Number.isFinite(analytics.integratedLufs) ? `${analytics.integratedLufs} LUFS` : "—"]
      ];
      if (Number.isFinite(analytics.truePeakDbtp)) rows.push(["True Peak", `${analytics.truePeakDbtp} dBTP`]);
      rows.push(
        ["Размер MP4", formatMediaBytes(analytics.videoBytes)],
        ["Сцен", Number.isFinite(analytics.sceneCount) ? String(analytics.sceneCount) : "—"]
      );
      if (Number.isFinite(analytics.footageCount) && analytics.footageCount > 0) {
        rows.push(["B-roll клипов", String(analytics.footageCount)]);
      }
      rows.push(
        ["Голос · язык", [analytics.voice, analytics.language].filter(Boolean).join(" · ") || "—"],
        ["Музыка", analytics.musicUsed ? "да" : "нет"],
        ["Артефактов", Number.isFinite(analytics.artifactCount) ? String(analytics.artifactCount) : "—"],
        ["SHA-256 (MP4)", typeof analytics.videoSha256 === "string" && analytics.videoSha256 ? `${analytics.videoSha256.slice(0, 16)}…` : "—"]
      );
      const heading = document.createElement("h3");
      heading.textContent = "Аналитика ролика";
      const grid = document.createElement("dl");
      grid.className = "analytics-grid";
      for (const [label, value] of rows) {
        const term = document.createElement("dt");
        term.textContent = label;
        const detail = document.createElement("dd");
        detail.textContent = value;
        grid.append(term, detail);
      }
      const children = [heading, grid];
      // Блокеры/предупреждения — честно показываем, если worker их вернул.
      const notices = [
        ["Блокеры", "analytics-blockers", Array.isArray(analytics.blockers) ? analytics.blockers : []],
        ["Предупреждения", "analytics-warnings", Array.isArray(analytics.warnings) ? analytics.warnings : []]
      ];
      for (const [label, className, items] of notices) {
        if (!items.length) continue;
        const caption = document.createElement("p");
        caption.className = "analytics-notice-label";
        caption.textContent = label;
        const list = document.createElement("ul");
        list.className = className;
        for (const item of items) {
          const li = document.createElement("li");
          li.textContent = String(item);
          list.append(li);
        }
        children.push(caption, list);
      }
      const copyButton = document.createElement("button");
      copyButton.className = "analytics-copy";
      copyButton.type = "button";
      copyButton.textContent = "Скопировать сводку";
      copyButton.addEventListener("click", () => {
        const lines = rows.map(([label, value]) => `${label}: ${value}`);
        for (const [label, , items] of notices) {
          if (items.length) lines.push(`${label}: ${items.join("; ")}`);
        }
        const text = lines.join("\n");
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(text).then(
            () => { copyButton.textContent = "Скопировано"; },
            () => { copyButton.textContent = "Не удалось скопировать"; }
          );
        }
      });
      children.push(copyButton);
      localRenderAnalytics.replaceChildren(...children);
      localRenderAnalytics.hidden = false;
    }

    async function checkLocalMediaStatus() {
      try {
        const data = await fetchJson("/api/local-media/status");
        localRenderStatus.textContent = data.mode === "local_only"
          ? "Local media worker готов. Публикация отключена; создаются только локальные артефакты."
          : "Local media worker вернул неизвестный режим.";
      } catch {
        localRenderStatus.textContent = "Local media worker не запущен. Для настоящего MP4 открой Board через `npm run dev`.";
      }
    }

    async function fetchJson(url, options = {}) {
      const headers = {
        "accept": "application/json",
        ...(options.headers || {})
      };
      const response = await fetch(url, { ...options, headers });
      const text = await response.text();
      const data = text ? JSON.parse(text) : {};
      if (!response.ok) {
        const error = new Error(data.error || `http_${response.status}`);
        error.payload = data;
        throw error;
      }
      return data;
    }

    function productApi(route) {
      return `/api/product?route=${encodeURIComponent(route)}`;
    }

    function buildPublishPackageObject() {
      const script = state.script?.trim() || buildScriptFromState();
      const title = state.title || "Hermest Board";
      const platforms = state.publish.platforms || [];
      const languages = selectedLanguages();
      const cards = orderedCards().map(card => ({
        id: card.id,
        title: card.title,
        text: card.text,
        tags: card.tags || []
      }));
      return {
        schema: "hermest.publish.pack.v1",
        createdAt: new Date().toISOString(),
        title,
        status: "draft_until_platform_connectors_are_linked",
        platforms,
        platformLabels: platforms.map(platformLabel),
        languages,
        tools: state.publish.tools || [],
        toolLabels: (state.publish.tools || []).map(toolLabel),
        researchQuery: state.publish.researchQuery || "",
        script,
        plan: state.plan || "",
        roadmap: state.roadmap || "",
        mediaBrief: buildMediaBrief(),
        cards,
        platformSpecs: platforms.map(platform => buildPlatformSpec(platform, title, script)),
        agentQueue: [
          "parse_board_and_attached_plan",
          "collect_or_generate_context_media",
          "rights_check_all_external_assets",
          "render_vertical_9_16_versions",
          "render_horizontal_16_9_youtube_version",
          "localize_script_titles_descriptions_and_subtitles",
          "wait_for_platform_connectors",
          "upload_drafts_or_publish_when_allowed",
          "store_links_errors_metrics_and_next_actions"
        ],
        connectorRequirements: {
          tiktok: "TikTok Content Posting API or approved OAuth publishing flow",
          youtube_video: "YouTube Data API upload permission",
          youtube_shorts: "YouTube Data API upload permission with Shorts-ready vertical asset",
          instagram_reels: "Meta Graph API Instagram Content Publishing permission",
          instagram_feed: "Meta Graph API Instagram Content Publishing permission"
        }
      };
    }

    function buildPlatformSpec(platform, title, script) {
      const commonTags = collectHashtags();
      const shortText = summarizeForDescription(script, 420);
      const isShort = platform === "tiktok" || platform === "youtube_shorts" || platform === "instagram_reels";
      const isSquare = platform === "instagram_feed";
      // Квадрат — не короткий вертикальный и не длинный горизонтальный: у ленты
      // свой набор требований, и сваливать её в одну из двух прежних веток
      // значит выдать площадке заведомо неверный список ассетов.
      const format = isSquare
        ? "square_1_1_feed"
        : isShort ? "vertical_9_16_short" : "horizontal_16_9_long";
      const assetRequirements = isSquare
        ? ["video_1_1_mp4", "captions", "cover_frame", "description"]
        : isShort
          ? ["video_9_16_webm_or_mp4", "captions", "cover_frame", "localized_caption"]
          : ["video_16_9_webm_or_mp4", "cover_frame", "description", "chapters", "subtitles"];
      return {
        platform,
        label: platformLabel(platform),
        format,
        title: platform === "youtube_video" ? `${title}: оболочка над ИИ-агентами` : "Hermest: ИИ-агенты под контролем",
        description: `${shortText}\n\n${commonTags.join(" ")}`,
        hashtags: commonTags,
        publishMode: "draft_or_publish_after_connector_linked",
        assetRequirements
      };
    }

    function buildPublishPackageText() {
      const pack = buildPublishPackageObject();
      const platformBlocks = pack.platformSpecs.map(spec => [
        `Площадка: ${spec.label}`,
        `Формат: ${spec.format}`,
        `Заголовок: ${spec.title}`,
        `Описание: ${spec.description}`,
        `Ассеты: ${spec.assetRequirements.join(", ")}`
      ].join("\n")).join("\n\n");
      return [
        "PUBLISH PACK",
        `Проект: ${pack.title}`,
        `Статус: ${pack.status}`,
        `Площадки: ${pack.platformLabels.join(", ") || "не выбраны"}`,
        `Языки: ${pack.languages.join(", ") || "не выбраны"}`,
        `Инструменты агента: ${pack.toolLabels.join(", ") || "не выбраны"}`,
        "",
        "Очередь агента:",
        pack.agentQueue.map((step, index) => `${index + 1}. ${step}`).join("\n"),
        "",
        "Площадки:",
        platformBlocks,
        "",
        "Media brief:",
        pack.mediaBrief,
        "",
        "Connector requirements:",
        Object.entries(pack.connectorRequirements).map(([key, value]) => `- ${platformLabel(key)}: ${value}`).join("\n")
      ].join("\n");
    }

    function collectHashtags() {
      const tags = new Set(["#AI", "#AIAgents", "#Hermest", "#automation", "#content"]);
      for (const card of state.cards) {
        for (const tag of card.tags || []) {
          const normalized = String(tag).replace(/[^a-zA-Zа-яА-Я0-9_]+/g, "");
          if (normalized) tags.add(`#${normalized}`);
        }
      }
      return [...tags].slice(0, 20);
    }

    function summarizeForDescription(text, limit) {
      const clean = String(text || "").replace(/\s+/g, " ").trim();
      if (clean.length <= limit) return clean;
      return `${clean.slice(0, limit - 1).replace(/\s+\S*$/, "")}...`;
    }

    function readTextFile(input, field) {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result || "").trim();
        if (field === "plan") {
          state.plan = text;
          planInput.value = text;
          saveState("План прицеплен");
        }
        if (field === "roadmap") {
          state.roadmap = text;
          roadmapInput.value = text;
          saveState("Roadmap прицеплен");
        }
      };
      reader.onerror = () => {
        statusEl.textContent = "Файл не прочитан";
      };
      reader.readAsText(file);
    }

    async function speakText(text) {
      tourAbort = false;
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      const chunks = splitForSpeech(text);
      for (const chunk of chunks) {
        if (tourAbort) break;
        await speakSegment(chunk);
      }
    }

    function splitForSpeech(text) {
      const paragraphs = String(text).split(/\n{2,}/).map(part => part.trim()).filter(Boolean);
      const chunks = [];
      for (const paragraph of paragraphs) {
        if (paragraph.length <= 900) {
          chunks.push(paragraph);
          continue;
        }
        const sentences = paragraph.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [paragraph];
        let chunk = "";
        for (const sentence of sentences) {
          if ((chunk + sentence).length > 900 && chunk) {
            chunks.push(chunk.trim());
            chunk = "";
          }
          chunk += `${sentence.trim()} `;
        }
        if (chunk.trim()) chunks.push(chunk.trim());
      }
      return chunks.length ? chunks : [String(text)];
    }

    function speakSegment(text) {
      const clean = String(text || "").replace(/\s+/g, " ").trim();
      if (!clean) return Promise.resolve();
      const fallbackMs = clamp(clean.split(" ").length * 430, 1400, 18000);
      if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
        return wait(fallbackMs);
      }
      return new Promise(resolve => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve();
        };
        const utterance = new SpeechSynthesisUtterance(clean);
        utterance.lang = "ru-RU";
        utterance.rate = 0.96;
        utterance.pitch = 1;
        utterance.volume = 1;
        const voices = window.speechSynthesis.getVoices();
        const ruVoice = voices.find(voice => /^ru/i.test(voice.lang)) || voices.find(voice => /Russian|рус/i.test(voice.name));
        if (ruVoice) utterance.voice = ruVoice;
        utterance.onend = finish;
        utterance.onerror = finish;
        const timer = setTimeout(finish, fallbackMs + 2400);
        window.speechSynthesis.speak(utterance);
      });
    }

    async function playTour(options = {}) {
      const wasRecording = document.body.classList.contains("recording");
      tourAbort = false;
      document.body.classList.add("recording", "touring");
      document.getElementById("recordMode").dataset.active = "true";
      statusEl.textContent = "Тур запущен";
      const cards = orderedCards();
      try {
        await wait(500);
        for (const card of cards) {
          if (tourAbort) break;
          selectedId = card.id;
          setSelected(card.id);
          focusCard(card);
          await wait(760);
          if (options.speak !== false) {
            await speakSegment(`${card.title}. ${card.text}`);
          } else {
            await wait(1800);
          }
        }
        if (!tourAbort && options.speak !== false && state.plan?.trim()) {
          await speakSegment(`План проекта. ${state.plan}`);
        }
        if (!tourAbort && options.speak !== false && state.roadmap?.trim()) {
          await speakSegment(`Roadmap. ${state.roadmap}`);
        }
      } finally {
        document.body.classList.remove("touring");
        if (!wasRecording && !options.keepRecording) {
          document.body.classList.remove("recording");
          document.getElementById("recordMode").dataset.active = "false";
        }
        if (!tourAbort) statusEl.textContent = "Тур завершен";
      }
    }

    function stopPlayback() {
      tourAbort = true;
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      if (activeRecorder && activeRecorder.state === "recording") activeRecorder.stop();
      if (activeStream) activeStream.getTracks().forEach(track => track.stop());
      document.body.classList.remove("touring");
      statusEl.textContent = "Остановлено";
    }

    function focusCard(card) {
      const controlsHidden = document.body.classList.contains("recording");
      const compactShell = window.innerWidth < 900;
      const safeLeft = controlsHidden || compactShell ? 32 : 104;
      const safeTop = 32;
      const safeRight = controlsHidden || sidePanel.hidden || compactShell ? 32 : 404;
      const safeBottom = controlsHidden || !compactShell ? 32 : 104;
      const viewW = Math.max(320, window.innerWidth - safeLeft - safeRight);
      const viewH = Math.max(260, window.innerHeight - safeTop - safeBottom);
      const zoom = clamp(Math.min(viewW / (card.w + 240), viewH / (card.h + 220)), 0.72, 1.16);
      state.view.zoom = zoom;
      state.view.x = Math.round(safeLeft + viewW / 2 - (card.x + card.w / 2) * zoom);
      state.view.y = Math.round(safeTop + viewH / 2 - (card.y + card.h / 2) * zoom);
      applyView();
      drawLinks();
    }

    async function recordVideo() {
      if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === "undefined") {
        statusEl.textContent = "Запись WebM недоступна в этом браузере";
        return;
      }
      state.script = state.script?.trim() || buildScriptFromState();
      scriptOutput.value = state.script;
      saveState("Выбери окно Hermest Board для записи");
      try {
        activeStream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: 30 },
          audio: true
        });
        const chunks = [];
        const mimeType = bestRecorderMimeType();
        activeRecorder = new MediaRecorder(activeStream, mimeType ? { mimeType } : undefined);
        activeRecorder.ondataavailable = event => {
          if (event.data?.size) chunks.push(event.data);
        };
        activeRecorder.onstop = () => {
          const blob = new Blob(chunks, { type: mimeType || "video/webm" });
          downloadBlob(blob, `hermest-board-${timestampSlug()}.webm`);
          if (activeStream) activeStream.getTracks().forEach(track => track.stop());
          activeRecorder = null;
          activeStream = null;
          document.body.classList.remove("recording", "touring");
          document.getElementById("recordMode").dataset.active = "false";
          statusEl.textContent = "WebM сохранен";
        };
        activeRecorder.start(500);
        await wait(800);
        await playTour({ speak: true, keepRecording: true });
        await wait(900);
        if (activeRecorder?.state === "recording") activeRecorder.stop();
      } catch (_) {
        if (activeStream) activeStream.getTracks().forEach(track => track.stop());
        activeRecorder = null;
        activeStream = null;
        document.body.classList.remove("touring");
        statusEl.textContent = "Запись отменена";
      }
    }

    function bestRecorderMimeType() {
      const types = [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm"
      ];
      return types.find(type => MediaRecorder.isTypeSupported(type)) || "";
    }

    function downloadBlob(blob, filename) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    function timestampSlug() {
      return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    }

    function wait(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    function fitView() {
      if (!state.cards.length) return;
      const minX = Math.min(...state.cards.map(c => c.x));
      const minY = Math.min(...state.cards.map(c => c.y));
      const maxX = Math.max(...state.cards.map(c => c.x + c.w));
      const maxY = Math.max(...state.cards.map(c => c.y + c.h));
      const controlsHidden = document.body.classList.contains("recording");
      const compactShell = window.innerWidth < 900;
      const safeLeft = controlsHidden || compactShell ? 24 : 96;
      const safeTop = controlsHidden ? 24 : 86;
      const safeRight = controlsHidden || sidePanel.hidden || compactShell ? 24 : 396;
      const safeBottom = controlsHidden || !compactShell ? 24 : 96;
      const viewW = Math.max(320, window.innerWidth - safeLeft - safeRight);
      const viewH = Math.max(260, window.innerHeight - safeTop - safeBottom);
      const pad = 46;
      const zoom = clamp(Math.min(viewW / (maxX - minX + pad * 2), viewH / (maxY - minY + pad * 2)), 0.45, 1.2);
      state.view.zoom = zoom;
      state.view.x = Math.round(safeLeft + (viewW - (maxX - minX) * zoom) / 2 - minX * zoom);
      state.view.y = Math.round(safeTop + (viewH - (maxY - minY) * zoom) / 2 - minY * zoom);
      applyView();
      saveState("Вид подогнан");
    }

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, ch => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      }[ch]));
    }

    function prepareImage(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error);
        reader.onload = () => {
          const img = new Image();
          img.onload = () => {
            const maxSide = 1400;
            const sourceW = img.naturalWidth || img.width;
            const sourceH = img.naturalHeight || img.height;
            const scale = Math.min(1, maxSide / Math.max(sourceW, sourceH));
            const width = Math.max(1, Math.round(sourceW * scale));
            const height = Math.max(1, Math.round(sourceH * scale));
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL("image/jpeg", 0.82));
          };
          img.onerror = () => resolve(reader.result);
          img.src = reader.result;
        };
        reader.readAsDataURL(file);
      });
    }

    function visual(kind, title, subtitle) {
      const palettes = {
        user: ["#5eead4", "#0f766e", "#172554"],
        core: ["#f0abfc", "#7c3aed", "#082f49"],
        router: ["#38bdf8", "#0369a1", "#111827"],
        agents: ["#93c5fd", "#2563eb", "#020617"],
        tools: ["#60a5fa", "#0f766e", "#111827"],
        workflow: ["#fb7185", "#be123c", "#111827"],
        memory: ["#a7f3d0", "#047857", "#052e2b"],
        open: ["#facc15", "#a16207", "#1e1b4b"],
        logs: ["#c084fc", "#6d28d9", "#111827"],
        guard: ["#f97316", "#9a3412", "#111827"],
        plan: ["#22c55e", "#15803d", "#052e16"],
        roadmap: ["#eab308", "#854d0e", "#111827"],
        voice: ["#f472b6", "#be185d", "#111827"],
        result: ["#2dd4bf", "#0f766e", "#111827"],
        business: ["#fda4af", "#be123c", "#111827"]
      };
      const [accent, deep, dark] = palettes[kind] || palettes.core;
      const motifs = {
        user: `<circle cx="170" cy="205" r="54" fill="${accent}" opacity=".22"/><path d="M110 278c24-62 96-62 120 0" stroke="${accent}" stroke-width="16" fill="none" opacity=".7"/><path d="M330 120h250M330 172h190M330 224h270" stroke="#e9f7ff" stroke-width="13" opacity=".22"/>`,
        core: `<circle cx="400" cy="220" r="92" fill="${accent}" opacity=".18"/><circle cx="400" cy="220" r="38" fill="${accent}" opacity=".84"/><path d="M400 86v92M400 262v92M266 220h92M442 220h92M304 124l64 64M496 124l-64 64M304 316l64-64M496 316l-64-64" stroke="${accent}" stroke-width="11" opacity=".72"/>`,
        router: `<path d="M116 212h180M296 212l86-88M296 212l86 88M382 124h270M382 300h270" stroke="${accent}" stroke-width="15" fill="none" opacity=".72"/><circle cx="296" cy="212" r="34" fill="${accent}" opacity=".86"/><circle cx="652" cy="124" r="28" fill="#e9f7ff" opacity=".26"/><circle cx="652" cy="300" r="28" fill="#e9f7ff" opacity=".26"/>`,
        agents: `<path d="M210 248l190-104 190 104M210 248l190 70 190-70" stroke="${accent}" stroke-width="10" fill="none" opacity=".58"/><circle cx="210" cy="248" r="46" fill="${accent}" opacity=".32"/><circle cx="400" cy="144" r="54" fill="${accent}" opacity=".72"/><circle cx="590" cy="248" r="46" fill="${accent}" opacity=".32"/><circle cx="400" cy="318" r="40" fill="#e9f7ff" opacity=".2"/>`,
        tools: `<rect x="138" y="110" width="174" height="190" rx="22" fill="${accent}" opacity=".26"/><rect x="365" y="92" width="270" height="228" rx="24" fill="#e9f7ff" opacity=".1"/><path d="M182 160h86M182 206h86M182 252h62M420 154h160M420 205h118M420 256h176" stroke="${accent}" stroke-width="12" opacity=".78"/>`,
        workflow: `<path d="M118 306c98-178 248 48 356-118 42-64 112-74 198-12" stroke="${accent}" stroke-width="15" fill="none" opacity=".78"/><rect x="120" y="116" width="172" height="96" rx="18" fill="${accent}" opacity=".24"/><rect x="314" y="238" width="172" height="96" rx="18" fill="#e9f7ff" opacity=".12"/><rect x="508" y="116" width="172" height="96" rx="18" fill="${accent}" opacity=".2"/>`,
        memory: `<path d="M176 280l116-128 122 74 132-112 96 142" stroke="${accent}" stroke-width="12" fill="none" opacity=".72"/><circle cx="176" cy="280" r="32" fill="${accent}" opacity=".68"/><circle cx="292" cy="152" r="36" fill="${accent}" opacity=".34"/><circle cx="414" cy="226" r="30" fill="#e9f7ff" opacity=".2"/><circle cx="546" cy="114" r="36" fill="${accent}" opacity=".48"/><circle cx="642" cy="256" r="32" fill="${accent}" opacity=".28"/>`,
        open: `<path d="M158 112h484v210H158z" fill="#e9f7ff" opacity=".08"/><path d="M158 188h484M282 112v210M518 112v210" stroke="${accent}" stroke-width="10" opacity=".56"/><path d="M214 262l52-50 52 50M462 212l52 50 72-92" stroke="${accent}" stroke-width="14" fill="none" opacity=".8"/>`,
        logs: `<path d="M180 120h440M180 174h330M180 228h390M180 282h250" stroke="${accent}" stroke-width="14" opacity=".66"/><path d="M122 120h28M122 174h28M122 228h28M122 282h28" stroke="#e9f7ff" stroke-width="14" opacity=".24"/><rect x="580" y="238" width="78" height="78" rx="18" fill="${accent}" opacity=".26"/>`,
        guard: `<path d="M400 92l210 82v96c0 88-86 144-210 178-124-34-210-90-210-178v-96z" fill="${accent}" opacity=".18" stroke="${accent}" stroke-width="12"/><path d="M306 240l62 60 126-132" stroke="${accent}" stroke-width="18" fill="none" opacity=".9"/>`,
        plan: `<rect x="150" y="104" width="500" height="238" rx="24" fill="#e9f7ff" opacity=".1"/><path d="M214 170h340M214 224h260M214 278h302" stroke="${accent}" stroke-width="14" opacity=".78"/><path d="M164 170h22M164 224h22M164 278h22" stroke="#e9f7ff" stroke-width="14" opacity=".32"/>`,
        roadmap: `<path d="M130 292c106-160 230-22 338-128 68-66 120-74 212-26" stroke="${accent}" stroke-width="16" fill="none" opacity=".78"/><circle cx="130" cy="292" r="28" fill="${accent}" opacity=".76"/><circle cx="338" cy="210" r="28" fill="#e9f7ff" opacity=".22"/><circle cx="468" cy="164" r="28" fill="${accent}" opacity=".54"/><circle cx="680" cy="138" r="28" fill="${accent}" opacity=".32"/>`,
        voice: `<path d="M172 250h90l118 74V118l-118 74h-90z" fill="${accent}" opacity=".4"/><path d="M448 174c32 36 32 86 0 122M506 130c68 78 68 168 0 246" stroke="${accent}" stroke-width="16" fill="none" opacity=".78"/><rect x="580" y="118" width="92" height="192" rx="24" fill="#e9f7ff" opacity=".12"/>`,
        result: `<path d="M160 284h480" stroke="${accent}" stroke-width="16" opacity=".55"/><rect x="174" y="122" width="160" height="116" rx="22" fill="${accent}" opacity=".28"/><rect x="380" y="88" width="246" height="186" rx="24" fill="#e9f7ff" opacity=".12"/><path d="M214 180h76M430 148h142M430 204h96" stroke="${accent}" stroke-width="12" opacity=".78"/>`,
        business: `<path d="M156 292c64-118 128-28 188-128 44-74 112-90 190-26 42 34 70 48 116 18" stroke="${accent}" stroke-width="15" fill="none" opacity=".74"/><path d="M544 114h98v98" stroke="${accent}" stroke-width="15" fill="none" opacity=".8"/><circle cx="214" cy="258" r="34" fill="${accent}" opacity=".28"/><circle cx="402" cy="144" r="40" fill="${accent}" opacity=".34"/>`
      };
      const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 420">
          <defs>
            <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stop-color="${deep}"/>
              <stop offset=".52" stop-color="${dark}"/>
              <stop offset="1" stop-color="#030712"/>
            </linearGradient>
            <radialGradient id="glow" cx=".72" cy=".18" r=".72">
              <stop offset="0" stop-color="${accent}" stop-opacity=".42"/>
              <stop offset=".45" stop-color="${accent}" stop-opacity=".12"/>
              <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
            </radialGradient>
          </defs>
          <rect width="800" height="420" fill="url(#bg)"/>
          <rect width="800" height="420" fill="url(#glow)"/>
          <path d="M0 350c140-60 260 42 400-28 120-60 250-40 400 18" stroke="${accent}" stroke-opacity=".16" stroke-width="3" fill="none"/>
          <path d="M0 0h800v420H0z" fill="none" stroke="${accent}" stroke-opacity=".28" stroke-width="3"/>
          ${motifs[kind] || motifs.core}
          <text x="42" y="62" fill="#e9f7ff" font-family="Inter, Arial, sans-serif" font-size="34" font-weight="800">${svgText(title)}</text>
          <text x="44" y="102" fill="${accent}" font-family="Inter, Arial, sans-serif" font-size="21" font-weight="700">${svgText(subtitle)}</text>
        </svg>`;
      return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
    }

    function svgText(value) {
      return String(value).replace(/[&<>]/g, ch => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;"
      }[ch]));
    }

    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("./sw.js").catch(() => {});
      });
    }

    // Онбординг: заметный вход в главный сценарий «Тема → видео» и первый-запуск приветствие.
    const ONBOARD_KEY = "hermest-board:onboarded";

    // Командная строка всегда на экране, поэтому «открыть мастер» — это просто
    // поставить курсор в поле темы; никакой панели разворачивать не нужно.
    function openWizard(prefillTopic) {
      if (typeof prefillTopic === "string" && prefillTopic) {
        wizardTopicInput.value = prefillTopic.slice(0, 300);
      }
      wizardTopicInput.focus({ preventScroll: true });
    }

    // Один клик — готовый пример борда (детерминированный, без ключей и без сети),
    // чтобы новый пользователь сразу увидел полный проход идея→сценарий→озвучка→экспорт.
    function loadDemoProject() {
      applyProjectDocument(buildDemoProject({ visual, schemaVersion: CONTENT_VERSION }));
      render();
      saveState("Загружен пример «Почему небо голубое»");
      fitView();
    }

    function initOnboarding() {
      const demoButton = document.getElementById("loadDemoBoard");
      if (demoButton) demoButton.addEventListener("click", loadDemoProject);

      const overlay = document.getElementById("welcomeOverlay");
      if (!overlay) return;

      const topicInput = document.getElementById("welcomeTopic");
      const startCta = document.getElementById("welcomeStart");
      const demoCta = document.getElementById("welcomeDemo");
      const skipCta = document.getElementById("welcomeSkip");
      const openWelcomeButton = document.getElementById("openWelcome");
      let welcomeReturnFocus = null;
      const showWelcome = returnFocus => {
        welcomeReturnFocus = returnFocus || document.activeElement;
        overlay.hidden = false;
        requestAnimationFrame(() => { if (topicInput) topicInput.focus(); });
      };
      const dismiss = (restoreFocus = false) => {
        overlay.hidden = true;
        try { localStorage.setItem(ONBOARD_KEY, "1"); } catch (_) {}
        if (restoreFocus && welcomeReturnFocus && typeof welcomeReturnFocus.focus === "function") {
          requestAnimationFrame(() => welcomeReturnFocus.focus());
        }
      };

      if (startCta) startCta.addEventListener("click", () => {
        const topic = topicInput ? topicInput.value.trim() : "";
        dismiss();
        openWizard(topic);
      });
      if (demoCta) demoCta.addEventListener("click", () => {
        dismiss();
        loadDemoProject();
      });
      if (skipCta) skipCta.addEventListener("click", () => dismiss(true));
      if (openWelcomeButton) openWelcomeButton.addEventListener("click", () => showWelcome(openWelcomeButton));
      if (topicInput) topicInput.addEventListener("keydown", event => {
        if (event.key === "Enter" && startCta) { event.preventDefault(); startCta.click(); }
      });
      // Модалка удерживает фокус: Escape закрывает, Tab циклится внутри (a11y).
      const focusables = [topicInput, startCta, demoCta, skipCta].filter(Boolean);
      overlay.addEventListener("keydown", event => {
        if (event.key === "Escape") { event.preventDefault(); dismiss(true); return; }
        if (event.key === "Tab" && focusables.length) {
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      });

      let alreadyOnboarded = false;
      try { alreadyOnboarded = localStorage.getItem(ONBOARD_KEY) === "1"; } catch (_) {}
      if (alreadyOnboarded) overlay.hidden = true;
      else showWelcome();
    }

    // Переподключение к незавершённым задачам после reload (id из localStorage).
    function resumeActiveJobs() {
      const active = readActiveJobs();
      if (active.draft) void resumeDraftJob(active.draft);
      if (active.render) void resumeRenderJob(active.render);
    }

    render();
    renderApiProviderControls();
    syncAiSettingsForm();
    loadApiProviderCatalog();
    checkLocalMediaStatus();
    setTimeout(fitView, 80);
    initOnboarding();
    resumeActiveJobs();
