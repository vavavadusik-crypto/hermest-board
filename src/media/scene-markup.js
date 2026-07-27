// Шелл сцены: фон, бренд-бар, прогресс, зона субтитров и заморозка анимаций по
// виртуальному времени `#t=`. Сама композиция кадра живёт в архетипах
// (scene-archetypes.js) — шелл только выбирает архетип и вклеивает его куски.

import { renderSceneArchetype } from "./scene-archetypes.js";
import { buildCameraCss } from "./scene-motion.js";
import { deriveSceneContent, isSceneArchetype, pickSceneArchetype } from "./scene-content.js";
import {
  THEME,
  ambientCss,
  clampText,
  escapeHtml,
  resolveSceneLayout,
  seededRandom
} from "./scene-design.js";

export { escapeHtml };

const STAR_COUNT = 90;
const MAX_FRAME_TIME_MS = 600000;

export function assertFrameTimeMs(frameTimeMs) {
  const value = Number(frameTimeMs);
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_FRAME_TIME_MS) {
    throw new RangeError(`frameTimeMs must be within 0..${MAX_FRAME_TIME_MS}`);
  }
  return value;
}

function starField({ seed, width, height }) {
  const random = seededRandom(seed);
  const stars = [];
  for (let index = 0; index < STAR_COUNT; index += 1) {
    const x = Math.round(random() * width);
    const y = Math.round(random() * height * 0.72);
    const radius = random() < 0.85 ? 1 : 2;
    const opacity = (0.25 + random() * 0.55).toFixed(2);
    const twinkleClass = index % 3 === 0 ? "tw-a" : index % 3 === 1 ? "tw-b" : "";
    stars.push(`<circle class="${twinkleClass}" cx="${x}" cy="${y}" r="${radius}" fill="#cfe3ff" opacity="${opacity}"/>`);
  }
  return stars.join("");
}

function gridFloor({ width, height }) {
  const horizonY = Math.round(height * 0.84);
  const lines = [];
  for (let step = 0; step <= 12; step += 1) {
    const y = horizonY + Math.round(((height - horizonY) * step * step) / 144);
    lines.push(`<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="#16324f" stroke-width="1" opacity="0.55"/>`);
  }
  const center = width / 2;
  for (let step = -8; step <= 8; step += 1) {
    const xTop = center + step * (width / 16);
    const xBottom = center + step * (width / 5);
    lines.push(
      `<line x1="${Math.round(xTop)}" y1="${horizonY}" x2="${Math.round(xBottom)}" y2="${height}" stroke="#16324f" stroke-width="1" opacity="0.45"/>`
    );
  }
  return lines.join("");
}

function progressDots({ total, activeIndex }) {
  const dots = [];
  for (let index = 0; index < total; index += 1) {
    const active = index === activeIndex;
    dots.push(
      `<span style="--d:${index};display:inline-block;width:${active ? 26 : 10}px;height:10px;border-radius:5px;background:${active ? THEME.accent : "#28425f"};"></span>`
    );
  }
  return dots.join("");
}

export function buildSceneMarkup({
  scene,
  sceneIndex,
  sceneTitles,
  brief,
  width,
  height,
  seed,
  safeZones,
  archetype,
  role,
  previousArchetype = "",
  mode = "opaque",
  animated = true
}) {
  if (!scene || typeof scene !== "object") throw new TypeError("Scene is required");
  if (mode !== "opaque" && mode !== "overlay") {
    throw new RangeError(`Unsupported scene markup mode: ${mode}`);
  }
  const isOverlay = mode === "overlay";
  const layout = resolveSceneLayout({ width, height, safeZones });
  const safeWidth = layout.width;
  const safeHeight = layout.height;
  const numericSeed = Number.isSafeInteger(seed) ? seed : 1;
  const titles = Array.isArray(sceneTitles) ? sceneTitles : [];
  const total = Math.max(titles.length, 1);
  const index = Number.isSafeInteger(sceneIndex) && sceneIndex >= 0 ? sceneIndex : 0;
  const topic = clampText(brief?.topic || titles[0] || scene.title, 80);
  const badge = `${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;
  const captionHeight = layout.captionHeight;

  const content = deriveSceneContent(scene);
  const picked = pickSceneArchetype({
    scene,
    sceneIndex: index,
    sceneCount: total,
    previous: previousArchetype,
    content
  });
  const resolvedArchetype = isSceneArchetype(archetype) ? archetype : picked.archetype;
  const resolvedRole = role === "opening" || role === "closing" || role === "body" ? role : picked.role;
  const heroFontSize = resolvedRole === "body"
    ? Math.round(safeHeight / (layout.isVertical ? 22 : 16))
    : Math.round(safeHeight / (layout.isVertical ? 16 : 11));

  // Камера складывается поверх архетипа: слои сцены и фона идут с разной
  // скоростью всю сцену, а не только в окне въезда.
  const cameraCss = buildCameraCss({
    sceneIndex: index,
    role: resolvedRole,
    durationMs: scene.durationMs,
    seed: numericSeed
  });

  const built = renderSceneArchetype({
    archetype: resolvedArchetype,
    role: resolvedRole,
    content,
    layout,
    topic,
    sceneIndex: index,
    sceneCount: total,
    sceneTitles: titles,
    heroFontSize,
    durationMs: scene.durationMs
  });

  return `<!DOCTYPE html>
<html lang="${escapeHtml(String(brief?.language || "en"))}">
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; }
  body {
    width: ${safeWidth}px;
    height: ${safeHeight}px;
    overflow: hidden;
    background: ${isOverlay ? "transparent" : THEME.background};
    font-family: "DejaVu Sans", sans-serif;
    color: ${THEME.text};
    position: relative;
  }
  .headline-scrim {
    position: absolute; inset: 0;
    background: linear-gradient(90deg, rgba(4, 9, 18, 0.72), rgba(4, 9, 18, 0.18) 55%, rgba(4, 9, 18, 0));
  }
  .glow-a, .glow-b { position: absolute; border-radius: 50%; filter: blur(${Math.round(safeWidth / 16)}px); }
  .glow-a { width: ${Math.round(safeWidth * 0.42)}px; height: ${Math.round(safeWidth * 0.42)}px; left: -${Math.round(safeWidth * 0.12)}px; top: -${Math.round(safeWidth * 0.1)}px; background: rgba(45, 212, 191, 0.16); }
  .glow-b { width: ${Math.round(safeWidth * 0.36)}px; height: ${Math.round(safeWidth * 0.36)}px; right: -${Math.round(safeWidth * 0.1)}px; bottom: ${Math.round(safeHeight * 0.05)}px; background: rgba(124, 92, 255, 0.14); }
  .backdrop { position: absolute; inset: 0; }
  .chrome-bar {
    position: absolute; top: 0; left: 0; right: 0;
    display: flex; align-items: center; justify-content: space-between;
    padding: ${layout.barPadY}px ${layout.barPadX}px;
  }
  .brand { display: flex; align-items: center; gap: 16px; }
  .brand-mark {
    width: 42px; height: 42px; border-radius: 10px;
    background: linear-gradient(135deg, ${THEME.accent}, #158f80);
    display: flex; align-items: center; justify-content: center;
    color: #04211c; font-weight: 700; font-size: 24px;
  }
  .brand-name { font-size: 21px; font-weight: 700; letter-spacing: 2px; }
  .brand-tag { font-size: 13px; color: ${THEME.textMuted}; letter-spacing: 3px; }
  .chapter-badge {
    background: #12244a; border: 1px solid #29457a; color: #9db8ff;
    padding: 10px 22px; border-radius: 10px; font-size: 17px; font-weight: 700; letter-spacing: 2px;
  }
  .stage {
    position: absolute;
    left: ${layout.padLeft}px; right: ${layout.padRight}px;
    top: ${layout.padTop}px; bottom: ${layout.padBottom}px;
    display: flex; ${built.stageFlex}
  }
  .kicker { color: ${THEME.accentWarm}; font-size: ${Math.round(heroFontSize * 0.34)}px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; margin-bottom: 24px; }
  h1 { margin: 0 0 26px; font-size: ${heroFontSize}px; line-height: 1.12; }
  h1 .dot { color: ${THEME.accent}; }
  .lead { color: ${THEME.textMuted}; font-size: ${Math.round(heroFontSize * 0.42)}px; line-height: 1.4; margin: 0; }
  .progress { position: absolute; left: 50%; transform: translateX(-50%); bottom: ${layout.progressBottom}px; display: flex; gap: 10px; }
  .caption-zone {
    position: absolute; left: 0; right: 0; bottom: 0; height: ${captionHeight}px;
    background: linear-gradient(180deg, rgba(4, 9, 18, 0), ${THEME.captionBar} 38%);
  }

  /* Premium build-in: база каждого элемента — финальное состояние, анимация
     с fill-mode backwards лишь ведёт к нему. Отключение анимаций даёт ровно
     текущий статичный кадр. */
  @keyframes rise-in { from { opacity: 0; transform: translateY(26px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes drop-in { from { opacity: 0; transform: translateY(-18px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes panel-in { from { opacity: 0; transform: translateY(20px) scale(0.955); } to { opacity: 1; transform: translateY(0) scale(1); } }
  @keyframes glow-drift { 0%, 100% { transform: translate(0, 0); } 50% { transform: translate(${Math.round(safeWidth * 0.012)}px, ${Math.round(safeHeight * 0.02)}px); } }
  @keyframes twinkle { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
  @keyframes dot-in { from { opacity: 0; } to { opacity: 1; } }
  .chrome-bar { animation: drop-in 0.55s ease-out 0.05s backwards; }
  .kicker { animation: rise-in 0.5s ease-out 0.12s backwards; }
  h1 { animation: rise-in 0.6s cubic-bezier(0.22, 0.9, 0.3, 1) 0.28s backwards; }
  .lead { animation: rise-in 0.6s ease-out 0.48s backwards; }
  .progress span { animation: dot-in 0.35s ease-out calc(1.9s + var(--d) * 0.06s) backwards; }
  .glow-a { animation: glow-drift 9s ease-in-out 0s infinite; }
  .glow-b { animation: glow-drift 11s ease-in-out -4s infinite reverse; }
  .tw-a { animation: twinkle 3.4s ease-in-out 0s infinite; }
  .tw-b { animation: twinkle 4.2s ease-in-out -1.7s infinite; }
  /* Слои фона дрейфуют в разные стороны — параллакс живёт всю сцену, а не
     только окно build-in. */
  .bd-stars { animation: amb-sway 22s ease-in-out 0s infinite; }
  .bd-grid { animation: amb-sway 30s ease-in-out -8s infinite reverse; }${ambientCss(layout)}${built.css}${cameraCss}${animated ? "" : "\n  * { animation: none !important; }"}
</style>
</head>
<body>
${isOverlay ? '  <div class="headline-scrim"></div>' : `  <svg class="backdrop" width="${safeWidth}" height="${safeHeight}" viewBox="0 0 ${safeWidth} ${safeHeight}" xmlns="http://www.w3.org/2000/svg">
    <g class="bd-stars">${starField({ seed: numericSeed + index, width: safeWidth, height: safeHeight })}</g>
    <g class="bd-grid">${gridFloor({ width: safeWidth, height: safeHeight })}</g>
  </svg>
  <div class="parallax-near">
    <div class="glow-a"></div>
    <div class="glow-b"></div>
  </div>`}
  <div class="chrome-bar">
    <div class="brand">
      <div class="brand-mark">H</div>
      <div>
        <div class="brand-name">HERMEST BOARD</div>
        <div class="brand-tag">AI CONTENT STUDIO</div>
      </div>
    </div>
    <div class="chapter-badge">${escapeHtml(badge)}</div>
  </div>
  <div class="stage" data-archetype="${escapeHtml(resolvedArchetype)}">
    ${built.stage}
  </div>
  <div class="progress">${progressDots({ total, activeIndex: index })}</div>
  <div class="caption-zone"></div>
  <script>
// Детерминированный покадровый захват: #t=<ms> ставит каждую анимацию на
// точное виртуальное время и замораживает её до скриншота.
const frameTimeMs = Number((location.hash.match(/t=(\\d+)/) || [0, 0])[1]);
for (const animation of document.getAnimations({ subtree: true })) {
  animation.currentTime = frameTimeMs;
  animation.pause();
}
  </script>
</body>
</html>
`;
}
