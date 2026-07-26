// Тестовый долг движка архетипов (стадия 7 плана docs/plans/2026-07-25-scene-archetypes.md).
//
// Каждая проверка идёт по ВСЕМ архетипам, а не по одному образцу: движок выбирает
// макет автоматически, поэтому «проверили classic — значит ок» здесь не работает.

import assert from "node:assert/strict";
import test from "node:test";

import { getPlatformRecipe } from "../../src/domain/platform-recipes.js";
import { FULL_BLEED_ARCHETYPES, SCENE_ARCHETYPES, deriveSceneContent, planSceneArchetypes, pickSceneArchetype } from "../../src/media/scene-content.js";
import { resolveSceneLayout } from "../../src/media/scene-design.js";
import { buildSceneMarkup } from "../../src/media/scene-markup.js";

const HORIZONTAL = getPlatformRecipe("youtube_video");
const VERTICAL = getPlatformRecipe("youtube_shorts");

const SQUARE = getPlatformRecipe("instagram_feed");

const FORMATS = Object.freeze([
  { name: "16:9", recipe: HORIZONTAL },
  { name: "9:16", recipe: VERTICAL },
  { name: "1:1", recipe: SQUARE }
]);

const BRIEF = Object.freeze({ topic: "Как Hermest Board собирает ролик", language: "ru" });

// Карточка со всеми полями сразу: любой архетип найдёт здесь свои данные,
// поэтому один и тот же вход можно прогнать через все двенадцать макетов.
const RICH_SCENE = Object.freeze({
  title: "Что получается на выходе",
  narration:
    "Что получается на выходе. Было: смена монтажёра. Стало: один проход рендера. " +
    "Сначала доска; затем раскадровка; потом озвучка. 3 формата; 48 кГц звук.",
  sceneData: Object.freeze({
    items: Object.freeze(["Длительность", "Громкость", "Субтитры"]),
    steps: Object.freeze(["Доска", "Раскадровка", "Рендер"]),
    formats: Object.freeze(["16:9", "9:16", "1:1"]),
    columns: Object.freeze([
      Object.freeze({ title: "Идея", cards: Object.freeze(["Тезис"]) }),
      Object.freeze({ title: "Готово", cards: Object.freeze(["Мастер"]) })
    ]),
    stat: Object.freeze({ value: "94", unit: "сек", caption: "Полный проход сборки" }),
    compare: Object.freeze({
      left: Object.freeze({ label: "Было", text: "Смена монтажёра", items: Object.freeze(["Стоки"]) }),
      right: Object.freeze({ label: "Стало", text: "Один проход", items: Object.freeze(["Ноутбук"]) })
    }),
    device: Object.freeze({ kind: "laptop", title: "hermest board", lines: Object.freeze(["Доска", "Рендер"]) }),
    quote: Object.freeze({ text: "Под каждый тезис нарисован свой кадр", source: "владелец студии" }),
    cta: "hermest board"
  })
});

function markupFor({ archetype, recipe, scene = RICH_SCENE, role = "body", sceneIndex = 1 }) {
  return buildSceneMarkup({
    scene,
    sceneIndex,
    sceneTitles: ["Первая", "Вторая", "Третья"],
    brief: BRIEF,
    width: recipe.width,
    height: recipe.height,
    seed: 20260725,
    safeZones: recipe.safeZones,
    archetype,
    role
  });
}

// Роли opening/closing перекрывают выбор архетипа на statement, поэтому образцы
// закрывают и их: в раскадровке это первая и последняя сцена.
const ROLE_CASES = Object.freeze([
  ...SCENE_ARCHETYPES.map(archetype => ({ archetype, role: "body", label: archetype })),
  { archetype: "statement", role: "closing", label: "statement:closing" }
]);

test("archetype coverage matches the plan", () => {
  assert.equal(SCENE_ARCHETYPES.length, 12);
  assert.equal(ROLE_CASES.length, 13);
});

// --- детерминизм ------------------------------------------------------------

for (const { archetype, role, label } of ROLE_CASES) {
  for (const { name, recipe } of FORMATS) {
    test(`archetype ${label} renders byte-identical markup for identical input (${name})`, () => {
      const first = markupFor({ archetype, recipe, role });
      const second = markupFor({ archetype, recipe, role });
      assert.equal(first, second);
      assert.ok(first.includes(`data-archetype="${archetype}"`));
    });
  }
}

// --- экранирование ----------------------------------------------------------

const XSS = `<script>alert("xss")</script>`;
const XSS_ATTR = `"><img src=x onerror=alert(1)>`;
const XSS_AMP = `Rock & Roll <b>bold</b> & 'quotes'`;

const HOSTILE_SCENE = Object.freeze({
  title: XSS,
  narration: `${XSS_ATTR} ${XSS_AMP}. Было: ${XSS}. Стало: ${XSS_ATTR}. «${XSS_AMP} внутри цитаты» — ${XSS}. 3 ${XSS_ATTR}; 48 ${XSS_AMP}.`,
  sceneType: "definitely-not-an-archetype",
  sceneData: Object.freeze({
    items: Object.freeze([XSS, XSS_ATTR, XSS_AMP]),
    steps: Object.freeze([XSS, XSS_ATTR, XSS_AMP]),
    formats: Object.freeze([XSS, XSS_ATTR, XSS_AMP]),
    columns: Object.freeze([
      Object.freeze({ title: XSS, cards: Object.freeze([XSS_ATTR, XSS_AMP]) }),
      Object.freeze({ title: XSS_ATTR, cards: Object.freeze([XSS]) })
    ]),
    stat: Object.freeze({ value: XSS, unit: XSS_ATTR, caption: XSS_AMP }),
    compare: Object.freeze({
      left: Object.freeze({ label: XSS, text: XSS_ATTR, items: Object.freeze([XSS_AMP]) }),
      right: Object.freeze({ label: XSS_ATTR, text: XSS_AMP, items: Object.freeze([XSS]) })
    }),
    device: Object.freeze({ kind: XSS, title: XSS_ATTR, lines: Object.freeze([XSS, XSS_AMP]) }),
    quote: Object.freeze({ text: `${XSS_ATTR} ${XSS_AMP}`, source: XSS }),
    cta: XSS_AMP
  })
});

const HOSTILE_BRIEF = Object.freeze({ topic: `</style><script>steal()</script>`, language: `"><script>` });

// Единственные теги, которые шелл и архетипы вправе выпустить. Всё остальное
// внутри `<...>` может появиться только из непроэкранированного текста карточки.
const ALLOWED_TAGS = new Set([
  "html", "head", "meta", "style", "body", "script",
  "div", "span", "h1", "p", "ul", "li", "figure", "figcaption", "blockquote",
  "svg", "g", "circle", "ellipse", "rect", "line", "text", "path", "polygon"
]);

function styleBlock(markup) {
  return markup.slice(markup.indexOf("<style>") + "<style>".length, markup.indexOf("</style>"));
}

/**
 * Все настоящие теги разметки — то, что браузер разберёт как элемент.
 * Содержимое <style> и <script> вырезано: там `<integer>` из @property и
 * `#t=<ms>` из комментария, и это не теги. Что в CSS не попал текст карточки,
 * проверяется отдельно.
 */
function markupTags(markup) {
  const withoutRawText = markup
    .replace(/<style>[\s\S]*?<\/style>/u, "<style></style>")
    .replace(/<script>[\s\S]*?<\/script>/u, "<script></script>");
  return [...withoutRawText.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/gu)].map(match => ({
    name: match[1].toLowerCase(),
    raw: match[0]
  }));
}

for (const { archetype, role, label } of ROLE_CASES) {
  for (const { name, recipe } of FORMATS) {
    test(`archetype ${label} escapes hostile card text (${name})`, () => {
      const markup = buildSceneMarkup({
        scene: HOSTILE_SCENE,
        sceneIndex: 1,
        sceneTitles: [`<svg onload=alert(2)>`, XSS, XSS_ATTR],
        brief: HOSTILE_BRIEF,
        width: recipe.width,
        height: recipe.height,
        seed: 7,
        safeZones: recipe.safeZones,
        archetype,
        role
      });

      // Ни одного постороннего тега: всё, что браузер разберёт как элемент,
      // выпустил шелл или архетип, а не текст карточки.
      for (const tag of markupTags(markup)) {
        assert.ok(ALLOWED_TAGS.has(tag.name), `${label}: посторонний тег ${tag.raw}`);
        assert.ok(!/\son[a-z]+\s*=/u.test(tag.raw), `${label}: обработчик события в теге ${tag.raw}`);
      }
      // В шелле ровно один <style> и ровно один <script> — свой.
      assert.equal(markup.match(/<script\b/gu)?.length ?? 0, 1, "лишний <script>");
      assert.equal(markup.match(/<style\b/gu)?.length ?? 0, 1, "лишний <style>");
      assert.ok(!markup.includes("</style><script>"), "разрыв <style> темой брифа");
      // CSS собирается из чисел и токенов темы: текста карточки там быть не может.
      assert.ok(!/[<>]/u.test(styleBlock(markup).replaceAll(/syntax:\s*"<\w+>"/gu, "")), "разметка утекла в CSS");
      assert.ok(!markup.includes("alert(1)>"), "сырой payload из narration");
      assert.ok(!markup.includes("steal()</script>"), "сырой payload из brief.topic");

      // И положительная сторона: текст всё-таки доехал, но экранированным.
      assert.ok(markup.includes("&lt;script&gt;"), "нет экранированного payload");
      assert.ok(markup.includes("&amp;"), "амперсанд не экранирован");
      const withoutEntities = markup.replaceAll(/&(?:amp|lt|gt|quot|#\d+);/gu, "");
      assert.ok(!withoutEntities.includes("&"), "голый & в разметке");
    });
  }
}

// --- офлайн: ни одной внешней ссылки ---------------------------------------

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

for (const { archetype, role, label } of ROLE_CASES) {
  for (const { name, recipe } of FORMATS) {
    test(`archetype ${label} emits no external reference (${name})`, () => {
      const markup = markupFor({ archetype, recipe, role });
      const withoutNamespace = markup.replaceAll(SVG_NAMESPACE, "");

      assert.ok(!/https?:\/\//u.test(withoutNamespace), "абсолютная ссылка в разметке");
      assert.ok(!/url\(/u.test(markup), "url( в CSS — кадр перестанет собираться офлайн");
      assert.ok(!/@import/u.test(markup), "@import в CSS");
      assert.ok(!/(?:src|href|xlink:href|srcset|data)\s*=\s*"\/\//u.test(markup), "протокол-относительная ссылка");
      assert.ok(!/@font-face/u.test(markup), "внешний шрифт");
      // Единственный внешний идентификатор, который разрешён, — SVG namespace.
      assert.equal(markup.match(/http/gu)?.length ?? 0, markup.match(new RegExp(SVG_NAMESPACE, "gu"))?.length ?? 0);
    });
  }
}

// --- вертикаль 9:16 не обрезанная горизонталь -------------------------------

// Декоративные слои сознательно больше сцены: свечение, аура, блик, глиф
// кавычки. Элементы шелла живут в координатах кадра, а не сцены. Геометрию
// контента проверяем без тех и других.
const DECORATIVE_SELECTORS = Object.freeze([
  ".st-aura", ".qt-glyph", ".sh-halo", ".cl-sweep", ".dv-glare", ".ft-sheen", ".glow-a", ".glow-b"
]);

const SHELL_SELECTORS = Object.freeze([
  "html", "body", ".stage", ".caption-zone", ".backdrop", ".chrome-bar", ".progress",
  ".headline-scrim", ".brand-mark", ".chapter-badge"
]);

function declaredPixelSizes(css) {
  const sizes = [];
  for (const block of css.split("}")) {
    const separator = block.indexOf("{");
    if (separator < 0) continue;
    const selector = block.slice(0, separator).trim();
    if (DECORATIVE_SELECTORS.some(decorative => selector.includes(decorative))) continue;
    if (selector.split(",").every(part => SHELL_SELECTORS.includes(part.trim()))) continue;
    const body = block.slice(separator + 1);
    for (const match of body.matchAll(/(?<!\w)(width|height)\s*:\s*(\d+)px/gu)) {
      sizes.push({ selector, axis: match[1], value: Number(match[2]) });
    }
  }
  return sizes;
}

function declaredMarkupSizes(markup) {
  const sizes = [];
  // Фон-подложка живёт в координатах кадра, а не сцены.
  const body = markup
    .slice(markup.indexOf("<body>"))
    .replace(/<svg class="backdrop"[^>]*>/u, "");
  for (const match of body.matchAll(/<svg[^>]*\swidth="(\d+)"[^>]*\sheight="(\d+)"/gu)) {
    sizes.push({ selector: "svg", axis: "width", value: Number(match[1]) });
    sizes.push({ selector: "svg", axis: "height", value: Number(match[2]) });
  }
  for (const match of body.matchAll(/style="[^"]*?(width|height):(\d+)px/gu)) {
    sizes.push({ selector: "inline", axis: match[1], value: Number(match[2]) });
  }
  return sizes;
}

for (const { archetype, role, label } of ROLE_CASES) {
  test(`archetype ${label} lays out vertically inside the 9:16 stage`, () => {
    const layout = resolveSceneLayout({ width: VERTICAL.width, height: VERTICAL.height, safeZones: VERTICAL.safeZones });
    const markup = markupFor({ archetype, recipe: VERTICAL, role });

    assert.ok(layout.isVertical);
    // Боковые отступы не меньше safe zone рецепта, а не исторических 5%.
    assert.ok(layout.padLeft >= VERTICAL.safeZones.left, `padLeft ${layout.padLeft} < safe ${VERTICAL.safeZones.left}`);
    assert.ok(layout.padRight >= VERTICAL.safeZones.right);
    assert.ok(layout.padTop >= VERTICAL.safeZones.top);
    assert.ok(layout.padBottom >= VERTICAL.safeZones.bottom);

    const css = markup.slice(markup.indexOf("<style>"), markup.indexOf("</style>"));
    // Full-bleed архетип рисует декорацию на весь кадр, поэтому его потолок —
    // кадр, а не сцена. Для всех остальных потолок прежний: вылезти за safe zone
    // нельзя, иначе платформа обрежет содержимое.
    const fullBleed = FULL_BLEED_ARCHETYPES.includes(archetype);
    const widthLimit = fullBleed ? VERTICAL.width : layout.stageWidth;
    const heightLimit = fullBleed ? VERTICAL.height : layout.stageHeight;
    for (const size of [...declaredPixelSizes(css), ...declaredMarkupSizes(markup)]) {
      const limit = size.axis === "width" ? widthLimit : heightLimit;
      assert.ok(
        size.value <= limit,
        `${label}: ${size.selector} ${size.axis}=${size.value}px не влезает в ${fullBleed ? "кадр" : "сцену"} ${limit}px`
      );
    }

    // Вертикаль — своя раскладка, а не обрезанная горизонталь: у всех архетипов
    // главная ось колонкой.
    assert.match(markup, /\.stage \{[^}]*flex-direction:column/su);
  });
}

// Разрешение рисовать во весь кадр (FULL_BLEED_ARCHETYPES) касается только
// декорации. Читаемое — реплика и карточка локации — обязано остаться внутри
// safe zone: за её пределами платформа накладывает свой интерфейс и режет кадр.
function declaredBox(css, selector) {
  const match = css.match(new RegExp(`\\.${selector}\\b[^{]*\\{([^}]*)\\}`, "u"));
  if (!match) return null;
  const body = match[1];
  const px = name => {
    const found = body.match(new RegExp(`(?:^|;|\\s)${name}\\s*:\\s*(-?\\d+)px`, "u"));
    return found ? Number(found[1]) : null;
  };
  return { left: px("left"), top: px("top"), bottom: px("bottom"), width: px("width"), height: px("max-height") ?? px("height") };
}

for (const archetype of FULL_BLEED_ARCHETYPES) {
  for (const { name, recipe } of FORMATS) {
    test(`full-bleed archetype ${archetype} keeps its readable parts inside the safe zone (${name})`, () => {
      const markup = markupFor({ archetype, recipe, role: "body" });
      const css = styleBlock(markup);
      const boxes = ["toon-bubble", "toon-card"].map(selector => [selector, declaredBox(css, selector)]);
      assert.ok(boxes.some(([, box]) => box), "ни одного читаемого блока в разметке");

      for (const [selector, box] of boxes) {
        if (!box) continue;
        if (box.left !== null) {
          assert.ok(box.left >= recipe.safeZones.left, `${selector}: левый край ${box.left} < safe ${recipe.safeZones.left}`);
          if (box.width !== null) {
            const right = box.left + box.width;
            const limit = recipe.width - recipe.safeZones.right;
            assert.ok(right <= limit, `${selector}: правый край ${right} > ${limit}`);
          }
        }
        if (box.top !== null) {
          assert.ok(box.top >= recipe.safeZones.top, `${selector}: верх ${box.top} < safe ${recipe.safeZones.top}`);
        }
        if (box.bottom !== null) {
          assert.ok(box.bottom >= recipe.safeZones.bottom, `${selector}: низ ${box.bottom} < safe ${recipe.safeZones.bottom}`);
          if (box.height !== null) {
            const top = box.bottom + box.height;
            const limit = recipe.height - recipe.safeZones.top;
            assert.ok(top <= limit, `${selector}: верх ${top} > ${limit}`);
          }
        }
      }
    });
  }
}

test("the same archetype lays out differently in 16:9 and 9:16", () => {
  for (const { archetype, role, label } of ROLE_CASES) {
    const horizontal = markupFor({ archetype, recipe: HORIZONTAL, role });
    const vertical = markupFor({ archetype, recipe: VERTICAL, role });
    assert.notEqual(horizontal, vertical, `${label}: вертикаль совпала с горизонталью`);
  }
});

// --- эвристика выбора архетипа ---------------------------------------------

function pick(scene) {
  // sceneIndex 1 из 3 — «тело» раскадровки, где эвристика и работает.
  return pickSceneArchetype({ scene, sceneIndex: 1, sceneCount: 3 }).archetype;
}

test("heuristic picks the archetype the plan promises", () => {
  const cases = [
    {
      why: "перечисление через точку с запятой → checklist",
      scene: { title: "Проверки", narration: "Проверки. Длительность; громкость; субтитры; safe zones." },
      expected: "checklist"
    },
    {
      why: "две колонки в sceneData → board-columns",
      scene: {
        title: "Доска",
        narration: "Доска.",
        sceneData: { columns: [{ title: "Идея", cards: ["Тезис"] }, { title: "Готово", cards: ["Мастер"] }] }
      },
      expected: "board-columns"
    },
    {
      why: "противопоставление было/стало → comparison",
      scene: { title: "Цена", narration: "Цена. Было: монтажёр. Стало: один проход рендера." },
      expected: "comparison"
    },
    {
      why: "ровно одно число → stat-highlight",
      scene: { title: "Скорость", narration: "Скорость. Полный проход укладывается в 94 секунды." },
      expected: "stat-highlight"
    },
    {
      why: "два и более числа → metric-grid",
      scene: { title: "Выход", narration: "Выход. 3 дорожки и 48 килогерц на выходе." },
      expected: "metric-grid"
    },
    {
      why: "маркеры шагов → flow-steps",
      scene: { title: "Проход", narration: "Проход. Сначала карточки, затем раскадровка, потом озвучка, наконец склейка." },
      expected: "flow-steps"
    },
    {
      why: "кавычки → quote",
      scene: { title: "Отзыв", narration: "Отзыв. «Под каждый тезис нарисован свой кадр» — владелец студии." },
      expected: "quote"
    },
    {
      why: "явный sceneType сильнее эвристики",
      scene: { title: "Отзыв", narration: "Отзыв. «Свой кадр» — владелец.", sceneType: "device-mockup" },
      expected: "device-mockup"
    },
    {
      why: "ни одного сигнала → classic",
      scene: { title: "Обзор", narration: "Обзор. Схема связей остаётся откатом." },
      expected: "classic"
    }
  ];

  for (const { why, scene, expected } of cases) {
    assert.equal(pick(scene), expected, why);
  }
});

test("формат кадра и устройство узнаются по ключевым словам", () => {
  assert.equal(
    pick({ title: "Форматы", narration: "Форматы. Горизонталь, вертикаль и квадрат считаются из одной раскадровки." }),
    "format-trio"
  );
  assert.equal(
    pick({ title: "Интерфейс", narration: "Интерфейс. Предпросмотр живёт в одном браузере на экране ноутбука." }),
    "device-mockup"
  );
});

test("role beats heuristics on the first and last scene", () => {
  const scene = { title: "Проверки", narration: "Проверки. Длительность; громкость; субтитры; safe zones." };
  assert.deepEqual(
    pickSceneArchetype({ scene, sceneIndex: 0, sceneCount: 4 }),
    { archetype: "statement", role: "opening", source: "role" }
  );
  assert.deepEqual(
    pickSceneArchetype({ scene, sceneIndex: 3, sceneCount: 4 }),
    { archetype: "statement", role: "closing", source: "role" }
  );
});

// --- разведение подряд идущих архетипов -------------------------------------

test("planSceneArchetypes never repeats an archetype back to back", () => {
  const listScene = index => ({
    title: `Проверки ${index}`,
    narration: `Проверки ${index}. Длительность; громкость; субтитры; safe zones.`
  });
  const scenes = Array.from({ length: 8 }, (unused, index) => listScene(index));
  const plan = planSceneArchetypes(scenes);

  assert.equal(plan.length, scenes.length);
  for (let index = 1; index < plan.length; index += 1) {
    assert.notEqual(
      plan[index].archetype,
      plan[index - 1].archetype,
      `сцены ${index - 1} и ${index} получили один архетип ${plan[index].archetype}`
    );
  }
});

test("identical cards still alternate across the whole storyboard", () => {
  const scene = { title: "Обзор", narration: "Обзор. Схема связей остаётся откатом." };
  const plan = planSceneArchetypes(Array.from({ length: 6 }, () => ({ ...scene })));
  const archetypes = plan.map(entry => entry.archetype);
  for (let index = 1; index < archetypes.length; index += 1) {
    assert.notEqual(archetypes[index], archetypes[index - 1]);
  }
  assert.ok(new Set(archetypes).size >= 3, `слишком бедная ротация: ${archetypes.join(", ")}`);
});

test("explicit sceneType is honoured even when it repeats", () => {
  const scenes = Array.from({ length: 3 }, () => ({
    title: "Кадр",
    narration: "Кадр. Текст.",
    sceneType: "quote"
  }));
  assert.deepEqual(planSceneArchetypes(scenes).map(entry => entry.archetype), ["quote", "quote", "quote"]);
});

// --- мусор на входе ---------------------------------------------------------

test("unknown sceneType falls back to the classic layout", () => {
  const scene = { title: "Обзор", narration: "Обзор. Схема связей остаётся откатом.", sceneType: "wat" };
  assert.equal(pick(scene), "classic");
});

test("garbage sceneData never throws and never reaches the markup", () => {
  const garbage = [
    { title: "A", narration: "A. Текст.", sceneData: null },
    { title: "A", narration: "A. Текст.", sceneData: "строка вместо объекта" },
    { title: "A", narration: "A. Текст.", sceneData: [1, 2, 3] },
    { title: "A", narration: "A. Текст.", sceneData: { items: "не массив", columns: 42, stat: [], compare: "" } },
    { title: "A", narration: "A. Текст.", sceneData: { items: [null, undefined, {}, 0, false] } },
    { title: "A", narration: "A. Текст.", sceneData: { stat: { value: " " }, quote: { text: "  " } } },
    { title: "A", narration: "A. Текст.", sceneData: { device: { kind: 5, lines: [{ toString: () => "x" }] } } },
    { title: "", narration: "", sceneData: {} },
    { title: "A", narration: "A. Текст.", sceneType: 42 },
    { title: "A", narration: "A. Текст.", sceneType: { nope: true } }
  ];

  for (const scene of garbage) {
    assert.doesNotThrow(() => deriveSceneContent(scene));
    for (const { recipe } of FORMATS) {
      const markup = markupFor({ archetype: undefined, recipe, scene });
      assert.ok(markup.startsWith("<!DOCTYPE html>"));
      assert.ok(!markup.includes("undefined"), "undefined утёк в разметку");
      assert.ok(!markup.includes("[object Object]"), "[object Object] утёк в разметку");
      assert.ok(!/[ --]/u.test(markup), "управляющий символ в разметке");
    }
  }
});

test("every archetype survives an empty card", () => {
  for (const { archetype, role, label } of ROLE_CASES) {
    for (const { recipe } of FORMATS) {
      assert.doesNotThrow(
        () => markupFor({ archetype, recipe, role, scene: { title: "", narration: "" } }),
        `${label} упал на пустой карточке`
      );
    }
  }
});

test("unsupported archetype name is rejected, not silently rendered", () => {
  // Шелл принимает только известные архетипы; неизвестное имя игнорируется и
  // подменяется выбором эвристики, а не пробрасывается в рендер.
  const markup = markupFor({ archetype: "no-such-archetype", recipe: HORIZONTAL });
  assert.ok(!markup.includes(`data-archetype="no-such-archetype"`));
  assert.ok(SCENE_ARCHETYPES.some(archetype => markup.includes(`data-archetype="${archetype}"`)));
});
