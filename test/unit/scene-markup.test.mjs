import assert from "node:assert/strict";
import test from "node:test";

import { buildSceneMarkup, escapeHtml } from "../../src/media/scene-markup.js";

const baseInput = Object.freeze({
  scene: Object.freeze({ title: "Обучение на данных", narration: "Первое предложение. Второе предложение." }),
  sceneIndex: 1,
  sceneTitles: Object.freeze(["История ИИ", "Обучение на данных", "Глубокое обучение"]),
  brief: Object.freeze({ topic: "История искусственного интеллекта", language: "ru" }),
  width: 1920,
  height: 1080,
  seed: 123456789
});

test("scene markup is deterministic for identical input", () => {
  assert.equal(buildSceneMarkup({ ...baseInput }), buildSceneMarkup({ ...baseInput }));
});

test("scene markup escapes hostile card text everywhere", () => {
  const markup = buildSceneMarkup({
    ...baseInput,
    scene: {
      title: `<script>alert("xss")</script>`,
      narration: `"><img src=x onerror=alert(1)>`
    },
    sceneTitles: [`<svg onload=alert(2)>`],
    brief: { topic: `</style><script>steal()</script>`, language: `"><script>` }
  });
  assert.ok(!markup.includes("<script>alert"));
  assert.ok(!markup.includes("<img"));
  assert.ok(!markup.includes("<svg onload"));
  assert.ok(!markup.includes("<script>steal"));
  assert.ok(markup.includes("&lt;script&gt;"));
  assert.ok(markup.includes("&lt;img src=x onerror=alert(1)&gt;"));
});

test("scene markup contains no external network references", () => {
  const markup = buildSceneMarkup({ ...baseInput });
  assert.ok(!/https?:\/\//.test(markup.replaceAll("http://www.w3.org/2000/svg", "")));
  assert.ok(!/@import|url\(/.test(markup));
});

test("scene markup carries brand chrome, chapter badge and progress", () => {
  const markup = buildSceneMarkup({ ...baseInput });
  assert.ok(markup.includes("HERMEST BOARD"));
  assert.ok(markup.includes("02 / 03"));
  assert.ok(markup.includes("caption-zone"));
  assert.ok(markup.includes("Первое предложение."));
  assert.ok(!markup.includes("Второе предложение."));
});

test("lead line skips the narrated repeat of the card title", () => {
  const markup = buildSceneMarkup({
    ...baseInput,
    scene: {
      title: "Сначала посчитай",
      // Так нарратив и собирается в пайплайне: заголовок карточки + её текст.
      narration: "Сначала посчитай. Подписка окупается, только если ты ей пользуешься."
    }
  });

  assert.ok(markup.includes("Подписка окупается, только если ты ей пользуешься."));
  assert.equal(markup.match(/Сначала посчитай/g).length, 1, "заголовок не должен дублироваться лидом");
});

test("lead line is dropped when the card says nothing beyond its title", () => {
  const markup = buildSceneMarkup({
    ...baseInput,
    scene: { title: "Сначала посчитай", narration: "Сначала посчитай." }
  });

  assert.ok(!markup.includes(`class="lead"`), "пустой лид не рендерится");
});

test("scene markup adapts to vertical dimensions", () => {
  const vertical = buildSceneMarkup({ ...baseInput, width: 1080, height: 1920 });
  assert.ok(vertical.includes("width: 1080px"));
  assert.ok(vertical.includes("height: 1920px"));
  assert.ok(vertical.includes("flex-direction:column"));
});

test("different seeds move the star field", () => {
  const first = buildSceneMarkup({ ...baseInput, seed: 1 });
  const second = buildSceneMarkup({ ...baseInput, seed: 2 });
  assert.notEqual(first, second);
});

test("scene markup validates dimensions and scene", () => {
  assert.throws(() => buildSceneMarkup({ ...baseInput, width: 0 }), TypeError);
  assert.throws(() => buildSceneMarkup({ ...baseInput, height: -5 }), TypeError);
  assert.throws(() => buildSceneMarkup({ ...baseInput, scene: null }), TypeError);
});

test("escapeHtml covers the html special set", () => {
  assert.equal(escapeHtml(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
});

test("scene markup builds in with staged premium animations by default", () => {
  const html = buildSceneMarkup({ ...baseInput });

  assert.match(html, /@keyframes rise-in/);
  assert.match(html, /@keyframes panel-in/);
  assert.match(html, /@keyframes link-draw/);
  assert.match(html, /@keyframes node-in/);
  assert.match(html, /@keyframes node-pulse/);
  assert.match(html, /@keyframes glow-drift/);
  assert.match(html, /@keyframes twinkle/);
  // каскад: заголовок → лид → карточка → схема (узлы позже текста)
  assert.match(html, /\.kicker \{[^}]*animation:[^}]*rise-in/s);
  assert.match(html, /h1 \{[^}]*animation:[^}]*rise-in/s);
  assert.match(html, /\.lead \{[^}]*animation:[^}]*rise-in/s);
  assert.match(html, /\.diagram-panel \{[^}]*animation:[^}]*panel-in/s);
  // stagger узлов через --i
  assert.match(html, /class="dg-link" style="--i:0/);
  assert.match(html, /class="dg-node[^"]*" style="--i:2/);
  assert.match(html, /calc\([\d.]+s \+ var\(--i\) \* [\d.]+s\)/);
  // прорисовка линий через stroke-dashoffset
  assert.match(html, /stroke-dasharray/);
  // финальное состояние — база: все анимации backwards
  assert.match(html, /animation-fill-mode: backwards|backwards\b/);
  // пауза по виртуальному времени из #t=
  assert.match(html, /location\.hash/);
  assert.match(html, /getAnimations\(\{ subtree: true \}\)/);
  assert.match(html, /animation\.pause\(\)/);
});

test("disabling animation yields exactly the same final frame markup", () => {
  const animated = buildSceneMarkup({ ...baseInput });
  const still = buildSceneMarkup({ ...baseInput, animated: false });
  const disableRule = "* { animation: none !important; }";

  assert.ok(still.includes(disableRule));
  assert.ok(!animated.includes(disableRule));
  assert.equal(animated, still.replace(`\n  ${disableRule}`, ""));
});
