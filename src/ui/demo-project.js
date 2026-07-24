// Deterministic, secret-free sample board for one-click onboarding (PHASE-5 criterion #4).
// buildDemoProject() returns a project document identical in shape to buildProjectDocument()
// in app.js, so it flows through the normal applyProjectDocument() import path. The `visual`
// SVG generator is injected (app.js owns it) to keep this module pure and unit-testable —
// no network, no credentials, no Date/random, fully reproducible.

export function buildDemoProject({ visual, schemaVersion } = {}) {
  const image = typeof visual === "function" ? visual : () => "";
  const card = (id, x, y, color, kind, kicker, title, text, tags, label, sub) => ({
    id, x, y, w: 330, h: 330, z: 1, rot: 0, color,
    kicker, title, text, tags,
    image: image(kind, label, sub)
  });

  return {
    id: "",
    schemaVersion: schemaVersion || 1,
    title: "Демо: Почему небо голубое",
    view: { x: -80, y: -80, zoom: 1 },
    brief: { language: "ru", voice: "", narrationProvider: "", music: "", generateVisuals: false, brollMode: "auto" },
    plan: [
      "1. Тема: почему днём небо голубое, а на закате красное — короткое научное объяснение.",
      "2. Раскрыть по шагам: вопрос → механизм (рассеяние Рэлея) → закат как следствие.",
      "3. Свести к сценарию для вертикального ролика на 40–60 секунд.",
      "4. Озвучить бесплатным локальным голосом и собрать MP4, затем сделать варианты под площадки."
    ].join("\n"),
    roadmap: [
      "В примере уже готово: идея, вопрос, объяснение, сценарий, план озвучки и экспорта.",
      "Следующий шаг: заменить тему на свою и нажать «Собрать из темы».",
      "Дальше: включить бесплатные фоны или подключить свой ключ для картинок и голоса.",
      "Цель: за несколько минут превратить любую тему в готовый ролик."
    ].join("\n"),
    script: [
      "Ты когда-нибудь задумывался, почему днём небо голубое? Ответ — в том, как солнечный свет встречает воздух.",
      "Солнечный свет кажется белым, но внутри он состоит из всех цветов радуги. Молекулы воздуха сильнее всего рассеивают короткие волны — синие. Этот эффект называют рассеянием Рэлея.",
      "Поэтому днём мы видим рассеянный синий свет со всех сторон неба. А на закате свет проходит сквозь гораздо больше воздуха: синие волны уходят в стороны, и до нас доходят тёплые красные и оранжевые.",
      "Вот и всё объяснение: голубой день и красный закат — это один и тот же свет, просто прошедший разный путь через атмосферу."
    ].join("\n\n"),
    server: { projectId: "", lastSyncedAt: "", storageStatus: "" },
    publish: {
      platforms: ["youtube_shorts", "tiktok", "instagram_reels"],
      tools: ["parser", "web_media", "generated_media"],
      languages: "ru, en",
      mediaBrief: "Вертикальные 9:16 кадры: голубое дневное небо, луч белого света, распад на цвета, тёплый закат. Стиль: чистая обучающая инфографика без текста поверх.",
      researchQuery: "why is the sky blue Rayleigh scattering sunset red",
      packageText: ""
    },
    links: [
      ["idea", "question"],
      ["question", "scatter"],
      ["scatter", "sunset"],
      ["sunset", "voice"],
      ["voice", "export"]
    ],
    cards: [
      card("idea", 120, 150, "#5eead4", "user", "сцена 1 · идея", "Идея ролика",
        "Короткий ролик-объяснение: почему небо голубое днём и красное на закате. Простыми словами, за одну минуту.",
        ["идея", "план"], "IDEA", "тема и цель"),
      card("question", 520, 150, "#f0abfc", "core", "сцена 2 · вопрос", "Главный вопрос",
        "Днём небо голубое, хотя воздух прозрачный. Откуда берётся цвет? С этого вопроса начинаем ролик и цепляем зрителя.",
        ["hook", "вопрос"], "QUESTION", "зацепка в начале"),
      card("scatter", 920, 150, "#a7f3d0", "memory", "сцена 3 · механизм", "Рассеяние Рэлея",
        "Белый свет — это все цвета сразу. Молекулы воздуха сильнее рассеивают короткие синие волны, поэтому небо становится голубым.",
        ["наука", "свет"], "RAYLEIGH", "почему синий"),
      card("sunset", 120, 560, "#fb7185", "workflow", "сцена 4 · следствие", "Почему закат красный",
        "На закате свет идёт через больше воздуха. Синее уходит в стороны, а до нас доходят тёплые красные и оранжевые оттенки.",
        ["закат", "цвет"], "SUNSET", "длинный путь света"),
      card("voice", 520, 560, "#facc15", "voice", "сцена 5 · озвучка", "Озвучка и кадры",
        "Голос — бесплатный Piper локально, без ключей. Фоны можно оставить детерминированными или включить бесплатную генерацию.",
        ["голос", "медиа"], "VOICE + B-ROLL", "бесплатный путь"),
      card("export", 920, 560, "#2dd4bf", "result", "сцена 6 · экспорт", "Готовый ролик",
        "Локальный рендер собирает настоящий MP4. Дальше — варианты под YouTube, TikTok и Reels плюс пакет публикации.",
        ["mp4", "экспорт"], "EXPORT", "MP4 и площадки")
    ]
  };
}
