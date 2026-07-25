const THEME = Object.freeze({
  background: "#050b16",
  panel: "rgba(11, 21, 38, 0.82)",
  panelBorder: "#1e2f4a",
  text: "#e8eefc",
  textMuted: "#8fa3c8",
  accent: "#2dd4bf",
  accentAlt: "#7c5cff",
  accentWarm: "#f5b944",
  accentRed: "#ff5d73",
  captionBar: "rgba(4, 9, 18, 0.78)"
});

const NODE_COLORS = Object.freeze(["#2dd4bf", "#7c5cff", "#f5b944", "#ff5d73", "#4f8dff", "#9ae66e"]);
const MAX_TEXT_CHARS = 400;
const STAR_COUNT = 90;
const MAX_FRAME_TIME_MS = 600000;

export function assertFrameTimeMs(frameTimeMs) {
  const value = Number(frameTimeMs);
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_FRAME_TIME_MS) {
    throw new RangeError(`frameTimeMs must be within 0..${MAX_FRAME_TIME_MS}`);
  }
  return value;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// mulberry32: deterministic star field for a given project seed.
function seededRandom(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clampText(value, limit = MAX_TEXT_CHARS) {
  const text = String(value ?? "").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1)}…`;
}

// Заголовок и дикторский текст сравниваются без хвостовой пунктуации и
// регистра: сборщик нарратива добавляет к заголовку точку, поэтому дословное
// сравнение строк повтор не поймает.
function sentenceKey(value) {
  return String(value ?? "")
    .trim()
    .replace(/[.!?…]+$/u, "")
    .toLocaleLowerCase();
}

function pickLeadSentence(narration, title) {
  const titleKey = sentenceKey(title);
  const sentences = String(narration ?? "")
    .split(/(?<=[.!?…])\s+/)
    .map(sentence => sentence.trim())
    .filter(Boolean);
  return sentences.find(sentence => sentenceKey(sentence) !== titleKey) ?? "";
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

function topicDiagram({ centerLabel, orbitLabels, activeIndex, size }) {
  const half = size / 2;
  const orbitRadius = half * 0.72;
  const nodes = orbitLabels.map((label, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(orbitLabels.length, 1) - Math.PI / 2;
    const x = half + orbitRadius * Math.cos(angle);
    const y = half + orbitRadius * Math.sin(angle);
    const color = NODE_COLORS[index % NODE_COLORS.length];
    const isActive = index === activeIndex;
    const nodeRadius = isActive ? 46 : 34;
    const linkLength = Math.hypot(x - half, y - half).toFixed(1);
    return `
      <line class="dg-link" style="--i:${index};--len:${linkLength}" stroke-dasharray="${linkLength}" x1="${half}" y1="${half}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#24405f" stroke-width="2"/>
      <g class="dg-node${isActive ? " dg-node-active" : ""}" style="--i:${index}" transform-origin="${x.toFixed(1)}px ${y.toFixed(1)}px">
        <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${nodeRadius}" fill="#0b1526" stroke="${color}" stroke-width="${isActive ? 4 : 2}"/>
        <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" fill="${color}"/>
      </g>
      <text class="dg-label" style="--i:${index}" x="${x.toFixed(1)}" y="${(y + nodeRadius + 26).toFixed(1)}" text-anchor="middle" fill="${isActive ? THEME.text : THEME.textMuted}" font-size="19" font-family="DejaVu Sans" font-weight="${isActive ? 700 : 400}">${escapeHtml(clampText(label, 26))}</text>`;
  });
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" role="img">
    <g class="dg-center" transform-origin="${half}px ${half}px">
      <circle cx="${half}" cy="${half}" r="${half * 0.34}" fill="rgba(45,212,191,0.08)" stroke="${THEME.accent}" stroke-width="3"/>
      <text x="${half}" y="${half + 8}" text-anchor="middle" fill="${THEME.text}" font-size="26" font-family="DejaVu Sans" font-weight="700">${escapeHtml(clampText(centerLabel, 18))}</text>
    </g>
    ${nodes.join("")}
  </svg>`;
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
  mode = "opaque",
  animated = true
}) {
  if (!scene || typeof scene !== "object") throw new TypeError("Scene is required");
  if (mode !== "opaque" && mode !== "overlay") {
    throw new RangeError(`Unsupported scene markup mode: ${mode}`);
  }
  const isOverlay = mode === "overlay";
  const safeWidth = Number(width);
  const safeHeight = Number(height);
  if (!Number.isSafeInteger(safeWidth) || safeWidth <= 0 || !Number.isSafeInteger(safeHeight) || safeHeight <= 0) {
    throw new TypeError("Scene markup requires positive width and height");
  }
  const numericSeed = Number.isSafeInteger(seed) ? seed : 1;
  const titles = Array.isArray(sceneTitles) ? sceneTitles : [];
  const total = Math.max(titles.length, 1);
  const index = Number.isSafeInteger(sceneIndex) && sceneIndex >= 0 ? sceneIndex : 0;
  const isVertical = safeHeight > safeWidth;
  const isTitleScene = index === 0;
  const topic = clampText(brief?.topic || titles[0] || scene.title, 80);
  const title = clampText(scene.title, 120);
  // Дикторский текст сцены собирается как «заголовок карточки + её текст»,
  // поэтому первое предложение дословно повторяет <h1>. Ведущей строкой берём
  // первое предложение, которое заголовком не является.
  const narrationLead = clampText(pickLeadSentence(scene.narration, scene.title), 180);
  const badge = `${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;
  const diagramSize = isVertical ? Math.round(safeWidth * 0.68) : Math.round(safeHeight * 0.52);
  const heroFontSize = isTitleScene
    ? Math.round(safeHeight / (isVertical ? 16 : 11))
    : Math.round(safeHeight / (isVertical ? 22 : 16));
  const captionHeight = Math.round(safeHeight * 0.16);

  const diagram = topicDiagram({
    centerLabel: topic,
    orbitLabels: titles.slice(0, 6),
    activeIndex: index,
    size: diagramSize
  });

  const layoutStyles = isVertical
    ? "flex-direction:column;align-items:center;text-align:center;gap:48px;"
    : "flex-direction:row;align-items:center;justify-content:space-between;gap:64px;";

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
    padding: ${Math.round(safeHeight * 0.028)}px ${Math.round(safeWidth * 0.04)}px;
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
    left: ${Math.round(safeWidth * 0.05)}px; right: ${Math.round(safeWidth * 0.05)}px;
    top: ${Math.round(safeHeight * 0.14)}px; bottom: ${captionHeight + Math.round(safeHeight * 0.03)}px;
    display: flex; ${layoutStyles}
  }
  .headline { max-width: ${isVertical ? "100%" : "46%"}; }
  .kicker { color: ${THEME.accentWarm}; font-size: ${Math.round(heroFontSize * 0.34)}px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; margin-bottom: 24px; }
  h1 { margin: 0 0 26px; font-size: ${heroFontSize}px; line-height: 1.12; }
  h1 .dot { color: ${THEME.accent}; }
  .lead { color: ${THEME.textMuted}; font-size: ${Math.round(heroFontSize * 0.42)}px; line-height: 1.4; margin: 0; }
  .diagram-panel {
    background: ${THEME.panel}; border: 1px solid ${THEME.panelBorder}; border-radius: 18px;
    padding: ${Math.round(diagramSize * 0.06)}px;
    box-shadow: 0 24px 60px rgba(1, 6, 14, 0.6);
  }
  .progress { position: absolute; left: 50%; transform: translateX(-50%); bottom: ${captionHeight + Math.round(safeHeight * 0.012)}px; display: flex; gap: 10px; }
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
  @keyframes center-in { from { opacity: 0; transform: scale(0.6); } to { opacity: 1; transform: scale(1); } }
  @keyframes link-draw { from { stroke-dashoffset: var(--len); } to { stroke-dashoffset: 0; } }
  @keyframes node-in { from { opacity: 0; transform: scale(0.45); } to { opacity: 1; transform: scale(1); } }
  @keyframes label-in { from { opacity: 0; } to { opacity: 1; } }
  @keyframes node-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.045); } }
  @keyframes glow-drift { 0%, 100% { transform: translate(0, 0); } 50% { transform: translate(${Math.round(safeWidth * 0.012)}px, ${Math.round(safeHeight * 0.02)}px); } }
  @keyframes twinkle { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
  @keyframes dot-in { from { opacity: 0; } to { opacity: 1; } }
  .chrome-bar { animation: drop-in 0.55s ease-out 0.05s backwards; }
  .kicker { animation: rise-in 0.5s ease-out 0.12s backwards; }
  h1 { animation: rise-in 0.6s cubic-bezier(0.22, 0.9, 0.3, 1) 0.28s backwards; }
  .lead { animation: rise-in 0.6s ease-out 0.48s backwards; }
  .diagram-panel { animation: panel-in 0.7s cubic-bezier(0.22, 0.9, 0.3, 1) 0.58s backwards; }
  .dg-center { animation: center-in 0.55s cubic-bezier(0.22, 0.9, 0.3, 1) 0.78s backwards; }
  .dg-link { animation: link-draw 0.45s ease-in-out calc(0.95s + var(--i) * 0.16s) backwards; }
  .dg-node { animation: node-in 0.5s cubic-bezier(0.22, 0.9, 0.3, 1) calc(1.08s + var(--i) * 0.16s) backwards; }
  .dg-label { animation: label-in 0.4s ease-out calc(1.2s + var(--i) * 0.16s) backwards; }
  .dg-node-active { animation: node-in 0.5s cubic-bezier(0.22, 0.9, 0.3, 1) calc(1.08s + var(--i) * 0.16s) backwards, node-pulse 2.6s ease-in-out calc(2.2s + var(--i) * 0.16s) infinite; }
  .progress span { animation: dot-in 0.35s ease-out calc(1.9s + var(--d) * 0.06s) backwards; }
  .glow-a { animation: glow-drift 9s ease-in-out 0s infinite; }
  .glow-b { animation: glow-drift 11s ease-in-out -4s infinite reverse; }
  .tw-a { animation: twinkle 3.4s ease-in-out 0s infinite; }
  .tw-b { animation: twinkle 4.2s ease-in-out -1.7s infinite; }${animated ? "" : "\n  * { animation: none !important; }"}
</style>
</head>
<body>
${isOverlay ? '  <div class="headline-scrim"></div>' : `  <svg class="backdrop" width="${safeWidth}" height="${safeHeight}" viewBox="0 0 ${safeWidth} ${safeHeight}" xmlns="http://www.w3.org/2000/svg">
    ${starField({ seed: numericSeed + index, width: safeWidth, height: safeHeight })}
    ${gridFloor({ width: safeWidth, height: safeHeight })}
  </svg>
  <div class="glow-a"></div>
  <div class="glow-b"></div>`}
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
  <div class="stage">
    <div class="headline">
      <div class="kicker">${escapeHtml(topic)}</div>
      <h1>${escapeHtml(title)}<span class="dot">.</span></h1>
      ${narrationLead ? `<p class="lead">${escapeHtml(narrationLead)}</p>` : ""}
    </div>
    <div class="diagram-panel">${diagram}</div>
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
