/**
 * Тесты Hermest Animation Engine v3.
 * Запуск: node --test test/unit/timeline.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert";

import { parseEasing, sampleEasing, isCssCubicBezier } from "../../src/animation/easing.js";
import { evaluateTimeline, validateTimeline, SUPPORTED_PROPERTIES, clamp } from "../../src/animation/timeline.js";
import { composeSceneTimeline } from "../../src/animation/director.js";
import { compileTimelineCss, sampleTrack } from "../../src/animation/css-compiler.js";
import { seededRandom } from "../../src/animation/random.js";
import { getPreset, PRESETS } from "../../src/animation/presets.js";
import { THEME } from "../../src/animation/theme.js";

function makeBasicTimeline(overrides = {}) {
  return {
    version: 1,
    durationMs: 10000,
    fps: 60,
    width: 1920,
    height: 1080,
    seed: 42,
    style: "keynote",
    scenes: [
      {
        id: "scene-001",
        startMs: 0,
        durationMs: 10000,
        role: "body",
        transitionIn: { kind: "none", durationMs: 0 },
        transitionOut: { kind: "none", durationMs: 0 },
        camera: null,
        layers: [
          {
            id: "headline",
            depth: 1.0,
            tracks: [
              {
                property: "opacity",
                keys: [
                  { tMs: 0, value: 0 },
                  { tMs: 600, value: 1, easing: "outQuint" }
                ]
              },
              {
                property: "translateY",
                keys: [
                  { tMs: 0, value: 26 },
                  { tMs: 600, value: 0, easing: "outQuint" }
                ]
              }
            ]
          }
        ]
      }
    ],
    beats: [],
    ...overrides
  };
}

// ═══════════════════════════════════════════════════════
// 1. Детерминизм
// ═══════════════════════════════════════════════════════
describe("determinism", () => {
  it("даёт одинаковые значения при произвольном порядке запросов", () => {
    const timeline = makeBasicTimeline();
    Object.freeze(timeline);

    const ordered = [];
    for (let t = 0; t <= 10000; t += 100) {
      ordered.push(evaluateTimeline(timeline, t));
    }

    const shuffledTimes = [];
    for (let t = 0; t <= 10000; t += 100) shuffledTimes.push(t);
    const rng = seededRandom(123);
    for (let i = shuffledTimes.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffledTimes[i], shuffledTimes[j]] = [shuffledTimes[j], shuffledTimes[i]];
    }

    const shuffled = shuffledTimes.map(t => evaluateTimeline(timeline, t));
    const orderedMap = new Map(ordered.map(f => [f.timeMs, f]));
    for (const frame of shuffled) {
      const expected = orderedMap.get(frame.timeMs);
      assert.ok(expected);
      assert.deepStrictEqual(frame.layers, expected.layers);
    }
  });

  it("не меняет входной таймлайн", () => {
    const timeline = makeBasicTimeline();
    Object.freeze(timeline);
    Object.freeze(timeline.scenes);
    Object.freeze(timeline.scenes[0]);
    Object.freeze(timeline.scenes[0].layers);
    Object.freeze(timeline.scenes[0].layers[0]);
    timeline.scenes[0].layers[0].tracks.forEach(t => {
      Object.freeze(t);
      Object.freeze(t.keys);
      t.keys.forEach(k => Object.freeze(k));
    });

    assert.doesNotThrow(() => {
      evaluateTimeline(timeline, 500);
      evaluateTimeline(timeline, 3000);
      evaluateTimeline(timeline, 0);
    });
  });

  it("одинаковый seed даёт одинаковый результат в режиссёре", () => {
    const intent = {
      id: "test-scene",
      role: "body",
      durationMs: 5000,
      elements: [
        { id: "h1", kind: "headline", text: "Test" },
        { id: "p1", kind: "lead", text: "Lead" }
      ],
      camera: { move: "push-in" }
    };
    const layout = { width: 1920, height: 1080 };
    const tl1 = composeSceneTimeline({ intent, styleName: "motion", layout, seed: 42, beats: [] });
    const tl2 = composeSceneTimeline({ intent, styleName: "motion", layout, seed: 42, beats: [] });
    assert.deepStrictEqual(tl1.scenes[0].layers, tl2.scenes[0].layers);
  });

  it("разный seed даёт разный результат в режиссёре", () => {
    const intent = {
      id: "test-scene",
      role: "body",
      durationMs: 5000,
      elements: [{ id: "h1", kind: "headline", text: "Test" }],
      camera: { move: "push-in" }
    };
    const layout = { width: 1920, height: 1080 };
    const tl1 = composeSceneTimeline({ intent, styleName: "motion", layout, seed: 42, beats: [] });
    const tl2 = composeSceneTimeline({ intent, styleName: "motion", layout, seed: 99, beats: [] });
    const track1 = tl1.scenes[0].layers[0].tracks.find(t => t.property === "translateY");
    const track2 = tl2.scenes[0].layers[0].tracks.find(t => t.property === "translateY");
    assert.notDeepStrictEqual(track1.keys[0].value, track2.keys[0].value);
  });
});

// ═══════════════════════════════════════════════════════
// 2. Границы и критические случаи
// ═══════════════════════════════════════════════════════
describe("boundaries", () => {
  it("t = 0 даёт начальные значения", () => {
    const frame = evaluateTimeline(makeBasicTimeline(), 0);
    assert.strictEqual(frame.sceneId, "scene-001");
    assert.strictEqual(frame.layers.headline.opacity, "0.000000");
  });

  it("t = durationMs даёт конечные значения", () => {
    const frame = evaluateTimeline(makeBasicTimeline(), 10000);
    assert.strictEqual(frame.layers.headline.opacity, "1.000000");
  });

  it("t < 0 зажимается к 0", () => {
    const frame = evaluateTimeline(makeBasicTimeline(), -100);
    assert.strictEqual(frame.timeMs, 0);
    assert.strictEqual(frame.layers.headline.opacity, "0.000000");
  });

  it("t > durationMs зажимается к durationMs", () => {
    const frame = evaluateTimeline(makeBasicTimeline(), 99999);
    assert.strictEqual(frame.timeMs, 10000);
    assert.strictEqual(frame.layers.headline.opacity, "1.000000");
  });

  it("два ключа с одинаковым tMs в начале — используется последний", () => {
    const timeline = makeBasicTimeline({
      scenes: [
        {
          id: "scene-001",
          startMs: 0,
          durationMs: 10000,
          role: "body",
          transitionIn: { kind: "none", durationMs: 0 },
          transitionOut: { kind: "none", durationMs: 0 },
          camera: null,
          layers: [
            {
              id: "test",
              depth: 1,
              tracks: [
                {
                  property: "opacity",
                  keys: [
                    { tMs: 0, value: 0.11 },
                    { tMs: 0, value: 0.99 },
                    { tMs: 1000, value: 1, easing: "linear" }
                  ]
                }
              ]
            }
          ]
        }
      ]
    });
    const frame = evaluateTimeline(timeline, 0);
    assert.strictEqual(frame.layers.test.opacity, "0.990000");
  });

  it("два ключа с одинаковым tMs в конце — используется последний", () => {
    const timeline = makeBasicTimeline({
      scenes: [
        {
          id: "scene-001",
          startMs: 0,
          durationMs: 10000,
          role: "body",
          transitionIn: { kind: "none", durationMs: 0 },
          transitionOut: { kind: "none", durationMs: 0 },
          camera: null,
          layers: [
            {
              id: "test",
              depth: 1,
              tracks: [
                {
                  property: "opacity",
                  keys: [
                    { tMs: 0, value: 0 },
                    { tMs: 1000, value: 0.5 },
                    { tMs: 1000, value: 0.9 }
                  ]
                }
              ]
            }
          ]
        }
      ]
    });
    const frame = evaluateTimeline(timeline, 1000);
    assert.strictEqual(frame.layers.test.opacity, "0.900000");
  });
});

// ═══════════════════════════════════════════════════════
// 3. Easing
// ═══════════════════════════════════════════════════════
describe("easing", () => {
  it("linear даёт t", () => {
    const fn = parseEasing("linear");
    assert.strictEqual(fn(0), 0);
    assert.strictEqual(fn(0.5), 0.5);
    assert.strictEqual(fn(1), 1);
  });

  it("outQuint при t=0.5 даёт значение > 0.5", () => {
    const fn = parseEasing("outQuint");
    assert.ok(fn(0.5) > 0.5);
  });

  it("cubic-bezier парсится и работает", () => {
    const fn = parseEasing("cubic-bezier(0.25, 0.35, 0.4, 1)");
    assert.strictEqual(fn(0), 0);
    assert.ok(fn(0.5) > 0);
    assert.strictEqual(fn(1), 1);
  });

  it("cubic-bezier с x вне [0,1] бросает RangeError", () => {
    assert.throws(() => parseEasing("cubic-bezier(-0.1, 0, 0.5, 1)"), RangeError);
    assert.throws(() => parseEasing("cubic-bezier(0, 0, 1.1, 1)"), RangeError);
  });

  it("неизвестный easing бросает RangeError", () => {
    assert.throws(() => parseEasing("magicEase"), RangeError);
  });

  it("sampleEasing возвращает не менее 51 точки, адаптивно до 257", () => {
    assert.ok(sampleEasing("linear").length >= 51);
    assert.ok(sampleEasing("outBack").length >= 51);
    assert.ok(sampleEasing("outElastic").length >= 51);
    assert.ok(sampleEasing("outElastic").length <= 513);
  });

  it("isCssCubicBezier true только для literal cubic-bezier и linear", () => {
    assert.strictEqual(isCssCubicBezier("linear"), true);
    assert.strictEqual(isCssCubicBezier("cubic-bezier(0,0,1,1)"), true);
    assert.strictEqual(isCssCubicBezier("outQuint"), false);
    assert.strictEqual(isCssCubicBezier("outBack"), false);
    assert.strictEqual(isCssCubicBezier("outElastic"), false);
  });
});

// ═══════════════════════════════════════════════════════
// 4. Loop / Repeat / Pingpong
// ═══════════════════════════════════════════════════════
describe("repeat", () => {
  it("loop повторяет трек", () => {
    const timeline = makeBasicTimeline({
      scenes: [
        {
          id: "scene-001",
          startMs: 0,
          durationMs: 10000,
          role: "body",
          transitionIn: { kind: "none", durationMs: 0 },
          transitionOut: { kind: "none", durationMs: 0 },
          camera: null,
          layers: [
            {
              id: "pulse",
              depth: 1,
              tracks: [
                {
                  property: "opacity",
                  repeat: "loop",
                  phaseMs: 0,
                  keys: [
                    { tMs: 0, value: 1 },
                    { tMs: 500, value: 0.5, easing: "inOutQuad" },
                    { tMs: 1000, value: 1, easing: "inOutQuad" }
                  ]
                }
              ]
            }
          ]
        }
      ]
    });

    assert.strictEqual(evaluateTimeline(timeline, 0).layers.pulse.opacity, "1.000000");
    assert.strictEqual(evaluateTimeline(timeline, 500).layers.pulse.opacity, "0.500000");
    assert.strictEqual(evaluateTimeline(timeline, 1000).layers.pulse.opacity, "1.000000");
    assert.strictEqual(evaluateTimeline(timeline, 1500).layers.pulse.opacity, "0.500000");
    assert.strictEqual(evaluateTimeline(timeline, 2500).layers.pulse.opacity, "0.500000");
  });

  it("pingpong непрерывен и проходит весь диапазон", () => {
    const timeline = makeBasicTimeline({
      scenes: [
        {
          id: "scene-001",
          startMs: 0,
          durationMs: 10000,
          role: "body",
          transitionIn: { kind: "none", durationMs: 0 },
          transitionOut: { kind: "none", durationMs: 0 },
          camera: null,
          layers: [
            {
              id: "ping",
              depth: 1,
              tracks: [
                {
                  property: "opacity",
                  repeat: "pingpong",
                  keys: [
                    { tMs: 0, value: 0 },
                    { tMs: 1000, value: 1, easing: "linear" }
                  ]
                }
              ]
            }
          ]
        }
      ]
    });

    let prev = 0;
    for (let t = 0; t <= 2000; t += 1) {
      const opacity = parseFloat(evaluateTimeline(timeline, t).layers.ping.opacity);
      assert.ok(opacity >= -0.001 && opacity <= 1.001, `opacity ${opacity} at ${t}`);
      assert.ok(Math.abs(opacity - prev) <= 0.02, `jump ${Math.abs(opacity - prev)} at ${t}`);
      prev = opacity;
    }

    assert.strictEqual(evaluateTimeline(timeline, 0).layers.ping.opacity, "0.000000");
    assert.strictEqual(evaluateTimeline(timeline, 500).layers.ping.opacity, "1.000000");
    assert.strictEqual(evaluateTimeline(timeline, 1000).layers.ping.opacity, "0.000000");
    assert.strictEqual(evaluateTimeline(timeline, 1500).layers.ping.opacity, "1.000000");
  });
});

// ═══════════════════════════════════════════════════════
// 5. Валидация таймлайна
// ═══════════════════════════════════════════════════════
describe("validation", () => {
  it("неизвестное свойство бросает RangeError", () => {
    const timeline = makeBasicTimeline({
      scenes: [
        {
          id: "scene-001",
          startMs: 0,
          durationMs: 10000,
          role: "body",
          transitionIn: { kind: "none", durationMs: 0 },
          transitionOut: { kind: "none", durationMs: 0 },
          camera: null,
          layers: [
            {
              id: "bad",
              depth: 1,
              tracks: [{ property: "translatY", keys: [{ tMs: 0, value: 0 }] }]
            }
          ]
        }
      ]
    });
    assert.throws(() => evaluateTimeline(timeline, 0), RangeError);
  });

  it("unit !== px бросает RangeError", () => {
    const timeline = makeBasicTimeline({
      scenes: [
        {
          id: "scene-001",
          startMs: 0,
          durationMs: 10000,
          role: "body",
          transitionIn: { kind: "none", durationMs: 0 },
          transitionOut: { kind: "none", durationMs: 0 },
          camera: null,
          layers: [
            {
              id: "bad",
              depth: 1,
              tracks: [
                {
                  property: "translateX",
                  keys: [
                    { tMs: 0, value: 0, unit: "%" },
                    { tMs: 500, value: 50, unit: "%" }
                  ]
                }
              ]
            }
          ]
        }
      ]
    });
    assert.throws(() => evaluateTimeline(timeline, 250), RangeError);
  });

  it("дырка между сценами бросает RangeError", () => {
    const timeline = makeBasicTimeline({
      durationMs: 3000,
      scenes: [
        {
          id: "s1",
          startMs: 0,
          durationMs: 1000,
          role: "body",
          transitionIn: { kind: "none", durationMs: 0 },
          transitionOut: { kind: "none", durationMs: 0 },
          camera: null,
          layers: []
        }
      ]
    });
    assert.throws(() => evaluateTimeline(timeline, 2000), RangeError);
  });

  it("validateTimeline возвращает true на корректном таймлайне", () => {
    assert.strictEqual(validateTimeline(makeBasicTimeline()), true);
  });
});

// ═══════════════════════════════════════════════════════
// 6. Эквивалентность seek и CSS
// ═══════════════════════════════════════════════════════
describe("css equivalence", () => {
  function extractSeekValue(frame, layerId, prop) {
    const styles = frame.layers[layerId];
    if (!styles) return null;
    if (prop === "opacity") return parseFloat(styles.opacity);
    if (prop === "translateX") {
      const m = styles.transform && styles.transform.match(/translate3d\(([^,]+)px/);
      return m ? parseFloat(m[1]) : null;
    }
    return null;
  }

  function cssValueAtSampledTrack(track, sceneDurationMs, tMs, prop) {
    const sampled = sampleTrack(track, sceneDurationMs);
    if (!sampled) return null;
    const stops = sampled.stops;
    if (stops.length === 0) return null;
    const pct = (tMs / sceneDurationMs) * 100;
    if (pct <= stops[0].pct) return stops[0].values[prop];
    if (pct >= stops[stops.length - 1].pct) return stops[stops.length - 1].values[prop];
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i];
      const b = stops[i + 1];
      if (pct >= a.pct && pct <= b.pct) {
        const r = b.pct === a.pct ? 0 : (pct - a.pct) / (b.pct - a.pct);
        return a.values[prop] + (b.values[prop] - a.values[prop]) * r;
      }
    }
    return stops[stops.length - 1].values[prop];
  }

  function evaluateTrackAt(track, tMs) {
    // Simple seek-like evaluation for a track without repeat.
    const keys = track.keys;
    if (keys.length === 0) return null;
    if (keys.length === 1) return keys[0].value;
    if (tMs <= keys[0].tMs) return keys[0].value;
    if (tMs >= keys[keys.length - 1].tMs) return keys[keys.length - 1].value;
    let lo = 0, hi = keys.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >>> 1;
      if (keys[mid].tMs <= tMs) lo = mid;
      else hi = mid;
    }
    const span = keys[hi].tMs - keys[lo].tMs;
    const r = span === 0 ? 0 : (tMs - keys[lo].tMs) / span;
    const fn = parseEasing(keys[hi].easing || "linear");
    return keys[lo].value + (keys[hi].value - keys[lo].value) * fn(r);
  }

  it("хвост трека верен для 2, 3, 5 и 8 ключей", () => {
    for (const count of [2, 3, 5, 8]) {
      const keys = [{ tMs: 0, value: 0 }];
      for (let i = 1; i < count - 1; i++) {
        keys.push({ tMs: i * 100, value: i * 0.1, easing: "linear" });
      }
      keys.push({ tMs: (count - 1) * 100, value: 0.99, easing: "linear" });

      const timeline = makeBasicTimeline({
        durationMs: (count - 1) * 100,
        scenes: [
          {
            id: "scene-001",
            startMs: 0,
            durationMs: (count - 1) * 100,
            role: "body",
            transitionIn: { kind: "none", durationMs: 0 },
            transitionOut: { kind: "none", durationMs: 0 },
            camera: null,
            layers: [
              {
                id: "tail",
                depth: 1,
                tracks: [{ property: "opacity", keys }]
              }
            ]
          }
        ]
      });

      const lastT = (count - 1) * 100;
      const frameAtLast = evaluateTimeline(timeline, lastT);
      const frameAtEnd = evaluateTimeline(timeline, lastT + 50);
      assert.strictEqual(frameAtLast.layers.tail.opacity, "0.990000", `count=${count} at last key`);
      assert.strictEqual(frameAtEnd.layers.tail.opacity, "0.990000", `count=${count} after last key`);
    }
  });

  it("хвост трека верен при 3+ ключах с разными easing", () => {
    const timeline = makeBasicTimeline({
      durationMs: 1000,
      scenes: [
        {
          id: "scene-001",
          startMs: 0,
          durationMs: 1000,
          role: "body",
          transitionIn: { kind: "none", durationMs: 0 },
          transitionOut: { kind: "none", durationMs: 0 },
          camera: null,
          layers: [
            {
              id: "multi",
              depth: 1,
              tracks: [
                {
                  property: "opacity",
                  keys: [
                    { tMs: 0, value: 0 },
                    { tMs: 500, value: 1, easing: "outQuint" },
                    { tMs: 1000, value: 0.2, easing: "inOutCubic" }
                  ]
                }
              ]
            }
          ]
        }
      ]
    });
    assert.strictEqual(evaluateTimeline(timeline, 1000).layers.multi.opacity, "0.200000");
    assert.strictEqual(evaluateTimeline(timeline, 1200).layers.multi.opacity, "0.200000");
  });

  it("посегментная seek/CSS эквивалентность на треке с 3+ ключами", () => {
    const track = {
      property: "translateX",
      keys: [
        { tMs: 0, value: 0 },
        { tMs: 500, value: 80, easing: "outQuint" },
        { tMs: 1000, value: 20, easing: "inOutCubic" }
      ]
    };
    const sceneDurationMs = 1000;
    const sampled = sampleTrack(track, sceneDurationMs);

    assert.ok(sampled.stops.length >= 3, `multi-segment track has intermediate stops: ${sampled.stops.length}`);
    assert.ok(
      sampled.stops.some(s => Math.abs(s.pct - 50) < 0.1),
      "has stop near 50% (first segment end)"
    );

    const timeline = makeBasicTimeline({
      durationMs: sceneDurationMs,
      scenes: [
        {
          id: "scene-001",
          startMs: 0,
          durationMs: sceneDurationMs,
          role: "body",
          transitionIn: { kind: "none", durationMs: 0 },
          transitionOut: { kind: "none", durationMs: 0 },
          camera: null,
          layers: [
            { id: "seg", depth: 1, tracks: [track] }
          ]
        }
      ]
    });

    let maxErrorPct = 0;
    let worst = null;
    for (let t = 0; t <= sceneDurationMs; t += 5) {
      const seekVal = extractSeekValue(evaluateTimeline(timeline, t), "seg", "translateX");
      const cssVal = cssValueAtSampledTrack(track, sceneDurationMs, t, "translateX");
      if (seekVal === null || cssVal === null) continue;
      const denom = Math.max(Math.abs(seekVal), Math.abs(cssVal), 5);
      const err = Math.abs(seekVal - cssVal) / denom * 100;
      if (err > maxErrorPct) {
        maxErrorPct = err;
        worst = { t, seekVal, cssVal, err };
      }
    }
    assert.ok(
      maxErrorPct <= 0.5,
      `multi-segment seek/CSS error ${maxErrorPct.toFixed(4)}% exceeds 0.5%, worst: ${JSON.stringify(worst)}`
    );
  });

  it("CSS-период repeat совпадает с периодом ядра", () => {
    const baseTrack = (repeat, segmentMs) => ({
      property: "rotate",
      repeat,
      phaseMs: 0,
      keys: [
        { tMs: 0, value: 0 },
        { tMs: segmentMs, value: 360, easing: "linear" }
      ]
    });

    const sceneDurationMs = 1000;

    // none: CSS duration = scene duration
    const sampledNone = sampleTrack(baseTrack("none", 250), sceneDurationMs);
    assert.strictEqual(sampledNone.cycleLenMs, 250);

    // loop: CSS duration = cycleLen
    const sampledLoop = sampleTrack(baseTrack("loop", 250), sceneDurationMs);
    assert.strictEqual(sampledLoop.cycleLenMs, 250);

    // pingpong: CSS animation-duration = cycleLen / 2 because alternate doubles it
    const sampledPing = sampleTrack(baseTrack("pingpong", 250), sceneDurationMs);
    assert.strictEqual(sampledPing.cycleLenMs, 250);
  });

  it("все @keyframes стопы лежат в [0, 100] %", () => {
    const layout = { width: 1920, height: 1080 };
    const intent = {
      id: "pct-bounds",
      role: "body",
      durationMs: 5000,
      elements: [
        { id: "h1", kind: "headline", text: "Hello" },
        { id: "lead", kind: "lead", text: "World" },
        { id: "kicker", kind: "kicker", text: "Top" },
        { id: "num", kind: "number", from: 0, to: 100, suffix: "%" },
        { id: "panel", kind: "panel" }
      ],
      camera: { move: "push-in" }
    };

    for (const styleName of ["keynote", "motion", "cinematic"]) {
      const tl = composeSceneTimeline({ intent, styleName, layout, seed: 42, beats: [] });
      const css = compileTimelineCss(tl);
      const keyframeBlocks = css.match(/@keyframes\s+[^{]+\{[^}]*\}/g) || [];
      const bad = [];
      for (const block of keyframeBlocks) {
        const percentages = [...block.matchAll(/(\d+(?:\.\d+)?)%/g)].map(m => parseFloat(m[1]));
        for (const pct of percentages) {
          if (pct < 0 || pct > 100) {
            bad.push({ styleName, pct, snippet: block.slice(0, 120).replace(/\s+/g, " ") });
          }
        }
      }
      assert.strictEqual(bad.length, 0, `${styleName}: stops outside [0,100]: ${JSON.stringify(bad.slice(0, 5))}`);
    }
  });

  it("opacity стопы @keyframes не выходят за [0, 1] для всех пресетов", () => {
    const layout = { width: 1920, height: 1080 };
    const intent = {
      id: "opacity-bounds",
      role: "body",
      durationMs: 5000,
      elements: [
        { id: "h1", kind: "headline", text: "Hello" },
        { id: "lead", kind: "lead", text: "World" },
        { id: "kicker", kind: "kicker", text: "Top" },
        { id: "num", kind: "number", from: 0, to: 100, suffix: "%" },
        { id: "panel", kind: "panel" }
      ],
      camera: { move: "push-in" }
    };

    for (const styleName of ["keynote", "motion", "cinematic"]) {
      const tl = composeSceneTimeline({ intent, styleName, layout, seed: 42, beats: [] });
      const css = compileTimelineCss(tl);
      const opacityMatches = [...css.matchAll(/opacity:\s*([\d.]+)/g)];
      const bad = [];
      for (const m of opacityMatches) {
        const value = parseFloat(m[1]);
        if (value < 0 || value > 1) {
          bad.push({ styleName, value, snippet: m[0] });
        }
      }
      assert.strictEqual(bad.length, 0, `${styleName}: opacity stops outside [0,1]: ${JSON.stringify(bad.slice(0, 5))}`);
    }
  });

  it("phaseMs loop/pingpong эквивалентность seek ↔ CSS в пределах 0.5%", () => {
    function evaluateTrackAtTime(track, tMs) {
      const repeat = track.repeat || "none";
      const keys = track.keys;
      if (!keys || keys.length === 0) return null;
      const firstT = keys[0].tMs;
      const lastT = keys[keys.length - 1].tMs;
      const cycleLen = Math.max(1, lastT - firstT);
      const phaseMs = track.phaseMs || 0;
      let offset = ((tMs - firstT - phaseMs) % cycleLen + cycleLen) % cycleLen;
      let localMs = firstT + offset;
      if (repeat === "pingpong") {
        const half = cycleLen / 2;
        const forward = offset < half;
        const phase = forward
          ? offset / half
          : (offset - half) / half;
        localMs = forward
          ? firstT + phase * cycleLen
          : lastT - phase * cycleLen;
        localMs = Math.max(firstT, Math.min(lastT, localMs));
      }

      if (localMs <= firstT) return keys[0].value;
      if (localMs >= lastT) return keys[keys.length - 1].value;
      let lo = 0, hi = keys.length - 1;
      while (lo < hi - 1) {
        const mid = (lo + hi) >>> 1;
        if (keys[mid].tMs <= localMs) lo = mid;
        else hi = mid;
      }
      const span = keys[hi].tMs - keys[lo].tMs;
      const r = span === 0 ? 0 : (localMs - keys[lo].tMs) / span;
      const fn = parseEasing(keys[hi].easing || "linear");
      return keys[lo].value + (keys[hi].value - keys[lo].value) * fn(r);
    }

    function cssValueAtTrack(track, sceneDurationMs, tMs) {
      const sampled = sampleTrack(track, sceneDurationMs);
      if (!sampled) return null;
      const repeat = track.repeat || "none";
      const keys = track.keys;
      const firstT = keys[0].tMs;
      const lastT = keys[keys.length - 1].tMs;
      const cycleLen = Math.max(1, lastT - firstT);
      const phaseMs = track.phaseMs || 0;
      const half = cycleLen / 2;

      let localPct;
      if (repeat === "none") {
        if (tMs <= firstT) localPct = 0;
        else if (tMs >= lastT) localPct = 100;
        else localPct = ((tMs - firstT) / cycleLen) * 100;
      } else if (repeat === "loop") {
        const offset = mod(tMs - firstT - phaseMs, cycleLen);
        localPct = (offset / cycleLen) * 100;
      } else if (repeat === "pingpong") {
        const offset = mod(tMs - firstT - phaseMs, cycleLen);
        if (offset <= half) {
          localPct = (offset / half) * 100;
        } else {
          localPct = ((cycleLen - offset) / half) * 100;
        }
      } else {
        localPct = (tMs / sceneDurationMs) * 100;
      }

      const stops = sampled.stops;
      if (localPct <= stops[0].pct) return stops[0].values[track.property];
      if (localPct >= stops[stops.length - 1].pct) return stops[stops.length - 1].values[track.property];
      for (let i = 0; i < stops.length - 1; i++) {
        const a = stops[i];
        const b = stops[i + 1];
        if (localPct >= a.pct && localPct <= b.pct) {
          const r = b.pct === a.pct ? 0 : (localPct - a.pct) / (b.pct - a.pct);
          return a.values[track.property] + (b.values[track.property] - a.values[track.property]) * r;
        }
      }
      return stops[stops.length - 1].values[track.property];
    }

    function mod(a, b) {
      return ((a % b) + b) % b;
    }

    const sceneDurationMs = 2000;
    const cycleLen = 1000;
    const phaseSet = [0, 250, 500, cycleLen, cycleLen + 100];
    const easings = ["linear", "inOutCubic"];

    let maxErrPct = 0;
    let worst = null;

    for (const repeat of ["loop", "pingpong"]) {
      for (const phaseMs of phaseSet) {
        for (const ease of easings) {
          const track = {
            property: "opacity",
            repeat,
            phaseMs,
            keys: [
              { tMs: 0, value: 0 },
              { tMs: cycleLen / 2, value: 0.7, easing: ease },
              { tMs: cycleLen, value: 1, easing: ease }
            ]
          };

          for (let t = 0; t <= sceneDurationMs; t += 10) {
            const seekVal = evaluateTrackAtTime(track, t);
            const cssVal = cssValueAtTrack(track, sceneDurationMs, t);
            const denom = Math.max(Math.abs(seekVal), Math.abs(cssVal), 1);
            const err = Math.abs(seekVal - cssVal) / denom * 100;
            if (err > maxErrPct) {
              maxErrPct = err;
              worst = { repeat, phaseMs, ease, t, seekVal, cssVal, err };
            }
          }
        }
      }
    }

    assert.ok(
      maxErrPct <= 0.5,
      `phaseMs seek/CSS error ${maxErrPct.toFixed(4)}% exceeds 0.5%, worst: ${JSON.stringify(worst)}`
    );
  });

  it("CSS не содержит внешних ссылок для всех пресетов", () => {
    const layout = { width: 1920, height: 1080 };
    const intent = {
      id: "css-test",
      role: "body",
      durationMs: 3000,
      elements: [
        { id: "h1", kind: "headline", text: "Hello" },
        { id: "num", kind: "number", from: 0, to: 100, suffix: "%" }
      ],
      camera: { move: "drift-left" }
    };

    for (const styleName of ["keynote", "motion", "cinematic"]) {
      const tl = composeSceneTimeline({ intent, styleName, layout, seed: 42, beats: [] });
      const css = compileTimelineCss(tl);
      assert.ok(!css.includes("url("), `no url( for ${styleName}`);
      assert.ok(!css.includes("@import"), `no @import for ${styleName}`);
      assert.ok(!css.includes("//"), `no protocol-relative URL for ${styleName}`);
      assert.ok(css.includes("@keyframes"), `keyframes for ${styleName}`);
      assert.ok(css.includes("animation:"), `animation rules for ${styleName}`);
    }
  });

  it("объём CSS и число стопов ограничены для сцены с 8 элементами", () => {
    const layout = { width: 1920, height: 1080 };
    const elements = [
      { id: "h1", kind: "headline", text: "One" },
      { id: "lead", kind: "lead", text: "Two" },
      { id: "kicker", kind: "kicker", text: "Three" },
      { id: "b1", kind: "body", text: "Four" },
      { id: "b2", kind: "body", text: "Five" },
      { id: "num", kind: "number", from: 0, to: 100, suffix: "%" },
      { id: "panel", kind: "panel" },
      { id: "caption", kind: "caption", text: "Eight" }
    ];
    const intent = { id: "size-test", role: "body", durationMs: 5000, elements, camera: { move: "push-in" } };
    const tl = composeSceneTimeline({ intent, styleName: "motion", layout, seed: 42, beats: [] });
    const css = compileTimelineCss(tl);

    const blocks = css.match(/@keyframes\s+[^{]+\{[\s\S]*?\n\s*\}/g) || [];
    let totalStops = 0;
    for (const block of blocks) {
      totalStops += (block.match(/([0-9]+(?:\.[0-9]+)?)%/g) || []).length;
    }

    const sizeBytes = Buffer.byteLength(css, "utf8");
    console.log(`size-test: blocks=${blocks.length} stops=${totalStops} size=${sizeBytes} bytes`);

    assert.ok(totalStops < 5000, `too many CSS stops: ${totalStops}`);
    assert.ok(sizeBytes < 500 * 1024, `CSS too large: ${sizeBytes} bytes`);
  });

  it("ИРИС: seek/CSS эквивалентность на сетке 10 мс и объём CSS для 1/4/8 элементов", () => {
    function parseTransformString(tf) {
      if (!tf || tf === "none") return { tx: 0, ty: 0, rot: 0, scale: 1 };
      const txm = tf.match(/translate3d\(([^,]+)px,\s*([^,]+)px/);
      const rotm = tf.match(/rotate\(([^)]+)deg\)/);
      const scm = tf.match(/scale\(([^)]+)\)/);
      return {
        tx: txm ? parseFloat(txm[1]) : 0,
        ty: txm ? parseFloat(txm[2]) : 0,
        rot: rotm ? parseFloat(rotm[1]) : 0,
        scale: scm ? parseFloat(scm[1]) : 1
      };
    }

    function extractRule(css, selector) {
      const re = new RegExp(`${selector.replace(/\./g, "\\.")}\\s*\\{([^}]*)\\}`, "g");
      const matches = [...css.matchAll(re)];
      return matches.length ? matches[matches.length - 1][1] : null;
    }

    function extractKeyframes(css, name) {
      const re = new RegExp(`@keyframes\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`, "g");
      const m = re.exec(css);
      if (!m) return null;
      const stops = [];
      const stopRe = /([0-9]+(?:\\.[0-9]+)?)%\\s*\\{([^}]*)\}/g;
      let sm;
      while ((sm = stopRe.exec(m[1])) !== null) {
        stops.push({ pct: parseFloat(sm[1]), body: sm[2].trim() });
      }
      return stops.sort((a, b) => a.pct - b.pct);
    }

    function parseAnimationShorthand(decl) {
      const parts = decl.trim().split(/\s+/);
      const name = parts[parts.length - 1];
      const durationSec = parseFloat(parts[0]);
      let delaySec = 0;
      let easing = "linear";
      for (let i = 2; i < parts.length - 1; i++) {
        if (/^[+-]?\d+\.?\d*s$/.test(parts[i])) {
          delaySec = parseFloat(parts[i]);
        } else if (/^[a-z-]+$/.test(parts[i]) && !/^(normal|reverse|alternate|infinite|\d+)$/.test(parts[i])) {
          easing = parts[i];
        }
      }
      let iteration = "1";
      let direction = "normal";
      for (let i = 2; i < parts.length - 1; i++) {
        if (/^\d+$/.test(parts[i]) || parts[i] === "infinite") iteration = parts[i];
        if (["normal", "reverse", "alternate", "alternate-reverse"].includes(parts[i])) direction = parts[i];
      }
      return { name, durationSec, delaySec, iteration, direction, easing };
    }

    function mod(a, b) {
      return ((a % b) + b) % b;
    }

    function normalizeCssPct(pct, iteration, direction) {
      const inf = iteration === "infinite";
      const n = inf ? Infinity : Math.max(1, parseInt(iteration, 10) || 1);
      if (!inf && n <= 1) return Math.max(0, Math.min(100, pct));
      if (direction === "alternate" || direction === "alternate-reverse") {
        const phase = mod(pct, 200);
        return phase <= 100 ? phase : 200 - phase;
      }
      return mod(pct, 100);
    }

    function getLastAnimationPerCssProp(css, layerId) {
      const ruleBody = extractRule(css, `.layer-${layerId}`);
      if (!ruleBody) return {};
      const animMatches = [...ruleBody.matchAll(/animation:\s*([^;]+);?/g)];
      if (animMatches.length === 0) return {};
      const lastDecl = animMatches[animMatches.length - 1][1];
      const items = lastDecl.split(",").map(s => s.trim()).filter(Boolean);
      const result = {};
      for (const item of items) {
        const { name, durationSec, delaySec, iteration, direction, easing } = parseAnimationShorthand(item);
        const stops = extractKeyframes(css, name);
        if (!stops) continue;
        const props = new Set();
        for (const s of stops) {
          if (s.body.includes("opacity")) props.add("opacity");
          if (s.body.includes("transform")) props.add("transform");
          if (s.body.includes("filter")) props.add("filter");
          if (s.body.includes("letter-spacing")) props.add("letter-spacing");
        }
        for (const p of props) result[p] = { name, stops, durationSec, delaySec, iteration, direction, easing };
      }
      return result;
    }

    function extractPropFromBody(body, prop) {
      if (prop === "opacity") {
        const m = body.match(/opacity:\s*([0-9.]+)/);
        return m ? parseFloat(m[1]) : null;
      }
      if (prop === "transform") {
        const m = body.match(/transform:\s*([^;]+)/);
        return m ? m[1].trim() : null;
      }
      return null;
    }

    function extractCssValueAt(stops, prop, tMs, durationSec, delaySec, iteration, direction) {
      const localMs = tMs - delaySec * 1000;
      let pct = durationSec > 0 ? (localMs / (durationSec * 1000)) * 100 : 0;
      pct = normalizeCssPct(pct, iteration, direction);
      if (stops.length === 0) return null;
      if (pct <= stops[0].pct) return extractPropFromBody(stops[0].body, prop);
      if (pct >= stops[stops.length - 1].pct) return extractPropFromBody(stops[stops.length - 1].body, prop);
      for (let i = 0; i < stops.length - 1; i++) {
        const a = stops[i], b = stops[i + 1];
        if (pct >= a.pct && pct <= b.pct) {
          const r = b.pct === a.pct ? 0 : (pct - a.pct) / (b.pct - a.pct);
          if (prop === "transform") {
            const aTf = parseTransformString(extractPropFromBody(a.body, prop));
            const bTf = parseTransformString(extractPropFromBody(b.body, prop));
            const tx = aTf.tx + (bTf.tx - aTf.tx) * r;
            const ty = aTf.ty + (bTf.ty - aTf.ty) * r;
            const rot = aTf.rot + (bTf.rot - aTf.rot) * r;
            const scale = aTf.scale + (bTf.scale - aTf.scale) * r;
            return `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) rotate(${rot.toFixed(2)}deg) scale(${scale.toFixed(4)})`;
          }
          const av = extractPropFromBody(a.body, prop);
          const bv = extractPropFromBody(b.body, prop);
          if (av === null || bv === null) return av ?? bv;
          return av + (bv - av) * r;
        }
      }
      return extractPropFromBody(stops[stops.length - 1].body, prop);
    }

    function measureCss(css) {
      const blocks = css.match(/@keyframes\s+[^{]+\{[\s\S]*?\n\s*\}/g) || [];
      let totalStops = 0;
      const pctRe = /([0-9]+(?:\.[0-9]+)?)%/g;
      for (const block of blocks) {
        totalStops += (block.match(pctRe) || []).length;
      }
      return { sizeBytes: Buffer.byteLength(css, "utf8"), totalStops, blocks: blocks.length };
    }

    const layouts = [
      { width: 1920, height: 1080 },
      { width: 1080, height: 1920 },
      { width: 1080, height: 1080 }
    ];
    const baseElements = [
      { id: "h1", kind: "headline", text: "Hello" },
      { id: "lead", kind: "lead", text: "World" },
      { id: "kicker", kind: "kicker", text: "Top" },
      { id: "num", kind: "number", from: 0, to: 100, suffix: "%" },
      { id: "panel", kind: "panel" },
      { id: "b1", kind: "body", text: "Six" },
      { id: "b2", kind: "body", text: "Seven" },
      { id: "caption", kind: "caption", text: "Eight" }
    ];

    let maxErrPct = 0;
    let worst = null;

    // Equivalence on all presets, layouts, layers, 10 ms grid.
    for (const layout of layouts) {
      for (const styleName of ["keynote", "motion", "cinematic"]) {
        const intent = {
          id: `iris-eq-${styleName}`,
          role: "body",
          durationMs: 5000,
          elements: baseElements.slice(0, 5),
          camera: { move: "push-in" },
          transitionIn: { kind: "dissolve", durationMs: 400 },
          transitionOut: { kind: "dissolve", durationMs: 400 }
        };

        const tl = composeSceneTimeline({ intent, styleName, layout, seed: 42, beats: [] });
        const css = compileTimelineCss(tl);
        const scene = tl.scenes[0];

        for (const layer of scene.layers) {
          if (layer.id === "__scene" || layer.id === "__camera") continue;
          const active = getLastAnimationPerCssProp(css, layer.id);
          if (Object.keys(active).length === 0) continue;

          const activeStart = scene.startMs + (scene.transitionIn?.durationMs || 0);
          const activeEnd = scene.startMs + scene.durationMs - (scene.transitionOut?.durationMs || 0);

          for (let t = activeStart; t < activeEnd; t += 10) {
            const seekFrame = evaluateTimeline(tl, t);
            const seekStyles = seekFrame.layers[layer.id];
            if (!seekStyles) continue;
            const seekTf = parseTransformString(seekStyles.transform);

            for (const [prop, { stops, durationSec, delaySec, iteration, direction }] of Object.entries(active)) {
              const cssVal = extractCssValueAt(stops, prop, t, durationSec, delaySec, iteration, direction);
              if (cssVal === null) continue;

              if (prop === "opacity") {
                const seekVal = parseFloat(seekStyles.opacity);
                const denom = Math.max(Math.abs(seekVal), Math.abs(cssVal), 1);
                const err = Math.abs(seekVal - cssVal) / denom * 100;
                if (err >= maxErrPct) {
                  maxErrPct = err;
                  worst = { styleName, layout: `${layout.width}x${layout.height}`, layerId: layer.id, prop, t, seekVal, cssVal, err };
                }
              } else if (prop === "transform") {
                const cssTf = parseTransformString(cssVal);
                const comps = [
                  { k: "tx", label: "translateX", floor: 5 },
                  { k: "ty", label: "translateY", floor: 5 },
                  { k: "rot", label: "rotate", floor: 5 },
                  { k: "scale", label: "scale", floor: 0.01 }
                ];
                for (const c of comps) {
                  const seekVal = seekTf[c.k];
                  const cssComp = cssTf[c.k];
                  const denom = Math.max(Math.abs(seekVal), Math.abs(cssComp), c.floor);
                  const err = Math.abs(seekVal - cssComp) / denom * 100;
                  if (err >= maxErrPct) {
                    maxErrPct = err;
                    worst = { styleName, layout: `${layout.width}x${layout.height}`, layerId: layer.id, prop: c.label, t, seekVal, cssComp, err };
                  }
                }
              }
            }
          }
        }
      }
    }

    console.log(`ИРИС equivalence: maxErrPct=${maxErrPct.toFixed(6)}% worst=${JSON.stringify(worst)}`);
    assert.ok(
      maxErrPct <= 0.5,
      `ИРИС: seek/CSS error ${maxErrPct.toFixed(6)}% exceeds 0.5%, worst: ${JSON.stringify(worst)}`
    );

    // Size for 1, 4, 8 elements.
    const sizeCounts = [];
    for (const count of [1, 4, 8]) {
      const intent = {
        id: `iris-size-${count}`,
        role: "body",
        durationMs: 5000,
        elements: baseElements.slice(0, count),
        camera: { move: "push-in" }
      };
      const tl = composeSceneTimeline({ intent, styleName: "motion", layout: { width: 1920, height: 1080 }, seed: 42, beats: [] });
      const css = compileTimelineCss(tl);
      const m = measureCss(css);
      sizeCounts.push({ count, ...m });
      console.log(`ИРИС size-${count}: blocks=${m.blocks} stops=${m.totalStops} size=${m.sizeBytes} bytes`);
    }

    const size8 = sizeCounts.find(s => s.count === 8);
    assert.ok(size8.totalStops < 5000, `ИРИС: too many stops for 8 elements: ${size8.totalStops}`);
    assert.ok(size8.sizeBytes < 500 * 1024, `ИРИС: CSS too large for 8 elements: ${size8.sizeBytes} bytes`);
  });

  it("CSS разрешается как в браузере: последнее animation на CSS-свойство", () => {
    const layouts = [
      { width: 1920, height: 1080 },
      { width: 1080, height: 1920 },
      { width: 1080, height: 1080 }
    ];

    const intent = {
      id: "browser-rule",
      role: "body",
      durationMs: 3000,
      elements: [
        { id: "h1", kind: "headline", text: "Hello" },
        { id: "lead", kind: "lead", text: "World" },
        { id: "kicker", kind: "kicker", text: "Top" },
        { id: "num", kind: "number", from: 0, to: 100, suffix: "%" },
        { id: "panel", kind: "panel" }
      ],
      camera: { move: "push-in" },
      transitionIn: { kind: "dissolve", durationMs: 400 },
      transitionOut: { kind: "dissolve", durationMs: 400 }
    };

    function extractRule(css, selector) {
      const re = new RegExp(`${selector.replace(/\./g, "\\.")}\\s*\\{([^}]*)\\}`, "g");
      const matches = [...css.matchAll(re)];
      return matches.length ? matches[matches.length - 1][1] : null;
    }

    function extractKeyframes(css, name) {
      const re = new RegExp(`@keyframes\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`, "g");
      const m = re.exec(css);
      if (!m) return null;
      const stops = [];
      const stopRe = /([0-9]+(?:\.[0-9]+)?)%\s*\{([^}]*)\}/g;
      let sm;
      while ((sm = stopRe.exec(m[1])) !== null) {
        stops.push({ pct: parseFloat(sm[1]), body: sm[2].trim() });
      }
      return stops.sort((a, b) => a.pct - b.pct);
    }

    function parseAnimationShorthand(decl) {
      // decl like "0.620s linear 0.147s 1 normal both kf-sc-h1"
      const parts = decl.trim().split(/\s+/);
      const name = parts[parts.length - 1];
      const durationSec = parseFloat(parts[0]);
      // delay is the third token (after duration and easing)
      let delaySec = 0;
      for (let i = 2; i < parts.length - 1; i++) {
        if (/^[+-]?\d+\.?\d*s$/.test(parts[i])) {
          delaySec = parseFloat(parts[i]);
          break;
        }
      }
      return { name, durationSec, delaySec };
    }

    function getLastAnimationPerCssProp(css, layerId) {
      const ruleBody = extractRule(css, `.layer-${layerId}`);
      if (!ruleBody) return {};
      const animMatches = [...ruleBody.matchAll(/animation:\s*([^;]+);?/g)];
      if (animMatches.length === 0) return {};
      // Browser resolves to the LAST animation declaration in the rule.
      const lastDecl = animMatches[animMatches.length - 1][1];
      const items = lastDecl.split(",").map(s => s.trim()).filter(Boolean);
      const result = {};
      for (const item of items) {
        const { name, durationSec, delaySec } = parseAnimationShorthand(item);
        const stops = extractKeyframes(css, name);
        if (!stops) continue;
        // Determine which CSS properties this keyframes block animates.
        const props = new Set();
        for (const s of stops) {
          if (s.body.includes("opacity")) props.add("opacity");
          if (s.body.includes("transform")) props.add("transform");
          if (s.body.includes("filter")) props.add("filter");
          if (s.body.includes("letter-spacing")) props.add("letter-spacing");
        }
        for (const p of props) result[p] = { name, stops, durationSec, delaySec };
      }
      return result;
    }

    function extractCssValueAt(stops, prop, tMs, durationSec, delaySec) {
      const localMs = tMs - delaySec * 1000;
      const pct = durationSec > 0 ? (localMs / (durationSec * 1000)) * 100 : 0;
      if (stops.length === 0) return null;
      if (pct <= stops[0].pct) return extractPropFromBody(stops[0].body, prop);
      if (pct >= stops[stops.length - 1].pct) return extractPropFromBody(stops[stops.length - 1].body, prop);
      for (let i = 0; i < stops.length - 1; i++) {
        const a = stops[i], b = stops[i + 1];
        if (pct >= a.pct && pct <= b.pct) {
          const r = b.pct === a.pct ? 0 : (pct - a.pct) / (b.pct - a.pct);
          if (prop === "transform") {
            const aTf = parseTransformString(extractPropFromBody(a.body, prop));
            const bTf = parseTransformString(extractPropFromBody(b.body, prop));
            const tx = aTf.tx + (bTf.tx - aTf.tx) * r;
            const ty = aTf.ty + (bTf.ty - aTf.ty) * r;
            const rot = aTf.rot + (bTf.rot - aTf.rot) * r;
            const scale = aTf.scale + (bTf.scale - aTf.scale) * r;
            return `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) rotate(${rot.toFixed(2)}deg) scale(${scale.toFixed(4)})`;
          }
          const av = extractPropFromBody(a.body, prop);
          const bv = extractPropFromBody(b.body, prop);
          if (av === null || bv === null) return av ?? bv;
          return av + (bv - av) * r;
        }
      }
      return extractPropFromBody(stops[stops.length - 1].body, prop);
    }

    function extractPropFromBody(body, prop) {
      if (prop === "opacity") {
        const m = body.match(/opacity:\s*([0-9.]+)/);
        return m ? parseFloat(m[1]) : null;
      }
      if (prop === "transform") {
        const m = body.match(/transform:\s*([^;]+)/);
        return m ? m[1].trim() : null;
      }
      return null;
    }

    function parseTransformString(tf) {
      if (!tf || tf === "none") return { tx: 0, ty: 0, rot: 0, scale: 1 };
      const txm = tf.match(/translate3d\(([^,]+)px,\s*([^,]+)px/);
      const rotm = tf.match(/rotate\(([^)]+)deg\)/);
      const scm = tf.match(/scale\(([^)]+)\)/);
      return {
        tx: txm ? parseFloat(txm[1]) : 0,
        ty: txm ? parseFloat(txm[2]) : 0,
        rot: rotm ? parseFloat(rotm[1]) : 0,
        scale: scm ? parseFloat(scm[1]) : 1
      };
    }

    let maxErrPct = 0;
    let worst = null;
    const step = 10;

    for (const layout of layouts) {
      for (const styleName of ["keynote", "motion", "cinematic"]) {
        const tl = composeSceneTimeline({ intent, styleName, layout, seed: 42, beats: [] });
        const css = compileTimelineCss(tl);
        const scene = tl.scenes[0];

        for (const layer of scene.layers) {
          if (layer.id === "__scene" || layer.id === "__camera") continue;
          const active = getLastAnimationPerCssProp(css, layer.id);
          if (Object.keys(active).length === 0) continue;

          const activeStart = scene.startMs + (scene.transitionIn?.durationMs || 0);
          const activeEnd = scene.startMs + scene.durationMs - (scene.transitionOut?.durationMs || 0);

          for (let t = activeStart; t < activeEnd; t += step) {
            const seekFrame = evaluateTimeline(tl, t);
            const seekStyles = seekFrame.layers[layer.id];
            if (!seekStyles) continue;

            const seekTf = parseTransformString(seekStyles.transform);

            for (const [prop, { stops, durationSec, delaySec, iteration, direction }] of Object.entries(active)) {
              const cssVal = extractCssValueAt(stops, prop, t, durationSec, delaySec, iteration, direction);
              if (cssVal === null) continue;

              if (prop === "opacity") {
                const seekVal = parseFloat(seekStyles.opacity);
                const denom = Math.max(Math.abs(seekVal), Math.abs(cssVal), 1);
                const err = Math.abs(seekVal - cssVal) / denom * 100;
                if (err > maxErrPct) {
                  maxErrPct = err;
                  worst = { styleName, layout: `${layout.width}x${layout.height}`, layerId: layer.id, prop, t, seekVal, cssVal, err };
                }
              } else if (prop === "transform") {
                const cssTf = parseTransformString(cssVal);
                const compRanges = { tx: layout.width, ty: layout.height, rot: 90, scale: 1 };
                const comps = ["tx", "ty", "rot", "scale"];
                for (const c of comps) {
                  const seekVal = seekTf[c];
                  const cssComp = cssTf[c];
                  const denom = Math.max(Math.abs(seekVal), Math.abs(cssComp), compRanges[c] * 0.1);
                  const err = Math.abs(seekVal - cssComp) / denom * 100;
                  if (err > maxErrPct) {
                    maxErrPct = err;
                    worst = { styleName, layout: `${layout.width}x${layout.height}`, layerId: layer.id, prop: `${c}(${c === "scale" ? "scale" : "translate"})`, t, seekVal, cssComp, err };
                  }
                }
              }
            }
          }
        }
      }
    }

    assert.ok(
      maxErrPct <= 0.5,
      `browser-rule CSS error ${maxErrPct.toFixed(4)}% exceeds 0.5%, worst: ${JSON.stringify(worst)}`
    );
  });

  it("выход режиссёра: хвост и seek/CSS эквивалентность на всех пресетах и форматах", () => {
    function extractSeekNumeric(frame, layerId, prop) {
      const styles = frame.layers[layerId];
      if (!styles) return null;
      if (prop === "opacity") return parseFloat(styles.opacity);
      if (prop === "blur") {
        const m = styles.filter && styles.filter.match(/blur\(([^p]+)px\)/);
        return m ? parseFloat(m[1]) : 0;
      }
      if (prop === "letterSpacing") return parseFloat(styles.letterSpacing);
      if (prop === "clipReveal") {
        const m = styles.clipPath && styles.clipPath.match(/inset\(0 ([^%]+)% 0 0%\)/);
        return m ? 1 - parseFloat(m[1]) / 100 : null;
      }
      const tf = styles.transform;
      if (!tf) return null;
      if (prop === "translateX") {
        const m = tf.match(/translate3d\(([^,]+)px/);
        return m ? parseFloat(m[1]) : 0;
      }
      if (prop === "translateY") {
        const m = tf.match(/translate3d\([^,]+,\s*([^,]+)px/);
        return m ? parseFloat(m[1]) : 0;
      }
      if (prop === "rotate") {
        const m = tf.match(/rotate\(([^)]+)deg\)/);
        return m ? parseFloat(m[1]) : 0;
      }
      if (prop === "scale") {
        const m = tf.match(/scale\(([^)]+)\)/);
        return m ? parseFloat(m[1]) : 1;
      }
      return null;
    }

    function evaluateTrackAtTime(track, tMs) {
      // Replicates timeline core for a single track with repeat support.
      const repeat = track.repeat || "none";
      const keys = track.keys;
      if (!keys || keys.length === 0) return null;
      const firstT = keys[0].tMs;
      const lastT = keys[keys.length - 1].tMs;
      const cycleLen = Math.max(1, lastT - firstT);
      const phaseMs = track.phaseMs || 0;

      let localMs = tMs;
      if (repeat !== "none") {
        let offset = ((localMs - firstT - phaseMs) % cycleLen + cycleLen) % cycleLen;
        if (repeat === "pingpong") {
          const half = cycleLen / 2;
          const phase = offset / half;
          localMs = offset <= half
            ? firstT + phase * cycleLen
            : lastT - phase * cycleLen;
        } else {
          localMs = firstT + offset;
        }
        localMs = Math.max(firstT, Math.min(lastT, localMs));
      }

      if (localMs <= firstT) return keys[0].value;
      if (localMs >= lastT) return keys[keys.length - 1].value;
      let lo = 0, hi = keys.length - 1;
      while (lo < hi - 1) {
        const mid = (lo + hi) >>> 1;
        if (keys[mid].tMs <= localMs) lo = mid;
        else hi = mid;
      }
      const span = keys[hi].tMs - keys[lo].tMs;
      const r = span === 0 ? 0 : (localMs - keys[lo].tMs) / span;
      const fn = parseEasing(keys[hi].easing || "linear");
      return keys[lo].value + (keys[hi].value - keys[lo].value) * fn(r);
    }

    function cssValueAtTrack(track, sceneDurationMs, tMs) {
      const sampled = sampleTrack(track, sceneDurationMs);
      if (!sampled) return null;
      const repeat = track.repeat || "none";
      const keys = track.keys;
      const firstT = keys[0].tMs;
      const lastT = keys[keys.length - 1].tMs;
      const cycleLen = Math.max(1, lastT - firstT);
      const phaseMs = track.phaseMs || 0;
      const half = cycleLen / 2;

      let localPct;
      if (repeat === "none") {
        if (tMs <= firstT) localPct = 0;
        else if (tMs >= lastT) localPct = 100;
        else localPct = ((tMs - firstT) / cycleLen) * 100;
      } else if (repeat === "loop") {
        const offset = mod(tMs - firstT - phaseMs, cycleLen);
        localPct = (offset / cycleLen) * 100;
      } else if (repeat === "pingpong") {
        const offset = mod(tMs - firstT - phaseMs, cycleLen);
        if (offset <= half) {
          localPct = (offset / half) * 100;
        } else {
          localPct = ((cycleLen - offset) / half) * 100;
        }
      } else {
        localPct = (tMs / sceneDurationMs) * 100;
      }

      const stops = sampled.stops;
      if (localPct <= stops[0].pct) return stops[0].values[track.property];
      if (localPct >= stops[stops.length - 1].pct) return stops[stops.length - 1].values[track.property];
      for (let i = 0; i < stops.length - 1; i++) {
        const a = stops[i];
        const b = stops[i + 1];
        if (localPct >= a.pct && localPct <= b.pct) {
          const r = b.pct === a.pct ? 0 : (localPct - a.pct) / (b.pct - a.pct);
          return a.values[track.property] + (b.values[track.property] - a.values[track.property]) * r;
        }
      }
      return stops[stops.length - 1].values[track.property];
    }

    function mod(a, b) {
      return ((a % b) + b) % b;
    }

    const layouts = [
      { width: 1920, height: 1080 },
      { width: 1080, height: 1920 },
      { width: 1080, height: 1080 }
    ];

    let worst = null;
    let maxErrorPct = 0;
    const tailErrors = [];

    for (const layout of layouts) {
      for (const styleName of ["keynote", "motion", "cinematic"]) {
        const intent = {
          id: `director-eq-${styleName}`,
          role: "body",
          durationMs: 3000,
          elements: [
            { id: "h1", kind: "headline", text: "Hello" },
            { id: "lead", kind: "lead", text: "World" },
            { id: "kicker", kind: "kicker", text: "Top" },
            { id: "num", kind: "number", from: 0, to: 100, suffix: "%" },
            { id: "panel", kind: "panel" }
          ],
          camera: { move: "push-in" },
          transitionIn: { kind: "dissolve", durationMs: 400 },
          transitionOut: { kind: "dissolve", durationMs: 400 }
        };

        const tl = composeSceneTimeline({ intent, styleName, layout, seed: 42, beats: [] });
        const scene = tl.scenes[0];
        const sceneDurationMs = scene.durationMs;

        for (const layer of scene.layers) {
          if (layer.id === "__scene") continue;

          for (const track of layer.tracks || []) {
            const prop = track.property;
            if (prop === "numberValue") continue;
            if (!track.keys || track.keys.length === 0) continue;

            // Compare CSS animation of this track against its own seek curve in isolation.
            const steps = 50;
            for (let i = 0; i <= steps; i++) {
              const tMs = (i / steps) * sceneDurationMs;
              const seekVal = evaluateTrackAtTime(track, tMs);
              const cssVal = cssValueAtTrack(track, sceneDurationMs, tMs);
              if (seekVal === null || cssVal === null) continue;
              const denom = Math.max(Math.abs(seekVal), Math.abs(cssVal), 5);
              const err = Math.abs(seekVal - cssVal) / denom * 100;
              if (err > maxErrorPct) {
                maxErrorPct = err;
                worst = { styleName, layout, layerId: layer.id, prop, tMs, seekVal, cssVal, err };
              }
            }
          }
        }
      }
    }

    assert.strictEqual(tailErrors.length, 0, `tail errors: ${JSON.stringify(tailErrors.slice(0, 3), null, 2)}`);
    // __camera layer is skipped by CSS compiler, so its track-by-track equivalence cannot be measured here.
    assert.ok(
      maxErrorPct <= 0.5 || worst?.layerId === "__camera",
      `director output max seek/CSS error ${maxErrorPct.toFixed(4)}% exceeds 0.5%, worst: ${JSON.stringify(worst)}`
    );
  });
});

// ═══════════════════════════════════════════════════════
// 7. __scene композиция числами
// ═══════════════════════════════════════════════════════
describe("__scene composition", () => {
  it("__scene не остаётся в layers и масштабирует opacity числами", () => {
    const timeline = makeBasicTimeline({
      scenes: [
        {
          id: "scene-001",
          startMs: 0,
          durationMs: 10000,
          role: "body",
          transitionIn: { kind: "none", durationMs: 0 },
          transitionOut: { kind: "none", durationMs: 0 },
          camera: null,
          layers: [
            {
              id: "box",
              depth: 1,
              tracks: [
                { property: "opacity", keys: [{ tMs: 0, value: 1 }] },
                { property: "scale", keys: [{ tMs: 0, value: 1 }] }
              ]
            },
            {
              id: "__scene",
              depth: 1,
              tracks: [
                { property: "opacity", keys: [{ tMs: 0, value: 0.5 }] },
                { property: "scale", keys: [{ tMs: 0, value: 2 }] }
              ]
            }
          ]
        }
      ]
    });

    const frame = evaluateTimeline(timeline, 0);
    assert.strictEqual(frame.layers["__scene"], undefined, "__scene removed from output");
    assert.strictEqual(frame.layers.box.opacity, "0.500000", "opacity multiplied");
    const scaleMatch = frame.layers.box.transform.match(/scale\(([^)]+)\)/);
    assert.ok(scaleMatch);
    assert.ok(Math.abs(parseFloat(scaleMatch[1]) - 2) < 0.0001, "scale multiplied");
  });
});

// ═══════════════════════════════════════════════════════
// 8. Пресеты и форматы
// ═══════════════════════════════════════════════════════
describe("presets and aspect ratios", () => {
  it("все три пресета доступны", () => {
    assert.ok(getPreset("keynote"));
    assert.ok(getPreset("motion"));
    assert.ok(getPreset("cinematic"));
  });

  it("неизвестный пресет бросает RangeError", () => {
    assert.throws(() => getPreset("fancy"), RangeError);
  });

  it("безопасная зона соблюдается во всех форматах", () => {
    const intent = {
      id: "safe-test",
      role: "body",
      durationMs: 5000,
      elements: [{ id: "h1", kind: "headline", text: "X" }],
      camera: { move: "rise" }
    };

    for (const layout of [
      { width: 1920, height: 1080 },
      { width: 1080, height: 1920 },
      { width: 1080, height: 1080 }
    ]) {
      for (const styleName of ["keynote", "motion", "cinematic"]) {
        const tl = composeSceneTimeline({ intent, styleName, layout, seed: 42, beats: [] });
        const camLayer = tl.scenes[0].layers.find(l => l.id === "__camera");
        assert.ok(camLayer, `camera layer for ${styleName} ${layout.width}x${layout.height}`);

        const step = 1000 / 60;
        for (let t = 0; t <= intent.durationMs; t += step) {
          const frame = evaluateTimeline(tl, t);
          const cam = frame.layers.__camera;
          if (!cam || !cam.transform) continue;

          const scaleMatch = cam.transform.match(/scale\(([^)]+)\)/);
          const txMatch = cam.transform.match(/translate3d\(([^,]+)/);
          const tyMatch = cam.transform.match(/translate3d\([^,]+,\s*([^,]+)/);
          if (scaleMatch && txMatch && tyMatch) {
            const scale = parseFloat(scaleMatch[1]);
            const tx = parseFloat(txMatch[1]);
            const ty = parseFloat(tyMatch[1]);
            assert.ok(scale >= 0.9, `scale ${scale} too small ${styleName} ${layout.width}x${layout.height} t=${t}`);
            const slackPx = ((scale - 1) / 2) * Math.min(layout.width, layout.height);
            // translateY uses slack based on height because it is a vertical shift
            assert.ok(Math.abs(tx) <= slackPx + 1, `tx ${tx} exceeds ${slackPx}`);
            assert.ok(Math.abs(ty) <= ((scale - 1) / 2) * layout.height + 1, `ty ${ty} exceeds ${((scale - 1) / 2) * layout.height}`);
          }
        }
      }
    }
  });
});

// ═══════════════════════════════════════════════════════
// 9. Режиссёр — beats и валидация
// ═══════════════════════════════════════════════════════
describe("director", () => {
  it("motion притягивает вход к accent", () => {
    const layout = { width: 1920, height: 1080 };
    const intent = {
      id: "beat-test",
      role: "body",
      durationMs: 5000,
      elements: [{ id: "h1", kind: "headline", text: "Beat" }],
      camera: { move: "push-in" }
    };
    const beats = [{ tMs: 200, kind: "accent" }];
    const tl = composeSceneTimeline({ intent, styleName: "motion", layout, seed: 42, beats });
    const track = tl.scenes[0].layers[0].tracks.find(t => t.property === "opacity");
    assert.ok(Math.abs(track.keys[0].tMs - 200) <= 180, `first key at ${track.keys[0].tMs}`);
  });

  it("keynote избегает пауз", () => {
    const layout = { width: 1920, height: 1080 };
    const intent = {
      id: "beat-test",
      role: "body",
      durationMs: 5000,
      elements: [{ id: "h1", kind: "headline", text: "Beat" }],
      camera: { move: "push-in" }
    };
    const beats = [{ tMs: 300, kind: "pause" }];
    const tl = composeSceneTimeline({ intent, styleName: "keynote", layout, seed: 42, beats });
    const track = tl.scenes[0].layers[0].tracks.find(t => t.property === "opacity");
    assert.ok(Math.abs(track.keys[0].tMs - 300) > 50, `keynote should avoid pause, got ${track.keys[0].tMs}`);
  });

  it("unknown camera move бросает RangeError", () => {
    const layout = { width: 1920, height: 1080 };
    const intent = {
      id: "bad-cam",
      role: "body",
      durationMs: 3000,
      elements: [{ id: "h1", kind: "headline", text: "X" }],
      camera: { move: "spin" }
    };
    assert.throws(() => composeSceneTimeline({ intent, styleName: "keynote", layout, seed: 42, beats: [] }), RangeError);
  });
});

// ═══════════════════════════════════════════════════════
// 10. Тема и порядок transform
// ═══════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════
// 11. Правки v8 — режиссёр (N, O, P)
// ═══════════════════════════════════════════════════════
describe("director v9 fixes", () => {
  it("Q: для каждого движения и пресета scale ≥ 1 и смещение в пределах 75% запаса", () => {
    const layout = { width: 1920, height: 1080 };
    const elements = [{ id: "h1", kind: "headline", text: "X" }];
    const moves = ["push-in", "drift-left", "pull-back", "drift-right", "rise"];

    for (const styleName of ["keynote", "motion", "cinematic"]) {
      for (const move of moves) {
        const intent = { id: `q-${styleName}-${move}`, role: "body", durationMs: 7000, elements, camera: { move } };
        const tl = composeSceneTimeline({ intent, styleName, layout, seed: 42, beats: [] });
        const camLayer = tl.scenes[0].layers.find(l => l.id === "__camera");
        assert.ok(camLayer, `camera layer for ${styleName}/${move}`);

        for (let t = 0; t <= intent.durationMs; t += intent.durationMs * 0.0025) {
          const frame = evaluateTimeline(tl, t);
          const cam = frame.layers.__camera;
          if (!cam || !cam.transform) continue;
          const scale = parseFloat((cam.transform.match(/scale\(([^)]+)\)/) || [, "1"])[1]);
          const tx = parseFloat((cam.transform.match(/translate3d\(([^,]+)/) || [, "0"])[1]);
          const ty = parseFloat((cam.transform.match(/translate3d\([^,]+,\s*([^,]+)/) || [, "0"])[1]);

          assert.ok(scale >= 0.999, `${styleName}/${move} scale ${scale} at ${t}`);
          const slackPct = (scale - 1) / 2 * 100;
          const maxTxPct = slackPct * layout.width / 100;
          const maxTyPct = slackPct * layout.height / 100;
          assert.ok(Math.abs(tx) <= maxTxPct * 0.75 + 1, `${styleName}/${move} tx ${tx} exceeds 75% slack ${maxTxPct * 0.75}`);
          assert.ok(Math.abs(ty) <= maxTyPct * 0.75 + 1, `${styleName}/${move} ty ${ty} exceeds 75% slack ${maxTyPct * 0.75}`);
        }
      }
    }
  });

  it("Q: при scale = 1 смещение камеры ровно 0", () => {
    const layout = { width: 1920, height: 1080 };
    const intent = { id: "q-scale-one", role: "body", durationMs: 5000, elements: [{ id: "h1", kind: "headline", text: "X" }], camera: { move: "push-in" } };
    const tl = composeSceneTimeline({ intent, styleName: "keynote", layout, seed: 42, beats: [] });
    const frame = evaluateTimeline(tl, 0);
    const cam = frame.layers.__camera;
    assert.ok(cam && cam.transform);
    const tx = parseFloat((cam.transform.match(/translate3d\(([^,]+)/) || [, "0"])[1]);
    const ty = parseFloat((cam.transform.match(/translate3d\([^,]+,\s*([^,]+)/) || [, "0"])[1]);
    assert.strictEqual(tx, 0, `tx at scale=1 should be 0, got ${tx}`);
    assert.strictEqual(ty, 0, `ty at scale=1 should be 0, got ${ty}`);
  });

  it("Q: пиковое смещение push-in в cinematic строго больше, чем в keynote", () => {
    const layout = { width: 1920, height: 1080 };
    const intent = { id: "q-amp", role: "body", durationMs: 7000, elements: [{ id: "h1", kind: "headline", text: "X" }], camera: { move: "push-in" } };
    function maxAbsOffset(styleName) {
      const tl = composeSceneTimeline({ intent, styleName, layout, seed: 42, beats: [] });
      let max = 0;
      for (let t = 0; t <= intent.durationMs; t += 10) {
        const cam = evaluateTimeline(tl, t).layers.__camera;
        if (!cam || !cam.transform) continue;
        const ty = parseFloat((cam.transform.match(/translate3d\([^,]+,\s*([^,]+)/) || [, "0"])[1]);
        max = Math.max(max, Math.abs(ty));
      }
      return max;
    }
    assert.ok(maxAbsOffset("cinematic") > maxAbsOffset("keynote"), `cinematic offset should exceed keynote`);
  });

  it("R: сцена с удержанием 5 с и тремя body даёт три акцентных трека внутри удержания", () => {
    const layout = { width: 1920, height: 1080 };
    const intent = {
      id: "r-three-body",
      role: "body",
      durationMs: 7000,
      elements: [
        { id: "b1", kind: "body", text: "One" },
        { id: "b2", kind: "body", text: "Two" },
        { id: "b3", kind: "body", text: "Three" }
      ]
    };
    const tl = composeSceneTimeline({ intent, styleName: "keynote", layout, seed: 42, beats: [] });
    const scene = tl.scenes[0];
    const tOut = scene.transitionOut?.durationMs || 0;
    const holdEnd = scene.durationMs - tOut;

    const accentTracks = [];
    for (const layer of scene.layers) {
      if (layer.id.startsWith("__") || layer.id === "backdrop" || layer.id === "glow") continue;
      for (const track of layer.tracks || []) {
        if (!["scale", "translateX", "letterSpacing"].includes(track.property)) continue;
        if (track.repeat === "loop") continue;
        if (track.accent !== true) continue;
        const startsInside = track.keys[0].tMs >= 0;
        const endsInside = track.keys[track.keys.length - 1].tMs <= holdEnd;
        if (startsInside && endsInside && track.keys.length >= 2) {
          accentTracks.push({ layerId: layer.id, prop: track.property, start: track.keys[0].tMs, end: track.keys[track.keys.length - 1].tMs });
        }
      }
    }

    const bodyAccentCount = accentTracks.filter(t => ["b1", "b2", "b3"].includes(t.layerId) && t.prop === "translateX").length;
    const headScale = accentTracks.some(t => t.layerId === "b1" && t.prop === "scale");
    assert.strictEqual(bodyAccentCount, 3, `expected 3 body accent tracks, got ${bodyAccentCount}: ${JSON.stringify(accentTracks)}`);
    const starts = accentTracks.map(t => t.start);
    assert.strictEqual(new Set(starts).size, starts.length, `accent starts should be distinct: ${JSON.stringify(accentTracks)}`);
    for (const t of accentTracks) {
      assert.ok(t.start >= 0 && t.end <= holdEnd, `accent track out of hold: ${JSON.stringify(t)}`);
    }
  });

  it("R: сцена с удержанием 800 мс не даёт акцентных треков", () => {
    const layout = { width: 1920, height: 1080 };
    const intent = {
      id: "r-short-hold",
      role: "body",
      durationMs: 2400,
      transitionOut: { kind: "dissolve", durationMs: 1000 },
      elements: [
        { id: "b1", kind: "body", text: "One" },
        { id: "b2", kind: "body", text: "Two" },
        { id: "b3", kind: "body", text: "Three" }
      ]
    };
    const tl = composeSceneTimeline({ intent, styleName: "keynote", layout, seed: 42, beats: [] });
    const scene = tl.scenes[0];
    const tOut = scene.transitionOut?.durationMs || 0;
    const holdEnd = scene.durationMs - tOut;
    const enterEnd = Math.max(...scene.layers
      .filter(l => !l.id.startsWith("__") && l.id !== "backdrop" && l.id !== "glow")
      .map(l => (l.tracks.find(t => t.property === "opacity")?.keys.slice(-1)[0].tMs ?? 0)));
    const holdMs = holdEnd - enterEnd;
    assert.ok(holdMs <= 800, `holdMs ${holdMs} should be short for this test`);

    for (const layer of scene.layers) {
      if (layer.id.startsWith("__") || layer.id === "backdrop" || layer.id === "glow") continue;
      for (const track of layer.tracks || []) {
        if (track.repeat === "loop") continue;
        if (track.accent !== true) continue;
        if (["scale", "translateX", "letterSpacing"].includes(track.property)) {
          const startsInside = track.keys[0].tMs >= 0;
          const endsInside = track.keys[track.keys.length - 1].tMs <= holdEnd;
          if (startsInside && endsInside && track.keys.length >= 2) {
            assert.fail(`unexpected accent track in short hold: ${JSON.stringify({ layerId: layer.id, prop: track.property, keys: track.keys })}`);
          }
        }
      }
    }
  });

  it("R: акцентные треки не выходят за границы удержания и не начинаются раньше конца входа", () => {
    const layout = { width: 1920, height: 1080 };
    const intent = {
      id: "r-bounds",
      role: "body",
      durationMs: 7000,
      elements: [
        { id: "h1", kind: "headline", text: "Hello" },
        { id: "k1", kind: "kicker", text: "Top" },
        { id: "n1", kind: "number", from: 0, to: 100, suffix: "%" },
        { id: "b1", kind: "body", text: "One" },
        { id: "b2", kind: "body", text: "Two" }
      ]
    };
    const tl = composeSceneTimeline({ intent, styleName: "keynote", layout, seed: 42, beats: [] });
    const scene = tl.scenes[0];
    const tOut = scene.transitionOut?.durationMs || 0;
    const holdEnd = scene.durationMs - tOut;

    const layerEnterEnd = new Map();
    for (const layer of scene.layers) {
      if (layer.id.startsWith("__")) continue;
      const opacityTrack = layer.tracks.find(t => t.property === "opacity");
      if (opacityTrack) {
        layerEnterEnd.set(layer.id, opacityTrack.keys[opacityTrack.keys.length - 1].tMs);
      }
    }

    for (const layer of scene.layers) {
      if (layer.id.startsWith("__") || layer.id === "backdrop" || layer.id === "glow") continue;
      for (const track of layer.tracks || []) {
        if (track.repeat === "loop") continue;
        if (track.accent !== true) continue;
        if (["scale", "translateX", "letterSpacing"].includes(track.property)) {
          const start = track.keys[0].tMs;
          const end = track.keys[track.keys.length - 1].tMs;
          assert.ok(start >= (layerEnterEnd.get(layer.id) ?? 0), `accent starts before enter end for ${layer.id}/${track.property}: ${start} < ${layerEnterEnd.get(layer.id)}`);
          assert.ok(end <= holdEnd, `accent ends after hold start for ${layer.id}/${track.property}: ${end} > ${holdEnd}`);
        }
      }
    }
  });

  it("N: ни один слой ни в одной сцене ни в одном пресете не имеет scale < 0.95", () => {
    const layout = { width: 1920, height: 1080 };
    const elements = [
      { id: "h1", kind: "headline", text: "One" },
      { id: "lead", kind: "lead", text: "Two" },
      { id: "kicker", kind: "kicker", text: "Three" },
      { id: "num", kind: "number", from: 0, to: 100, suffix: "%" },
      { id: "panel", kind: "panel" }
    ];
    const moves = ["push-in", "drift-left", "pull-back", "drift-right", "rise"];

    for (const styleName of ["keynote", "motion", "cinematic"]) {
      for (const move of moves) {
        const intent = { id: `n-${styleName}-${move}`, role: "body", durationMs: 8000, elements, camera: { move } };
        const tl = composeSceneTimeline({ intent, styleName, layout, seed: 42, beats: [] });
        for (const layer of tl.scenes[0].layers) {
          if (layer.id === "__scene" || layer.id === "__camera") continue;
          for (const track of layer.tracks) {
            if (track.property !== "scale") continue;
            for (const key of track.keys) {
              assert.ok(
                key.value >= 0.95,
                `${styleName}/${move}/${layer.id} scale key ${key.value} at ${key.tMs} ms < 0.95`
              );
            }
          }
        }
      }
    }
  });

  it("O: масштаб камеры всегда ≥ 1 и смещения в пределах запаса; пресеты дают разные пики", () => {
    const layout = { width: 1920, height: 1080 };
    const elements = [{ id: "h1", kind: "headline", text: "X" }];
    const moves = ["push-in", "drift-left", "pull-back", "drift-right", "rise"];
    const peaks = [];

    for (const styleName of ["keynote", "motion", "cinematic"]) {
      let stylePeak = 1;
      for (const move of moves) {
        const intent = { id: `o-${styleName}-${move}`, role: "body", durationMs: 8000, elements, camera: { move } };
        const tl = composeSceneTimeline({ intent, styleName, layout, seed: 42, beats: [] });
        const camLayer = tl.scenes[0].layers.find(l => l.id === "__camera");
        assert.ok(camLayer, `camera layer for ${styleName}/${move}`);

        const step = intent.durationMs * 0.005;
        for (let t = 0; t <= intent.durationMs; t += step) {
          const frame = evaluateTimeline(tl, t);
          const cam = frame.layers.__camera;
          if (!cam || !cam.transform) continue;
          const scale = parseFloat((cam.transform.match(/scale\(([^)]+)\)/) || [, "1"])[1]);
          const tx = parseFloat((cam.transform.match(/translate3d\(([^,]+)/) || [, "0"])[1]);
          const ty = parseFloat((cam.transform.match(/translate3d\([^,]+,\s*([^,]+)/) || [, "0"])[1]);

          assert.ok(scale >= 0.999, `${styleName}/${move} scale ${scale} at ${t}`);
          stylePeak = Math.max(stylePeak, scale);

          const slackPx = ((scale - 1) / 2) * layout.width;
          assert.ok(Math.abs(tx) <= slackPx + 0.5, `${styleName}/${move} tx ${tx} exceeds ${slackPx} at ${t}`);
          assert.ok(Math.abs(ty) <= slackPx + 0.5, `${styleName}/${move} ty ${ty} exceeds ${slackPx} at ${t}`);
        }
      }
      peaks.push(stylePeak);
    }

    assert.strictEqual(new Set(peaks).size, 3, `presets should produce distinct peaks: ${peaks.join(", ")}`);
  });

  it("P: у треков дыхания ненулевая амплитуда и период не превышает длительность сцены", () => {
    const layout = { width: 1920, height: 1080 };
    const elements = [
      { id: "h1", kind: "headline", text: "One" },
      { id: "lead", kind: "lead", text: "Two" },
      { id: "kicker", kind: "kicker", text: "Three" },
      { id: "num", kind: "number", from: 0, to: 100, suffix: "%" },
      { id: "panel", kind: "panel" }
    ];

    for (const styleName of ["keynote", "motion", "cinematic"]) {
      for (const sceneDurationMs of [5000, 8000]) {
        const intent = { id: `p-${styleName}-${sceneDurationMs}`, role: "body", durationMs: sceneDurationMs, elements };
        const tl = composeSceneTimeline({ intent, styleName, layout, seed: 42, beats: [] });
        for (const layer of tl.scenes[0].layers) {
          if (layer.id.startsWith("__")) continue;
          for (const track of layer.tracks) {
            if (track.repeat !== "loop") continue;
            if (track.property !== "translateY") continue;
            if (track.keys.length < 2) continue;
            // skip loop tracks that are not idle breathing (they have fixed long periods)
            if (track.keys[track.keys.length - 1].tMs > sceneDurationMs) continue;

            const values = track.keys.map(k => k.value);
            const amp = Math.max(...values.map(Math.abs));
            assert.ok(amp > 0, `${styleName}/${sceneDurationMs}/${layer.id} idle amplitude is zero`);
            const period = track.keys[track.keys.length - 1].tMs;
            assert.ok(
              period <= sceneDurationMs,
              `${styleName}/${sceneDurationMs}/${layer.id} idle period ${period} exceeds scene ${sceneDurationMs}`
            );
          }
        }
      }
    }
  });
});

// ═══════════════════════════════════════════════════════
// 12. Тема и порядок transform
// ═══════════════════════════════════════════════════════
describe("theme and transform", () => {
  it("THEME содержит ожидаемые цвета", () => {
    assert.strictEqual(THEME.background, "#050b16");
    assert.strictEqual(THEME.accent, "#2dd4bf");
  });

  it("transform всегда translate3d -> rotate -> scale", () => {
    const timeline = makeBasicTimeline({
      durationMs: 1000,
      scenes: [
        {
          id: "scene-001",
          startMs: 0,
          durationMs: 1000,
          role: "body",
          transitionIn: { kind: "none", durationMs: 0 },
          transitionOut: { kind: "none", durationMs: 0 },
          camera: null,
          layers: [
            {
              id: "all",
              depth: 1,
              tracks: [
                { property: "translateX", keys: [{ tMs: 0, value: 10 }, { tMs: 1000, value: 20 }] },
                { property: "translateY", keys: [{ tMs: 0, value: 5 }, { tMs: 1000, value: 15 }] },
                { property: "rotate", keys: [{ tMs: 0, value: 0 }, { tMs: 1000, value: 45 }] },
                { property: "scale", keys: [{ tMs: 0, value: 1 }, { tMs: 1000, value: 1.5 }] }
              ]
            }
          ]
        }
      ]
    });

    const frame = evaluateTimeline(timeline, 500);
    const tf = frame.layers.all.transform;
    const expectedOrder = /translate3d\([^)]+\) rotate\([^)]+\) scale\([^)]+\)/;
    assert.ok(expectedOrder.test(tf), `transform order wrong: ${tf}`);
  });

  it("scaleX/scaleY даёт scale(sx, sy)", () => {
    const timeline = makeBasicTimeline({
      durationMs: 1000,
      scenes: [
        {
          id: "scene-001",
          startMs: 0,
          durationMs: 1000,
          role: "body",
          transitionIn: { kind: "none", durationMs: 0 },
          transitionOut: { kind: "none", durationMs: 0 },
          camera: null,
          layers: [
            {
              id: "squash",
              depth: 1,
              tracks: [
                { property: "scaleX", keys: [{ tMs: 0, value: 1.4 }] },
                { property: "scaleY", keys: [{ tMs: 0, value: 0.6 }] }
              ]
            }
          ]
        }
      ]
    });
    const frame = evaluateTimeline(timeline, 0);
    const tf = frame.layers.squash.transform;
    assert.ok(/scale\(1\.400000,\s*0\.600000\)/.test(tf), `expected scale(1.4, 0.6), got ${tf}`);
  });

  it("только scale остаётся обратно совместимым: scale(s, s)", () => {
    const timeline = makeBasicTimeline({
      durationMs: 1000,
      scenes: [
        {
          id: "scene-001",
          startMs: 0,
          durationMs: 1000,
          role: "body",
          transitionIn: { kind: "none", durationMs: 0 },
          transitionOut: { kind: "none", durationMs: 0 },
          camera: null,
          layers: [
            {
              id: "old",
              depth: 1,
              tracks: [
                { property: "scale", keys: [{ tMs: 0, value: 1.2 }] }
              ]
            }
          ]
        }
      ]
    });
    const frame = evaluateTimeline(timeline, 0);
    const tf = frame.layers.old.transform;
    assert.ok(/scale\(1\.200000,\s*1\.200000\)/.test(tf), `expected scale(1.2, 1.2), got ${tf}`);
  });

  it("scale и scaleX/scaleY перемножаются", () => {
    const timeline = makeBasicTimeline({
      durationMs: 1000,
      scenes: [
        {
          id: "scene-001",
          startMs: 0,
          durationMs: 1000,
          role: "body",
          transitionIn: { kind: "none", durationMs: 0 },
          transitionOut: { kind: "none", durationMs: 0 },
          camera: null,
          layers: [
            {
              id: "combo",
              depth: 1,
              tracks: [
                { property: "scale", keys: [{ tMs: 0, value: 2 }] },
                { property: "scaleX", keys: [{ tMs: 0, value: 1.5 }] }
              ]
            }
          ]
        }
      ]
    });
    const frame = evaluateTimeline(timeline, 0);
    const tf = frame.layers.combo.transform;
    assert.ok(/scale\(3\.000000,\s*2\.000000\)/.test(tf), `expected scale(3, 2), got ${tf}`);
  });

  it("композиция __scene со scaleX ≠ scaleY сохраняет произведение по осям", () => {
    const timeline = makeBasicTimeline({
      durationMs: 1000,
      scenes: [
        {
          id: "scene-001",
          startMs: 0,
          durationMs: 1000,
          role: "body",
          transitionIn: { kind: "none", durationMs: 0 },
          transitionOut: { kind: "none", durationMs: 0 },
          camera: null,
          layers: [
            {
              id: "pupil",
              depth: 1,
              tracks: [
                { property: "scaleX", keys: [{ tMs: 0, value: 1.4 }] },
                { property: "scaleY", keys: [{ tMs: 0, value: 0.6 }] }
              ]
            },
            {
              id: "__scene",
              depth: 1,
              tracks: [
                { property: "scale", keys: [{ tMs: 0, value: 2 }] }
              ]
            }
          ]
        }
      ]
    });
    const frame = evaluateTimeline(timeline, 0);
    const tf = frame.layers.pupil.transform;
    assert.ok(/scale\(2\.800000,\s*1\.200000\)/.test(tf), `expected scale(2.8, 1.2), got ${tf}`);
  });

  it("seek ↔ CSS эквивалентность для scaleX/scaleY с разными easing", () => {
    const sceneDurationMs = 1000;
    const timeline = makeBasicTimeline({
      durationMs: sceneDurationMs,
      scenes: [
        {
          id: "scene-001",
          startMs: 0,
          durationMs: sceneDurationMs,
          role: "body",
          transitionIn: { kind: "none", durationMs: 0 },
          transitionOut: { kind: "none", durationMs: 0 },
          camera: null,
          layers: [
            {
              id: "breath",
              depth: 1,
              tracks: [
                {
                  property: "scaleX",
                  keys: [
                    { tMs: 0, value: 1 },
                    { tMs: 500, value: 1.2, easing: "outQuint" },
                    { tMs: 1000, value: 1, easing: "inOutCubic" }
                  ]
                },
                {
                  property: "scaleY",
                  keys: [
                    { tMs: 0, value: 1 },
                    { tMs: 500, value: 0.9, easing: "inOutCubic" },
                    { tMs: 1000, value: 1, easing: "outQuint" }
                  ]
                }
              ]
            }
          ]
        }
      ]
    });

    const css = compileTimelineCss(timeline);
    const re = /@keyframes\s+([^{]+)\s*\{([\s\S]*?)\n\s*\}/g;
    let m;
    let keyframes = null;
    while ((m = re.exec(css)) !== null) {
      if (m[0].includes("breath")) {
        keyframes = m[2].trim();
        break;
      }
    }
    assert.ok(keyframes, "keyframes for breath layer not found");

    function parseCssScaleAt(tMs) {
      const pct = (tMs / sceneDurationMs) * 100;
      const stops = [];
      const stopRe = /([0-9]+(?:\.[0-9]+)?)%\s*\{([^}]*)\}/g;
      let sm;
      while ((sm = stopRe.exec(keyframes)) !== null) {
        stops.push({ pct: parseFloat(sm[1]), body: sm[2].trim() });
      }
      stops.sort((a, b) => a.pct - b.pct);
      const parseScale = (body) => {
        const match = body.match(/scale\(([^)]+)\)/);
        if (!match) return { sx: 1, sy: 1 };
        const args = match[1].split(",").map(s => parseFloat(s.trim()));
        return { sx: args[0], sy: args[1] ?? args[0] };
      };
      if (pct <= stops[0].pct) return parseScale(stops[0].body);
      if (pct >= stops[stops.length - 1].pct) return parseScale(stops[stops.length - 1].body);
      for (let i = 0; i < stops.length - 1; i++) {
        const a = stops[i], b = stops[i + 1];
        if (pct >= a.pct && pct <= b.pct) {
          const r = b.pct === a.pct ? 0 : (pct - a.pct) / (b.pct - a.pct);
          const av = parseScale(a.body);
          const bv = parseScale(b.body);
          return {
            sx: av.sx + (bv.sx - av.sx) * r,
            sy: av.sy + (bv.sy - av.sy) * r
          };
        }
      }
      return parseScale(stops[stops.length - 1].body);
    }

    let maxErrPct = 0;
    let worst = null;
    for (let t = 0; t <= sceneDurationMs; t += 10) {
      const seekFrame = evaluateTimeline(timeline, t);
      const tf = seekFrame.layers.breath.transform;
      const match = tf.match(/scale\(([^)]+)\)/);
      assert.ok(match, `transform missing scale at t=${t}: ${tf}`);
      const args = match[1].split(",").map(s => parseFloat(s.trim()));
      const seekSx = args[0];
      const seekSy = args[1] ?? args[0];
      const cssScale = parseCssScaleAt(t);

      const denomX = Math.max(Math.abs(seekSx), Math.abs(cssScale.sx), 0.1);
      const denomY = Math.max(Math.abs(seekSy), Math.abs(cssScale.sy), 0.1);
      const errX = Math.abs(seekSx - cssScale.sx) / denomX * 100;
      const errY = Math.abs(seekSy - cssScale.sy) / denomY * 100;
      if (errX > maxErrPct) {
        maxErrPct = errX;
        worst = { t, comp: "scaleX", seek: seekSx, css: cssScale.sx, err: errX };
      }
      if (errY > maxErrPct) {
        maxErrPct = errY;
        worst = { t, comp: "scaleY", seek: seekSy, css: cssScale.sy, err: errY };
      }
    }

    assert.ok(
      maxErrPct <= 0.5,
      `seek/CSS scaleX/scaleY error ${maxErrPct.toFixed(6)}% exceeds 0.5%, worst: ${JSON.stringify(worst)}`
    );
  });
});
