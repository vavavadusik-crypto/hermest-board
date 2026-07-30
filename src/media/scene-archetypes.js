// Архетипы сцены: параметрические HTML/CSS-макеты, которые наполняются данными
// карточки. Каждый архетип отдаёт три куска, а шелл (scene-markup.js) их
// вклеивает: `stage` — разметка сцены, `css` — только его правила, `stageFlex` —
// раскладка контейнера .stage.
//
// Правила слоя:
//  * весь текст карточки проходит через escapeHtml;
//  * ни одного `url(` и ни одной внешней ссылки — кадр собирается офлайн;
//  * никакой недетерминированности: ни Date, ни Math.random, только вход;
//  * у каждого архетипа есть бесконечный ambient-слой, чтобы кадр не «умирал»
//    после того, как build-in отыграл.

import {
  CHARACTER_VIEWBOX_HEIGHT,
  CHARACTER_VIEWBOX_WIDTH,
  cartoonCharacterCss,
  resolveCastLooks,
  renderCharacter,
  renderForeground,
  renderSetting,
  speechBubble
} from "./cartoon-cast.js";
import { buildBeatCss } from "./scene-beats.js";
import { NODE_COLORS, THEME, clampText, escapeHtml, scaled } from "./scene-design.js";
import { buildPresenterTimeline, loadPresenterAtlas, presenterStageCss, renderPresenterMarkup } from "./presenter-stage.js";

const MAX_CHIPS = 5;

function accentColor(index) {
  return NODE_COLORS[Math.abs(index) % NODE_COLORS.length];
}

function panelSurface() {
  return `background:${THEME.panel};border:1px solid ${THEME.panelBorder};box-shadow:0 24px 60px rgba(1, 6, 14, 0.6);`;
}

function textOrDash(value) {
  const text = String(value ?? "").trim();
  return text ? escapeHtml(text) : "";
}

/** Стандартный текстовый блок: кикер, заголовок с акцентной точкой, лид. */
function headlineBlock({ topic, title, lead, className = "headline" }) {
  return `<div class="${className}">
      <div class="kicker">${escapeHtml(topic)}</div>
      <h1>${escapeHtml(title)}<span class="dot">.</span></h1>
      ${lead ? `<p class="lead">${escapeHtml(lead)}</p>` : ""}
    </div>`;
}

function skeletonBars({ count, widths, className }) {
  const bars = [];
  for (let index = 0; index < count; index += 1) {
    bars.push(`<span class="${className}" style="--i:${index};width:${widths[index % widths.length]}%"></span>`);
  }
  return bars.join("");
}

// ---------------------------------------------------------------------------
// classic — текущий макет: заголовок слева, круговая схема справа.
// ---------------------------------------------------------------------------

// Круговая схема укладывается в ТРИ спутника, не в шесть. На шести подписи
// сходились друг с другом, боковые вылезали за границу SVG и обрезались, а
// центральная надпись ложилась на правый узел. Три узла ставятся треугольником
// (верх, низ-право, низ-лево), холст шире круга, и под каждую подпись остаётся
// своя половина ширины.
const DIAGRAM_MAX_NODES = 3;
const DIAGRAM_ASPECT = 1.34;

// DejaVu Sans, кириллица: замеренная средняя ширина знака ≈ 0.62 кегля для
// обычного начертания и ≈ 0.66 для полужирного (по кадру: 23 знака подписи при
// кегле 29px заняли 410px). В SVG переноса строк нет, поэтому длина строки
// считается заранее и обрезается по доступной ширине.
const GLYPH_WIDTH_RATIO = 0.62;
const GLYPH_WIDTH_RATIO_BOLD = 0.66;

function charsThatFit(availableWidth, fontSize, ratio = GLYPH_WIDTH_RATIO) {
  return Math.max(4, Math.floor(availableWidth / (fontSize * ratio)));
}

/** Строка из слов, которая влезает в `maxChars`; остаток — во вторую строку. */
function wrapLabel(text, maxChars, maxLines) {
  const words = String(text ?? "").split(/\s+/u).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars || !current) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length === maxLines - 1) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  const used = lines.join(" ").length;
  const tail = String(text ?? "").slice(used).trim();
  if (tail && lines.length) lines[lines.length - 1] = clampText(`${lines.at(-1)} ${tail}`, maxChars);
  return lines.map(line => clampText(line, maxChars));
}

function topicDiagram({ centerLabel, orbitLabels, activeIndex, size }) {
  const viewWidth = Math.round(size * DIAGRAM_ASPECT);
  const viewHeight = size;
  const centerX = viewWidth / 2;
  const centerY = viewHeight / 2;
  // Орбита — эллипс, а не окружность: холст шире, чем выше, и на круглой орбите
  // две нижние подписи сходились друг с другом посреди схемы.
  const orbitRadiusX = size * 0.42;
  const orbitRadiusY = size * 0.34;
  const centerRadius = size * 0.24;
  const nodeRadius = size * 0.055;
  const labelFont = Math.max(12, Math.round(size * 0.05));
  const centerFont = Math.max(14, Math.round(size * 0.046));
  const labels = orbitLabels.slice(0, DIAGRAM_MAX_NODES);
  const active = labels.length ? Math.abs(activeIndex) % labels.length : 0;
  const bottomSpread = orbitRadiusX * Math.cos(Math.PI / 6);

  const nodes = labels.map((label, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(labels.length, 1) - Math.PI / 2;
    const x = centerX + orbitRadiusX * Math.cos(angle);
    const y = centerY + orbitRadiusY * Math.sin(angle);
    const color = accentColor(index);
    const isActive = index === active;
    const radius = isActive ? nodeRadius * 1.3 : nodeRadius;
    // Подпись центрируется по узлу, поэтому её половина ограничена и краем
    // холста, и серединой между соседними узлами. Без первого ограничения
    // боковые подписи обрезались краем SVG, без второго — сходились друг с
    // другом посреди схемы.
    const halfWidth = Math.min(x, viewWidth - x, index === 0 ? viewWidth : bottomSpread);
    const labelChars = charsThatFit(
      halfWidth * 2,
      labelFont,
      isActive ? GLYPH_WIDTH_RATIO_BOLD : GLYPH_WIDTH_RATIO
    );
    // Верхний узел подписывается сверху, нижние — снизу: иначе подпись верхнего
    // узла падает на центральный круг.
    const above = y < centerY;
    const labelY = above ? y - radius - labelFont * 0.6 : y + radius + labelFont * 1.05;
    // Связь начинается на границе центрального круга, а не в его центре: линия
    // из центра проходила прямо под названием темы.
    const linkX = centerX + centerRadius * Math.cos(angle);
    const linkY = centerY + centerRadius * Math.sin(angle);
    const linkLength = Math.hypot(x - linkX, y - linkY).toFixed(1);
    return `
      <line class="dg-link" style="--i:${index};--len:${linkLength}" stroke-dasharray="${linkLength}" x1="${linkX.toFixed(1)}" y1="${linkY.toFixed(1)}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#24405f" stroke-width="${Math.max(2, Math.round(size * 0.005))}"/>
      <g class="dg-node${isActive ? " dg-node-active" : ""}" style="--i:${index}" transform-origin="${x.toFixed(1)}px ${y.toFixed(1)}px">
        <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${radius.toFixed(1)}" fill="#0b1526" stroke="${color}" stroke-width="${isActive ? 4 : 2}"/>
        <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(radius * 0.18).toFixed(1)}" fill="${color}"/>
      </g>
      <text class="dg-label" style="--i:${index}" x="${x.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle" fill="${isActive ? THEME.text : THEME.textMuted}" font-size="${labelFont}" font-family="DejaVu Sans" font-weight="${isActive ? 700 : 400}">${escapeHtml(clampText(label, labelChars))}</text>`;
  });

  // Тема в центре переносится на две строки: в одну строку она обрезалась до
  // «Как Herm…» и от заголовка сцены не оставалось ничего.
  // Вписанный в окружность прямоугольник по двум строкам: ширина = 2r·cos(45°)
  // с запасом на скругление.
  const centerChars = charsThatFit(centerRadius * 1.3, centerFont, GLYPH_WIDTH_RATIO_BOLD);
  const centerLines = wrapLabel(centerLabel, centerChars, 2);
  const centerTop = centerY + centerFont * 0.34 - ((centerLines.length - 1) * centerFont * 0.58);
  const centerText = centerLines
    .map((line, index) => `<text x="${centerX}" y="${(centerTop + index * centerFont * 1.16).toFixed(1)}" text-anchor="middle" fill="${THEME.text}" font-size="${centerFont}" font-family="DejaVu Sans" font-weight="700">${escapeHtml(line)}</text>`)
    .join("");
  return `<svg width="${viewWidth}" height="${viewHeight}" viewBox="0 0 ${viewWidth} ${viewHeight}" xmlns="http://www.w3.org/2000/svg" role="img">
    <g class="dg-center" transform-origin="${centerX}px ${centerY}px">
      <circle cx="${centerX}" cy="${centerY}" r="${centerRadius.toFixed(1)}" fill="rgba(45,212,191,0.08)" stroke="${THEME.accent}" stroke-width="3"/>
      ${centerText}
    </g>
    ${nodes.join("")}
  </svg>`;
}

function buildClassic(ctx) {
  const { layout, content, topic, sceneIndex, sceneTitles } = ctx;
  // Схема больше не ужимается в маленький бокс: она берёт всю высоту сцены,
  // сколько позволяет её же ширина вместе с рамкой панели.
  const panelPadRatio = 0.05;
  const panelGrowth = 1 + panelPadRatio * 2;
  const availableWidth = layout.isNarrow ? layout.stageWidth : layout.stageWidth * 0.5;
  const availableHeight = layout.isNarrow ? layout.stageHeight * 0.55 : layout.stageHeight;
  const diagramSize = Math.max(
    140,
    Math.floor(Math.min(availableHeight / panelGrowth, availableWidth / (DIAGRAM_ASPECT * panelGrowth)))
  );
  const diagram = topicDiagram({
    centerLabel: topic,
    orbitLabels: sceneTitles.length ? sceneTitles : [content.title],
    activeIndex: sceneIndex,
    size: diagramSize
  });
  return {
    stageFlex: layout.isNarrow
      ? "flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:48px;"
      : "flex-direction:row;align-items:center;justify-content:space-between;gap:64px;",
    stage: `${headlineBlock({ topic, title: content.title, lead: content.lead })}
    <div class="diagram-panel"><div class="dg-drift">${diagram}</div></div>`,
    css: `
  .headline { max-width: ${layout.isNarrow ? "100%" : "46%"}; }
  .diagram-panel {
    background: ${THEME.panel}; border: 1px solid ${THEME.panelBorder}; border-radius: 18px;
    padding: ${Math.round(diagramSize * panelPadRatio)}px;
    box-shadow: 0 24px 60px rgba(1, 6, 14, 0.6);
  }
  @keyframes center-in { from { opacity: 0; transform: scale(0.6); } to { opacity: 1; transform: scale(1); } }
  @keyframes link-draw { from { stroke-dashoffset: var(--len); } to { stroke-dashoffset: 0; } }
  @keyframes node-in { from { opacity: 0; transform: scale(0.45); } to { opacity: 1; transform: scale(1); } }
  @keyframes label-in { from { opacity: 0; } to { opacity: 1; } }
  @keyframes node-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.045); } }
  .diagram-panel { animation: panel-in 0.7s cubic-bezier(0.22, 0.9, 0.3, 1) 0.58s backwards; }
  .dg-drift { animation: amb-float 12s ease-in-out 0s infinite; }
  .dg-center { animation: center-in 0.55s cubic-bezier(0.22, 0.9, 0.3, 1) 0.78s backwards; }
  .dg-link { animation: link-draw 0.45s ease-in-out calc(0.95s + var(--i) * 0.16s) backwards; }
  /* Узлы въезжают за полторы секунды, и дальше граф стоял. Волна внимания
     обходит узлы по кругу: она меняет только яркость, поэтому связи между
     узлами остаются на своих местах. */
  .dg-node {
    animation: node-in 0.5s cubic-bezier(0.22, 0.9, 0.3, 1) calc(1.08s + var(--i) * 0.16s) backwards,
      amb-wave 6.8s ease-in-out calc(2.4s + var(--i) * 0.55s) infinite;
  }
  .dg-label { animation: label-in 0.4s ease-out calc(1.2s + var(--i) * 0.16s) backwards; }
  .dg-node-active {
    animation: node-in 0.5s cubic-bezier(0.22, 0.9, 0.3, 1) calc(1.08s + var(--i) * 0.16s) backwards,
      amb-wave 6.8s ease-in-out calc(2.4s + var(--i) * 0.55s) infinite,
      node-pulse 2.6s ease-in-out calc(2.2s + var(--i) * 0.16s) infinite;
  }`
  };
}

// ---------------------------------------------------------------------------
// statement — крупная типографическая композиция (титульная и финальная).
// ---------------------------------------------------------------------------

function buildStatement(ctx) {
  const { layout, content, topic, role, s } = ctx;
  const words = content.title.split(/\s+/u).filter(Boolean);
  const titleHtml = words.length
    ? words.map((word, index) => `<span class="st-w" style="--i:${index}">${escapeHtml(word)}</span>`).join(" ")
    : escapeHtml(content.title);
  const ruleWidth = s(layout.isNarrow ? 34 : 26);
  const auraSize = Math.round(Math.min(layout.width, layout.height) * 0.9);
  const cta = content.data.cta ? `<div class="st-cta">${escapeHtml(content.data.cta)}</div>` : "";
  const closing = role === "closing";
  return {
    stageFlex: `flex-direction:column;align-items:${layout.isNarrow || closing ? "center" : "flex-start"};justify-content:center;text-align:${layout.isNarrow || closing ? "center" : "left"};gap:0;`,
    stage: `<div class="st-aura"></div>
    <div class="a-statement">
      <div class="kicker">${escapeHtml(topic)}</div>
      <h1>${titleHtml}<span class="dot">.</span></h1>
      <div class="st-rule"></div>
      ${content.lead ? `<p class="lead">${escapeHtml(content.lead)}</p>` : ""}
      ${closing ? `<div class="st-mark">H</div>` : ""}
      ${cta}
    </div>`,
    css: `
  .st-aura {
    position: absolute; width: ${auraSize}px; height: ${auraSize}px; border-radius: 50%;
    left: ${layout.isNarrow || closing ? "50%" : "22%"}; top: 50%;
    transform: translate(-50%, -50%);
    background: radial-gradient(circle, rgba(45, 212, 191, 0.16), rgba(124, 92, 255, 0.06) 55%, rgba(5, 11, 22, 0) 72%);
    filter: blur(${s(3)}px);
    animation: amb-breathe 13s ease-in-out 0s infinite;
  }
  .a-statement { position: relative; max-width: ${layout.isNarrow || closing ? "100%" : "82%"}; animation: amb-float 15s ease-in-out 0s infinite; }
  .a-statement h1 { font-size: ${Math.round(ctx.heroFontSize * 1.06)}px; }
  /* После въезда по словам заголовок стоял бы неподвижно всю сцену. Волна
     внимания идёт по словам дальше; она не двигает буквы, поэтому строка не
     дёргается и не перевёрстывается. */
  .st-w {
    display: inline-block;
    animation: rise-in 0.62s cubic-bezier(0.22, 0.9, 0.3, 1) calc(0.28s + var(--i) * 0.085s) backwards,
      amb-wave 7.5s ease-in-out calc(2.2s + var(--i) * 0.42s) infinite;
  }
  .st-rule {
    height: ${s(0.7)}px; width: ${ruleWidth}px; margin: ${s(2)}px ${layout.isNarrow || closing ? "auto" : "0"} ${s(2.6)}px;
    border-radius: ${s(0.4)}px;
    background: linear-gradient(90deg, ${THEME.accent}, ${THEME.accentAlt});
    animation: rule-draw 0.85s cubic-bezier(0.22, 0.9, 0.3, 1) 0.62s backwards;
  }
  .st-mark {
    width: ${s(9)}px; height: ${s(9)}px; border-radius: ${s(2.2)}px; margin: ${s(3.4)}px auto 0;
    background: linear-gradient(135deg, ${THEME.accent}, #158f80);
    color: #04211c; font-weight: 700; font-size: ${s(5)}px;
    display: flex; align-items: center; justify-content: center;
    animation: panel-in 0.7s cubic-bezier(0.22, 0.9, 0.3, 1) 0.95s backwards;
  }
  .st-cta {
    display: inline-block; margin-top: ${s(2.8)}px; padding: ${s(1.4)}px ${s(3.4)}px;
    border-radius: ${s(5)}px; border: 1px solid ${THEME.accent}; color: ${THEME.accent};
    font-size: ${Math.round(ctx.heroFontSize * 0.34)}px; font-weight: 700; letter-spacing: 2px;
    animation: panel-in 0.6s ease-out 1.1s backwards, amb-pulse 5s ease-in-out 1.7s infinite;
  }
  @keyframes rule-draw { from { width: 0; opacity: 0; } to { width: ${ruleWidth}px; opacity: 1; } }`
  };
}

// ---------------------------------------------------------------------------
// device-mockup — ноутбук или телефон с интерфейсом внутри.
// ---------------------------------------------------------------------------

function buildDeviceMockup(ctx) {
  const { layout, content, topic, sceneIndex, s } = ctx;
  const device = content.data.device ?? {};
  const kind = device.kind === "phone" || (layout.isNarrow && device.kind !== "laptop") ? "phone" : "laptop";
  const uiTitle = device.title || clampText(content.title, 28);
  const rows = (device.lines?.length ? device.lines : content.bullets).slice(0, 4);
  // Подставка ноутбука шире экрана в 1.14 раза, поэтому предел ставится по ней:
  // при stageWidth * 0.94 подставка вылезала за safe zone в 9:16 (952px против
  // 888px сцены).
  const laptopBaseRatio = 1.14;
  const laptopScreenRatio = 0.61;
  // В узком кадре текст и устройство стоят друг над другом, поэтому ноутбук
  // ограничен не только шириной сцены, но и её высотой: в 9:16 высоты хватает
  // с запасом и предел не срабатывает, а в квадрате без него связка
  // «заголовок + экран» перерастала сцену и налезала на шапку.
  const laptopHeightBudget = layout.stageHeight * (layout.isNarrow ? 0.5 : 0.8);
  // Телефон высокий: его высота — 1.9 ширины, а над ним ещё стоит заголовок.
  // Без предела по высоте он занимал 87% сцены в квадрате и 85% в 9:16 — в обоих
  // случаях связка «заголовок + устройство» перерастала сцену и наезжала на
  // шапку. Вертикальному кадру достаётся больший бюджет: там сцена длиннее.
  const phoneScreenRatio = 1.9;
  const phoneHeightBudget = layout.stageHeight * (layout.isVertical ? 0.62 : 0.55);
  const screenWidth = kind === "phone"
    ? Math.round(Math.min(
      layout.stageWidth * (layout.isNarrow ? 0.62 : 0.3),
      layout.stageHeight * 0.46,
      phoneHeightBudget / phoneScreenRatio
    ))
    : Math.min(
      Math.round(layout.isNarrow ? layout.stageWidth * 0.94 : layout.stageWidth * 0.52),
      Math.floor(layout.stageWidth / laptopBaseRatio),
      Math.floor(laptopHeightBudget / laptopScreenRatio)
    );
  const screenHeight = kind === "phone"
    ? Math.round(screenWidth * phoneScreenRatio)
    : Math.round(screenWidth * laptopScreenRatio);
  const copyFirst = layout.isNarrow || sceneIndex % 2 === 0;
  const rowsHtml = rows
    .map((row, index) => `<div class="dv-row" style="--i:${index}"><span class="dv-dot" style="background:${accentColor(index)}"></span><span class="dv-text">${escapeHtml(row)}</span></div>`)
    .join("");
  const screen = `<div class="dv-screen">
        <div class="dv-bar"><span class="dv-led" style="background:${THEME.accentRed}"></span><span class="dv-led" style="background:${THEME.accentWarm}"></span><span class="dv-led" style="background:${THEME.accent}"></span><div class="dv-tab">${escapeHtml(uiTitle)}</div></div>
        <div class="dv-body">
          ${kind === "laptop" ? `<div class="dv-side">${skeletonBars({ count: 4, widths: [82, 64, 74, 52], className: "dv-pill" })}</div>` : ""}
          <div class="dv-main">
            <div class="dv-title"></div>
            ${rowsHtml}
            <div class="dv-caret"></div>
          </div>
        </div>
        <div class="dv-glare"></div>
      </div>`;
  const deviceHtml = `<div class="dv-stage">
      <div class="dv-tilt">
        <div class="dv-frame dv-${kind}">
          ${screen}
          ${kind === "laptop" ? '<div class="dv-base"></div>' : '<div class="dv-notch"></div><div class="dv-home"></div>'}
        </div>
      </div>
    </div>`;
  const copy = headlineBlock({ topic, title: content.title, lead: content.leadBesideList, className: "headline dv-copy" });
  return {
    stageFlex: layout.isNarrow
      ? "flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:0;"
      : `flex-direction:row;align-items:center;justify-content:space-between;gap:${s(5)}px;`,
    stage: copyFirst ? `${copy}\n    ${deviceHtml}` : `${deviceHtml}\n    ${copy}`,
    css: `
  .dv-copy { max-width: ${layout.isNarrow ? "100%" : "42%"}; margin-bottom: ${layout.isNarrow ? `${s(3.4)}px` : "0"}; }
  .dv-stage { perspective: ${s(160)}px; }
  .dv-tilt { animation: dv-in 0.9s cubic-bezier(0.22, 0.9, 0.3, 1) 0.55s backwards; }
  .dv-frame { position: relative; animation: amb-float 10s ease-in-out 0s infinite; }
  .dv-screen {
    position: relative; overflow: hidden;
    width: ${screenWidth}px; height: ${screenHeight}px;
    border-radius: ${s(kind === "phone" ? 3.4 : 1.4)}px;
    border: ${s(kind === "phone" ? 0.9 : 0.5)}px solid #24405f;
    background: linear-gradient(160deg, #0a1728, #060e1c 60%, #08182b);
    box-shadow: 0 ${s(3)}px ${s(7)}px rgba(1, 6, 14, 0.7), inset 0 0 ${s(6)}px rgba(45, 212, 191, 0.05);
  }
  .dv-bar {
    display: flex; align-items: center; gap: ${s(0.8)}px;
    padding: ${s(1)}px ${s(1.4)}px; border-bottom: 1px solid rgba(36, 64, 95, 0.7);
    background: rgba(6, 13, 26, 0.75);
  }
  .dv-led { width: ${s(0.9)}px; height: ${s(0.9)}px; border-radius: 50%; display: inline-block; }
  .dv-tab {
    margin-left: ${s(1.2)}px; padding: ${s(0.4)}px ${s(1.4)}px; border-radius: ${s(0.6)}px;
    background: rgba(45, 212, 191, 0.1); color: ${THEME.text};
    font-size: ${s(1.5)}px; font-weight: 700; white-space: nowrap; overflow: hidden;
  }
  .dv-body { display: flex; gap: ${s(1.4)}px; padding: ${s(1.6)}px; height: calc(100% - ${s(4.2)}px); }
  .dv-side { display: flex; flex-direction: column; gap: ${s(1)}px; width: 26%; }
  .dv-pill {
    height: ${s(1.2)}px; border-radius: ${s(0.6)}px; background: rgba(143, 163, 200, 0.22);
    animation: rise-in 0.4s ease-out calc(1.05s + var(--i) * 0.1s) backwards;
  }
  .dv-main { flex: 1; display: flex; flex-direction: column; gap: ${s(1.1)}px; }
  .dv-title {
    height: ${s(1.9)}px; width: 58%; border-radius: ${s(0.5)}px;
    background: linear-gradient(90deg, ${THEME.accent}, rgba(45, 212, 191, 0.15));
    animation: rise-in 0.45s ease-out 1s backwards;
  }
  .dv-row {
    display: flex; align-items: center; gap: ${s(0.9)}px;
    padding: ${s(0.7)}px ${s(0.9)}px; border-radius: ${s(0.6)}px;
    background: rgba(17, 32, 54, 0.72); border: 1px solid rgba(36, 64, 95, 0.6);
  }
  .dv-dot { width: ${s(0.8)}px; height: ${s(0.8)}px; border-radius: 50%; flex: none; }
  .dv-text { color: ${THEME.textMuted}; font-size: ${s(1.45)}px; line-height: 1.25; overflow: hidden; }
  .dv-caret {
    width: ${s(0.35)}px; height: ${s(1.8)}px; background: ${THEME.accent};
    animation: dv-blink 1.15s steps(1, end) 2s infinite;
  }
  .dv-glare {
    position: absolute; top: 0; left: 0; width: 42%; height: 100%;
    background: linear-gradient(100deg, rgba(232, 238, 252, 0), rgba(232, 238, 252, 0.09) 45%, rgba(232, 238, 252, 0));
    animation: amb-sheen 8s ease-in-out 1.4s infinite;
  }
  .dv-base {
    width: ${Math.round(screenWidth * laptopBaseRatio)}px; height: ${s(1.5)}px; margin: ${s(0.5)}px auto 0;
    background: linear-gradient(180deg, #1b2f4b, #0c1626);
    clip-path: polygon(2% 0, 98% 0, 100% 100%, 0 100%);
    border-radius: 0 0 ${s(1)}px ${s(1)}px;
  }
  .dv-notch {
    position: absolute; top: ${s(0.9)}px; left: 50%; transform: translateX(-50%);
    width: 26%; height: ${s(0.8)}px; border-radius: ${s(0.4)}px; background: #040a14;
  }
  .dv-home {
    position: absolute; bottom: ${s(0.7)}px; left: 50%; transform: translateX(-50%);
    width: 32%; height: ${s(0.35)}px; border-radius: ${s(0.2)}px; background: rgba(143, 163, 200, 0.4);
  }
  @keyframes dv-in {
    from { opacity: 0; transform: perspective(${s(160)}px) rotateY(${copyFirst ? "-" : ""}14deg) translateY(${s(3)}px) scale(0.94); }
    to { opacity: 1; transform: perspective(${s(160)}px) rotateY(0deg) translateY(0) scale(1); }
  }
  @keyframes dv-blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }${buildBeatCss({ durationMs: ctx.durationMs, count: rows.length, selector: ".dv-row", name: "dv" })}`
  };
}

// ---------------------------------------------------------------------------
// board-columns — канбан-колонки с карточками, элементы въезжают по очереди.
// ---------------------------------------------------------------------------

function buildBoardColumns(ctx) {
  const { layout, content, topic, s } = ctx;
  const explicit = content.data.columns;
  const lanes = (explicit?.length
    ? explicit
    : content.bullets.slice(0, 3).map((title, index) => ({ title, cards: [], index }))
  ).slice(0, layout.isNarrow ? 3 : 4);
  const lanesHtml = lanes.map((lane, laneIndex) => {
    const cardCount = lane.cards?.length ? lane.cards.length : 3 - (laneIndex % 2);
    const cards = [];
    for (let cardIndex = 0; cardIndex < cardCount; cardIndex += 1) {
      const label = lane.cards?.[cardIndex] ? escapeHtml(lane.cards[cardIndex]) : "";
      const travelling = laneIndex === 0 && cardIndex === 0;
      cards.push(`<div class="bc-card${travelling ? " bc-travel" : ""}" style="--i:${laneIndex * 3 + cardIndex}">
            <span class="bc-tag" style="background:${accentColor(laneIndex)}"></span>
            ${label ? `<span class="bc-card-text">${label}</span>` : skeletonBars({ count: 2, widths: [88, 58], className: "bc-line" })}
          </div>`);
    }
    return `<div class="bc-lane" style="--i:${laneIndex}">
        <div class="bc-head"><span class="bc-chip" style="background:${accentColor(laneIndex)}"></span>${textOrDash(lane.title)}</div>
        <div class="bc-cards">${cards.join("")}</div>
      </div>`;
  }).join("");
  return {
    stageFlex: "flex-direction:column;align-items:stretch;justify-content:center;gap:0;",
    stage: `${headlineBlock({ topic, title: content.title, lead: "", className: "headline bc-copy" })}
    <div class="bc-board">${lanesHtml}</div>`,
    css: `
  .bc-copy { max-width: 100%; margin-bottom: ${s(2.6)}px; flex: none; }
  .bc-copy h1 { font-size: ${Math.round(ctx.heroFontSize * 0.82)}px; }
  /* Доска забирает всю высоту, оставшуюся под заголовком: раньше колонки жили
     в верхней трети кадра, а под ними стояла пустота на пол-экрана. */
  .bc-board {
    display: flex; flex: 1; min-height: 0;
    flex-direction: ${layout.isNarrow ? "column" : "row"}; gap: ${s(1.8)}px;
    animation: panel-in 0.7s cubic-bezier(0.22, 0.9, 0.3, 1) 0.5s backwards;
  }
  .bc-lane {
    flex: 1; min-height: 0; display: flex; flex-direction: ${layout.isNarrow ? "row" : "column"};
    align-items: ${layout.isNarrow ? "center" : "stretch"};
    gap: ${s(1.2)}px; border-radius: ${s(1.4)}px; padding: ${s(1.4)}px;
    ${panelSurface()}
  }
  .bc-head {
    display: flex; align-items: center; gap: ${s(0.8)}px;
    color: ${THEME.text}; font-size: ${s(1.7)}px; font-weight: 700;
    ${layout.isNarrow ? `width: 30%; flex: none;` : ""}
  }
  .bc-chip { width: ${s(0.9)}px; height: ${s(0.9)}px; border-radius: ${s(0.3)}px; flex: none; }
  /* Карточки остаются нормального размера и лежат сверху колонки: растянутые
     на всю высоту, они превращались в пустые прямоугольники. */
  .bc-cards {
    display: flex; flex-direction: ${layout.isNarrow ? "row" : "column"};
    gap: ${s(1)}px; flex: 1; min-height: 0; justify-content: flex-start;
  }
  .bc-card {
    position: relative; display: flex; align-items: center; gap: ${s(0.8)}px; flex: none;
    padding: ${s(1.2)}px ${s(1.3)}px; border-radius: ${s(0.9)}px;
    background: rgba(17, 32, 54, 0.82); border: 1px solid rgba(36, 64, 95, 0.7);
    animation: rise-in 0.45s cubic-bezier(0.22, 0.9, 0.3, 1) calc(0.95s + var(--i) * 0.11s) backwards;
  }
  .bc-tag { width: ${s(0.35)}px; align-self: stretch; border-radius: ${s(0.2)}px; flex: none; }
  .bc-card-text { color: ${THEME.textMuted}; font-size: ${s(1.35)}px; line-height: 1.25; }
  .bc-line { display: block; height: ${s(0.75)}px; border-radius: ${s(0.4)}px; background: rgba(143, 163, 200, 0.24); margin-bottom: ${s(0.5)}px; }
  .bc-travel {
    border-color: ${THEME.accent};
    box-shadow: 0 0 ${s(2.4)}px rgba(45, 212, 191, 0.35);
    animation: rise-in 0.45s cubic-bezier(0.22, 0.9, 0.3, 1) 0.95s backwards, bc-travel 7s cubic-bezier(0.5, 0, 0.5, 1) 2s infinite;
  }
  @keyframes bc-travel {
    0%, 12% { transform: translate3d(0, 0, 0); }
    38%, 62% { transform: translate3d(${layout.isNarrow ? `0, ${s(6)}px` : `${s(11)}px, 0`}, 0); }
    88%, 100% { transform: translate3d(0, 0, 0); }
  }${buildBeatCss({ durationMs: ctx.durationMs, count: lanes.length, selector: ".bc-lane", name: "bc" })}`
  };
}

// ---------------------------------------------------------------------------
// format-trio — три формата кадра рядом: 16:9, 9:16, 1:1.
// ---------------------------------------------------------------------------

function buildFormatTrio(ctx) {
  const { layout, content, topic, s } = ctx;
  const labels = content.data.formats?.length ? content.data.formats.slice(0, 3) : ["16:9", "9:16", "1:1"];
  const ratios = [[16, 9], [9, 16], [1, 1]];
  // Три кадра переносятся на вторую строку, когда не влезают в ширину, поэтому
  // высота сцены — такое же ограничение, как ширина: в 9:16 предел по ширине
  // строже и ничего не меняется, а в квадрате без предела по высоте вторая
  // строка выпадала за нижнюю кромку.
  const base = layout.isNarrow
    ? Math.round(Math.min(layout.stageWidth * 0.42, layout.stageHeight * 0.36))
    : Math.round(Math.min(layout.stageWidth * 0.26, layout.stageHeight * 0.42));
  const framesHtml = labels.map((label, index) => {
    const [rw, rh] = ratios[index % ratios.length];
    const frameHeight = Math.round((base * rh) / Math.max(rw, rh));
    const frameWidth = Math.round((base * rw) / Math.max(rw, rh));
    return `<figure class="ft-item" style="--i:${index}">
        <div class="ft-frame" style="width:${frameWidth}px;height:${frameHeight}px;border-color:${accentColor(index)}">
          <div class="ft-inner">
            <span class="ft-band" style="background:${accentColor(index)}"></span>
            ${skeletonBars({ count: 2, widths: [72, 44], className: "ft-line" })}
          </div>
          <div class="ft-sheen"></div>
        </div>
        <figcaption class="ft-label">${escapeHtml(label)}</figcaption>
      </figure>`;
  }).join("");
  return {
    stageFlex: "flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:0;",
    stage: `${headlineBlock({ topic, title: content.title, lead: content.lead, className: "headline ft-copy" })}
    <div class="ft-row">${framesHtml}</div>`,
    css: `
  .ft-copy { max-width: 100%; margin-bottom: ${s(3)}px; }
  .ft-copy h1 { font-size: ${Math.round(ctx.heroFontSize * 0.86)}px; }
  .ft-row {
    display: flex; flex-wrap: ${layout.isNarrow ? "wrap" : "nowrap"};
    align-items: flex-end; justify-content: center; gap: ${s(2.6)}px;
  }
  .ft-item {
    margin: 0; display: flex; flex-direction: column; align-items: center; gap: ${s(1.2)}px;
  }
  .ft-frame {
    position: relative; overflow: hidden; border-radius: ${s(1.1)}px;
    border: ${s(0.3)}px solid ${THEME.accent};
    background: linear-gradient(165deg, #0b1a2d, #060e1c);
    box-shadow: 0 ${s(2)}px ${s(5)}px rgba(1, 6, 14, 0.65);
  }
  .ft-inner { position: absolute; inset: ${s(1)}px; display: flex; flex-direction: column; justify-content: flex-end; gap: ${s(0.6)}px; }
  .ft-band { display: block; height: ${s(1.2)}px; width: 46%; border-radius: ${s(0.4)}px; }
  .ft-line { display: block; height: ${s(0.6)}px; border-radius: ${s(0.3)}px; background: rgba(143, 163, 200, 0.26); }
  .ft-sheen {
    position: absolute; top: 0; left: 0; width: 55%; height: 100%;
    background: linear-gradient(100deg, rgba(232, 238, 252, 0), rgba(232, 238, 252, 0.12) 50%, rgba(232, 238, 252, 0));
    animation: amb-sheen 6.5s ease-in-out calc(1.2s + var(--i) * 0.7s) infinite;
  }
  .ft-label {
    /* Приглушённый цвет здесь не работал: подпись стоит у нижней кромки, где
       кадр и так затемняется под субтитры, и она пропадала совсем. */
    color: ${THEME.text}; font-size: ${s(1.9)}px; font-weight: 700; letter-spacing: 2px;
    animation: rise-in 0.45s ease-out calc(1.05s + var(--i) * 0.18s) backwards;
  }${buildBeatCss({ durationMs: ctx.durationMs, count: labels.length, selector: ".ft-item", name: "ft" })}`
  };
}

// ---------------------------------------------------------------------------
// checklist — пункты с последовательным проставлением галочек.
// ---------------------------------------------------------------------------

function buildChecklist(ctx) {
  const { layout, content, topic, s } = ctx;
  const items = (content.items.length ? content.items : content.bullets).slice(0, MAX_CHIPS);
  const rowsHtml = items.map((item, index) => `<li class="cl-row" style="--i:${index}">
        <span class="cl-box" style="border-color:${accentColor(index)}">
          <svg class="cl-svg" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path class="cl-check" d="M4 12.6 L9.6 18 L20 6.2" fill="none" stroke="${accentColor(index)}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="30"/>
          </svg>
        </span>
        <span class="cl-text">${escapeHtml(item)}</span>
      </li>`).join("");
  return {
    stageFlex: layout.isNarrow
      ? "flex-direction:column;align-items:stretch;justify-content:center;gap:0;"
      : `flex-direction:row;align-items:stretch;justify-content:space-between;gap:${s(5)}px;`,
    stage: `${headlineBlock({ topic, title: content.title, lead: layout.isNarrow ? "" : content.leadBesideList, className: "headline cl-copy" })}
    <ul class="cl-list">${rowsHtml}<li class="cl-sweep"></li></ul>`,
    css: `
  .cl-copy {
    max-width: ${layout.isNarrow ? "100%" : "40%"}; margin-bottom: ${layout.isNarrow ? `${s(3)}px` : "0"};
    ${layout.isNarrow ? "" : "display: flex; flex-direction: column; justify-content: center;"}
  }
  .cl-list {
    position: relative; overflow: hidden; list-style: none; margin: 0; padding: ${s(1.8)}px;
    display: flex; flex-direction: column; justify-content: center; gap: ${s(1.2)}px;
    flex: 1; min-height: 0; border-radius: ${s(1.6)}px;
    ${panelSurface()}
    animation: panel-in 0.7s cubic-bezier(0.22, 0.9, 0.3, 1) 0.5s backwards;
  }
  /* Пункты подрастают под высоту панели, но не безгранично: пять полос во весь
     кадр читались бы уже не как чеклист. */
  .cl-row {
    display: flex; align-items: center; flex: 1 1 auto; max-height: ${s(9)}px; gap: ${s(1.3)}px;
    padding: ${s(1.1)}px ${s(1.2)}px; border-radius: ${s(0.9)}px;
    background: rgba(17, 32, 54, 0.6); border: 1px solid rgba(36, 64, 95, 0.6);
  }
  .cl-box {
    width: ${s(2.8)}px; height: ${s(2.8)}px; flex: none; border-radius: ${s(0.7)}px;
    border: ${s(0.22)}px solid ${THEME.accent}; display: flex; align-items: center; justify-content: center;
  }
  .cl-svg { width: 78%; height: 78%; }
  .cl-check { animation: check-draw 0.42s ease-out calc(1.15s + var(--i) * 0.2s) backwards; }
  .cl-text { color: ${THEME.text}; font-size: ${s(1.85)}px; line-height: 1.3; }
  .cl-sweep {
    position: absolute; left: 0; top: 0; width: 100%; height: ${s(9)}px; pointer-events: none;
    background: linear-gradient(180deg, rgba(45, 212, 191, 0), rgba(45, 212, 191, 0.09) 50%, rgba(45, 212, 191, 0));
    animation: cl-sweep 9s ease-in-out 2.2s infinite;
  }
  @keyframes check-draw { from { stroke-dashoffset: 30; } to { stroke-dashoffset: 0; } }
  @keyframes cl-sweep { 0% { transform: translateY(-100%); } 100% { transform: translateY(${Math.max(items.length, 1) * 100}%); } }${buildBeatCss({ durationMs: ctx.durationMs, count: items.length, selector: ".cl-row", name: "cl" })}`
  };
}

// ---------------------------------------------------------------------------
// comparison — две половины экрана: до/после, дорого/дёшево.
// ---------------------------------------------------------------------------

function buildComparison(ctx) {
  const { layout, content, topic, s } = ctx;
  const pair = content.pair ?? {
    left: { label: "", text: content.bullets[0] ?? "", items: [] },
    right: { label: "", text: content.bullets[1] ?? content.bullets[0] ?? "", items: [] }
  };
  const side = (data, index, tone) => {
    const itemsHtml = (data.items ?? []).slice(0, 4)
      .map((item, itemIndex) => `<li class="cp-item" style="--i:${itemIndex}">${escapeHtml(item)}</li>`)
      .join("");
    return `<div class="cp-side cp-${tone}" style="--i:${index}">
        ${data.label ? `<div class="cp-label">${escapeHtml(data.label)}</div>` : ""}
        ${data.text ? `<div class="cp-text">${escapeHtml(data.text)}</div>` : ""}
        ${itemsHtml ? `<ul class="cp-items">${itemsHtml}</ul>` : ""}
      </div>`;
  };
  return {
    stageFlex: "flex-direction:column;align-items:stretch;justify-content:center;gap:0;",
    stage: `${headlineBlock({ topic, title: content.title, lead: "", className: "headline cp-copy" })}
    <div class="cp-split">
      ${side(pair.left, 0, "before")}
      <div class="cp-divider"></div>
      ${side(pair.right, 1, "after")}
    </div>`,
    css: `
  .cp-copy { max-width: 100%; margin-bottom: ${s(2.8)}px; flex: none; text-align: ${layout.isNarrow ? "center" : "left"}; }
  .cp-copy h1 { font-size: ${Math.round(ctx.heroFontSize * 0.86)}px; }
  /* Стороны берут всю высоту сцены: двумя низкими плашками во всю ширину это
     читалось как список из двух пунктов, а не как сравнение. */
  .cp-split {
    display: flex; flex: 1; min-height: 0;
    flex-direction: ${layout.isNarrow ? "column" : "row"};
    align-items: stretch; gap: ${s(2)}px;
  }
  .cp-side {
    flex: 1; min-height: 0; display: flex; flex-direction: column; justify-content: center;
    gap: ${s(1.4)}px; padding: ${s(2.6)}px; border-radius: ${s(1.6)}px;
    ${panelSurface()}
  }
  /* Явный контраст сторон: «до» приглушено и утоплено, «после» подсвечено. */
  .cp-before {
    border-color: rgba(255, 93, 115, 0.45);
    background: rgba(9, 15, 27, 0.72);
  }
  .cp-before .cp-text { color: ${THEME.textMuted}; font-weight: 400; }
  .cp-after {
    border-color: rgba(45, 212, 191, 0.5);
    border-width: ${s(0.2)}px;
    background: linear-gradient(160deg, rgba(20, 46, 52, 0.9), rgba(11, 21, 38, 0.86));
  }
  /* Свечение живёт на псевдоэлементе, а не на самой стороне. На стороне уже
     есть анимация доли, а свойство animation — шорткат: второе правило с
     равной специфичностью затирает список целиком, и свечение не запускалось. */
  .cp-after::after {
    content: ""; position: absolute; inset: 0; border-radius: inherit;
    pointer-events: none;
    animation: cp-glow 6.5s ease-in-out 1.6s infinite;
  }
  .cp-after .cp-text { font-size: ${s(2.7)}px; }
  .cp-label {
    font-size: ${s(1.8)}px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase;
    color: ${THEME.textMuted};
  }
  .cp-before .cp-label { color: ${THEME.accentRed}; }
  .cp-after .cp-label { color: ${THEME.accent}; }
  .cp-text { color: ${THEME.text}; font-size: ${s(2.4)}px; line-height: 1.28; font-weight: 700; }
  .cp-items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: ${s(0.8)}px; }
  .cp-item {
    color: ${THEME.textMuted}; font-size: ${s(1.6)}px; padding-left: ${s(1.6)}px; position: relative;
    animation: rise-in 0.42s ease-out calc(1s + var(--i) * 0.14s) backwards;
  }
  .cp-divider {
    ${layout.isNarrow
    ? `height: ${s(0.3)}px; width: 100%;`
    : `width: ${s(0.3)}px; align-self: stretch;`}
    border-radius: ${s(0.2)}px;
    background: linear-gradient(${layout.isNarrow ? "90deg" : "180deg"}, rgba(45, 212, 191, 0), ${THEME.accent}, rgba(124, 92, 255, 0));
    animation: cp-divider 0.8s ease-out 0.9s backwards, amb-pulse 7s ease-in-out 1.8s infinite;
  }
  @keyframes cp-divider { from { opacity: 0; transform: scale${layout.isNarrow ? "X" : "Y"}(0.2); } to { opacity: 1; transform: none; } }
  @keyframes cp-glow {
    0%, 100% { box-shadow: 0 24px 60px rgba(1, 6, 14, 0.6), 0 0 0 rgba(45, 212, 191, 0); }
    50% { box-shadow: 0 24px 60px rgba(1, 6, 14, 0.6), 0 0 ${s(4)}px rgba(45, 212, 191, 0.3); }
  }${buildBeatCss({ durationMs: ctx.durationMs, count: 2, selector: ".cp-side", name: "cp" })}`
  };
}

// ---------------------------------------------------------------------------
// stat-highlight / metric-grid — крупные цифры с набегающим счётчиком.
// ---------------------------------------------------------------------------

function counterMarkup({ number, className, id }) {
  // CSS-счётчик набегает по виртуальному времени, поэтому кадр остаётся
  // детерминированным. Нецелые значения счётчиком не набежать — тогда цифра
  // просто появляется целиком.
  //
  // fill-mode обязан быть both, а не backwards: после конца анимации custom
  // property возвращается к initial-value, то есть к нулю. С backwards кадр,
  // снятый позже 2.1 с, показывал «0» вместо значения — на сцене это выглядело
  // как «ноль секунд сборки» и «ноль форматов на выходе».
  if (!number.integer) {
    return { html: `<span class="${className}">${escapeHtml(number.raw)}</span>`, css: "" };
  }
  return {
    html: `<span class="${className} ${id}" aria-hidden="true"></span><span class="sr-value">${escapeHtml(number.raw)}</span>`,
    css: `
  @property --${id} { syntax: "<integer>"; initial-value: 0; inherits: false; }
  @keyframes run-${id} { from { --${id}: 0; } to { --${id}: ${number.value}; } }
  .${id} { counter-reset: ${id} var(--${id}); animation: run-${id} 1.5s cubic-bezier(0.16, 0.84, 0.24, 1) 0.6s both; }
  .${id}::after { content: counter(${id}); }`
  };
}

function buildStatHighlight(ctx) {
  const { layout, content, topic, s } = ctx;
  const explicit = content.data.stat;
  const number = explicit
    ? { raw: explicit.value, unit: explicit.unit, value: Number(explicit.value), integer: /^\d+$/u.test(explicit.value) }
    : content.numbers[0] ?? { raw: content.title, unit: "", value: 0, integer: false };
  const caption = explicit?.caption || content.lead || content.bullets[0] || "";
  // Под кольцом стоят надпись, заголовок и подпись, поэтому в узком кадре
  // размер считается от обоих измерений сразу: в 9:16 строже ширина и число не
  // меняется, а в квадрате кольцо прежнего размера выдавливало текст на ряд
  // точек прогресса.
  const ringSize = Math.round(layout.isNarrow
    ? Math.min(layout.stageWidth * 0.72, layout.stageHeight * 0.55)
    : Math.min(layout.stageWidth, layout.stageHeight) * 0.62);
  const circumference = (Math.PI * 2 * 52).toFixed(1);
  const counter = counterMarkup({ number, className: "sh-value", id: "shnum" });
  return {
    stageFlex: "flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:0;",
    stage: `<div class="sh-wrap">
      <div class="sh-halo"></div>
      <svg class="sh-ring" width="${ringSize}" height="${ringSize}" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle cx="60" cy="60" r="52" fill="none" stroke="#152840" stroke-width="5"/>
        <circle class="sh-arc" cx="60" cy="60" r="52" fill="none" stroke="${THEME.accent}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${circumference}" transform="rotate(-90 60 60)"/>
        <circle class="sh-spark" cx="60" cy="60" r="52" fill="none" stroke="#dffaf4" stroke-width="5" stroke-linecap="round" transform="rotate(-90 60 60)"/>
      </svg>
      <div class="sh-figure">
        ${counter.html}${number.unit ? `<span class="sh-unit">${escapeHtml(number.unit)}</span>` : ""}
      </div>
    </div>
    <div class="kicker sh-kicker">${escapeHtml(topic)}</div>
    <h1 class="sh-title">${escapeHtml(content.title)}<span class="dot">.</span></h1>
    ${caption ? `<p class="lead sh-caption">${escapeHtml(caption)}</p>` : ""}`,
    css: `
  .sh-wrap { position: relative; width: ${ringSize}px; height: ${ringSize}px; margin-bottom: ${s(2.4)}px; }
  .sh-halo {
    position: absolute; inset: -14%; border-radius: 50%;
    background: radial-gradient(circle, rgba(45, 212, 191, 0.22), rgba(5, 11, 22, 0) 68%);
    animation: amb-pulse 6s ease-in-out 0.8s infinite;
  }
  .sh-ring { position: relative; display: block; animation: amb-breathe 10s ease-in-out 0s infinite; }
  .sh-arc { animation: sh-arc 1.6s cubic-bezier(0.16, 0.84, 0.24, 1) 0.55s backwards; }
  /* Дуга дорисовывается за полторы секунды, и дальше кольцо стояло всю сцену.
     По нему идёт короткий блик: он бежит по контуру, ничего не смещая, поэтому
     геометрия кадра остаётся той же. */
  .sh-spark {
    stroke-dasharray: ${(Number(circumference) * 0.06).toFixed(1)} ${(Number(circumference) * 0.94).toFixed(1)};
    opacity: 0.55;
    animation: sh-spark 5.4s linear 2.1s infinite;
  }
  /* Число и единица стоят колонкой внутри кольца: строкой единица уезжала к
     верхнему краю квадрата и ложилась поверх дуги. Вписанный в окружность
     квадрат — 0.707 диаметра, поэтому кегли считаются от него. */
  .sh-figure {
    position: absolute; inset: 0; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: ${s(0.2)}px; color: ${THEME.text};
  }
  .sh-value { font-size: ${Math.round(ringSize * 0.34)}px; font-weight: 700; line-height: 1; letter-spacing: -2px; }
  .sh-unit {
    font-size: ${Math.round(ringSize * 0.1)}px; font-weight: 700; line-height: 1;
    letter-spacing: 1px; text-transform: uppercase; color: ${THEME.accent};
  }
  .sr-value { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .sh-kicker { animation: rise-in 0.5s ease-out 1.2s backwards; }
  .sh-title { font-size: ${Math.round(ctx.heroFontSize * 0.9)}px; animation: rise-in 0.55s cubic-bezier(0.22, 0.9, 0.3, 1) 1.32s backwards; }
  .sh-caption { animation: rise-in 0.5s ease-out 1.5s backwards; }
  @keyframes sh-arc { from { stroke-dashoffset: ${circumference}; } to { stroke-dashoffset: ${(Number(circumference) * 0.18).toFixed(1)}; } }
  @keyframes sh-spark { from { stroke-dashoffset: 0; } to { stroke-dashoffset: -${circumference}; } }${counter.css}`
  };
}

/**
 * Подпись под числом не должна начинаться с этого же числа: в кадре «3» и под
 * ним «3 формата» читаются как «3 3 формата». Само число (и его единица, если
 * она уже вынесена в чип) срезаются с начала подписи.
 */
function labelWithoutLeadingNumber(label, number) {
  const raw = String(number?.raw ?? "");
  if (!raw) return label;
  let text = label.trimStart();
  if (!text.startsWith(raw)) return label;
  text = text.slice(raw.length).trimStart();
  const unit = String(number?.unit ?? "");
  if (unit && text.toLocaleLowerCase().startsWith(unit.toLocaleLowerCase())) {
    text = text.slice(unit.length).trimStart();
  }
  // Ничего, кроме числа, в подписи не было — тогда лучше оставить как есть,
  // чем показать пустую строку под цифрой.
  return text || label;
}

function buildMetricGrid(ctx) {
  const { layout, content, topic, s } = ctx;
  const numbers = content.numbers.length
    ? content.numbers.slice(0, 4)
    : [{ raw: "1", unit: "", value: 1, integer: true }];
  const counters = numbers.map((number, index) => counterMarkup({
    number,
    className: "mg-value",
    id: `mgnum${index}`
  }));
  const tiles = numbers.map((number, index) => {
    const source = content.bullets[index] ?? content.bullets[0] ?? "";
    const label = labelWithoutLeadingNumber(source, number);
    return `<div class="mg-tile" style="--i:${index};border-color:${accentColor(index)}">
        <div class="mg-figure">${counters[index].html}${number.unit ? `<span class="mg-unit">${escapeHtml(number.unit)}</span>` : ""}</div>
        ${label ? `<div class="mg-label">${escapeHtml(clampText(label, 46))}</div>` : ""}
      </div>`;
  }).join("");
  const columns = layout.isNarrow ? Math.min(numbers.length, 2) : Math.min(numbers.length, 4);
  return {
    stageFlex: "flex-direction:column;align-items:stretch;justify-content:center;gap:0;",
    stage: `${headlineBlock({ topic, title: content.title, lead: "", className: "headline mg-copy" })}
    <div class="mg-grid">${tiles}</div>`,
    css: `
  .mg-copy { max-width: 100%; margin-bottom: ${s(3)}px; flex: none; text-align: ${layout.isNarrow ? "center" : "left"}; }
  .mg-copy h1 { font-size: ${Math.round(ctx.heroFontSize * 0.84)}px; }
  .mg-grid {
    display: grid; flex: 1; min-height: 0;
    grid-template-columns: repeat(${columns}, minmax(0, 1fr)); gap: ${s(1.8)}px;
  }
  .mg-tile {
    display: flex; flex-direction: column; justify-content: center; gap: ${s(1)}px;
    padding: ${s(2)}px; border-radius: ${s(1.5)}px;
    ${panelSurface()}
    border-left-width: ${s(0.4)}px;
  }
  .mg-figure { display: flex; align-items: baseline; gap: ${s(0.6)}px; color: ${THEME.text}; }
  /* Плитка теперь во всю высоту сцены, поэтому и число крупнее: прежний кегль
     терялся посреди пустой карточки. */
  .mg-value { font-size: ${s(layout.isNarrow ? 8 : 9)}px; font-weight: 700; line-height: 1; letter-spacing: -2px; }
  .mg-unit { font-size: ${s(3)}px; font-weight: 700; color: ${THEME.accent}; }
  .mg-label { color: ${THEME.textMuted}; font-size: ${s(1.8)}px; line-height: 1.3; }
  .sr-value { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }${counters.map(counter => counter.css).join("")}${buildBeatCss({ durationMs: ctx.durationMs, count: numbers.length, selector: ".mg-tile", name: "mg" })}`
  };
}

// ---------------------------------------------------------------------------
// flow-steps — 3–5 шагов со стрелками, подсветка идёт по кругу.
// ---------------------------------------------------------------------------

function buildFlowSteps(ctx) {
  const { layout, content, topic, s } = ctx;
  const steps = (content.steps.length ? content.steps : content.bullets).slice(0, MAX_CHIPS);
  const arrow = layout.isNarrow
    ? `<svg class="fs-arrow" viewBox="0 0 24 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><line class="fs-line" x1="12" y1="2" x2="12" y2="28" stroke="#24405f" stroke-width="2.4" stroke-dasharray="26"/><polygon class="fs-tip" points="12,38 5,26 19,26" fill="#24405f"/></svg>`
    : `<svg class="fs-arrow" viewBox="0 0 40 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><line class="fs-line" x1="2" y1="12" x2="28" y2="12" stroke="#24405f" stroke-width="2.4" stroke-dasharray="26"/><polygon class="fs-tip" points="38,12 26,5 26,19" fill="#24405f"/></svg>`;
  const chips = steps.map((step, index) => `<div class="fs-step" style="--i:${index};--c:${accentColor(index)}">
        <span class="fs-index">${index + 1}</span>
        <span class="fs-text">${escapeHtml(step)}</span>
      </div>`);
  const flowHtml = chips.reduce((acc, chip, index) => index === 0 ? chip : `${acc}${arrow}${chip}`, "");
  return {
    stageFlex: "flex-direction:column;align-items:stretch;justify-content:center;gap:0;",
    stage: `${headlineBlock({ topic, title: content.title, lead: "", className: "headline fs-copy" })}
    <div class="fs-flow">${flowHtml}</div>`,
    css: `
  .fs-copy { max-width: 100%; margin-bottom: ${s(3)}px; flex: none; text-align: ${layout.isNarrow ? "center" : "left"}; }
  .fs-copy h1 { font-size: ${Math.round(ctx.heroFontSize * 0.84)}px; }
  /* Шаги тянутся по высоте, но не во всю сцену: ряд из пяти колонок высотой в
     кадр читался бы уже не как поток, а как таблица. */
  .fs-flow {
    display: flex; flex: 1; min-height: 0;
    max-height: ${Math.round(layout.stageHeight * (layout.isNarrow ? 1 : 0.6))}px;
    align-self: center; width: 100%;
    flex-direction: ${layout.isNarrow ? "column" : "row"};
    align-items: stretch; justify-content: center; gap: ${s(1.2)}px;
  }
  .fs-step {
    flex: 1; min-height: 0; display: flex; align-items: center; gap: ${s(1.1)}px;
    padding: ${s(1.5)}px ${s(1.6)}px; border-radius: ${s(1.2)}px;
    ${panelSurface()}
    border-color: rgba(36, 64, 95, 0.8);
  }
  .fs-index {
    width: ${s(2.8)}px; height: ${s(2.8)}px; flex: none; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    background: var(--c); color: #04211c; font-weight: 700; font-size: ${s(1.5)}px;
  }
  .fs-text { color: ${THEME.text}; font-size: ${s(1.6)}px; line-height: 1.28; }
  .fs-arrow {
    flex: none; ${layout.isNarrow ? `width: ${s(2.4)}px; height: ${s(3.4)}px; align-self: center;` : `width: ${s(3.4)}px; height: ${s(2.4)}px;`}
  }
  .fs-line { animation: fs-draw 0.4s ease-out 1.15s backwards; }
  .fs-tip { animation: rise-in 0.3s ease-out 1.45s backwards; }
  @keyframes fs-draw { from { stroke-dashoffset: 26; } to { stroke-dashoffset: 0; } }${buildBeatCss({ durationMs: ctx.durationMs, count: steps.length, selector: ".fs-step", name: "fs" })}`
  };
}

// ---------------------------------------------------------------------------
// quote — оформленная цитата.
// ---------------------------------------------------------------------------


// Слова цитаты нумеруются, чтобы волна внимания могла идти по ним со сдвигом
// фазы. Пробел между span-ами обязателен: без него слова слипаются.
function quoteWords(text) {
  const words = String(text).split(/\s+/u).filter(Boolean);
  if (!words.length) return escapeHtml(String(text));
  return words
    .map((word, index) => `<span class="qt-w" style="--i:${index}">${escapeHtml(word)}</span>`)
    .join(" ");
}

function buildQuote(ctx) {
  const { layout, content, topic, s } = ctx;
  const quote = content.quote ?? { text: content.lead || content.title, source: "" };
  const glyphSize = Math.round(Math.min(layout.width, layout.height) * 0.3);
  return {
    stageFlex: "flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:0;",
    stage: `<div class="qt-wrap">
      <div class="qt-glyph" aria-hidden="true">“</div>
      <div class="kicker qt-kicker">${escapeHtml(topic)}</div>
      <blockquote class="qt-text">${quoteWords(quote.text)}</blockquote>
      ${quote.source ? `<div class="qt-source">${escapeHtml(quote.source)}</div>` : ""}
    </div>`,
    css: `
  /* Глиф кавычки участвует в потоке, а не висит абсолютом над текстом: пока он
     был вне потока, центрировался только текст, и вся композиция вместе с
     кавычкой уезжала в верхнюю половину кадра. */
  .qt-wrap {
    position: relative; display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    max-width: ${layout.isNarrow ? "100%" : "88%"};
    animation: amb-float 14s ease-in-out 0s infinite;
  }
  .qt-glyph {
    font-size: ${glyphSize}px; line-height: 0.72; height: ${Math.round(glyphSize * 0.42)}px;
    color: rgba(45, 212, 191, 0.16);
    animation: amb-sway 18s ease-in-out 0s infinite;
  }
  .qt-kicker { position: relative; margin-top: ${s(1.4)}px; animation: rise-in 0.5s ease-out 0.3s backwards; }
  .qt-text {
    position: relative; margin: ${s(1.6)}px 0 0; color: ${THEME.text};
    font-size: ${Math.round(ctx.heroFontSize * 0.94)}px; line-height: 1.24; font-weight: 700;
    animation: rise-in 0.7s cubic-bezier(0.22, 0.9, 0.3, 1) 0.5s backwards;
  }
  .qt-source {
    position: relative; margin-top: ${s(2.6)}px; color: ${THEME.accent};
    font-size: ${Math.round(ctx.heroFontSize * 0.36)}px; font-weight: 700; letter-spacing: 2px;
    animation: rise-in 0.5s ease-out 0.95s backwards;
  }
  .qt-source::before { content: "— "; }
  /* Цитата въезжает целиком, а дальше по её словам идёт волна внимания: она
     меняет только яркость, поэтому строки не перевёрстываются на каждом кадре. */
  .qt-w { display: inline-block; animation: amb-wave 8.5s ease-in-out calc(1.6s + var(--i) * 0.34s) infinite; }`
  };
}

// Расстановка по ширине кадра: в узком кадре персонажи сходятся к центру,
// в широком — расходятся, иначе двое стоят вплотную либо теряются по углам.
const CARTOON_POSITIONS = Object.freeze({
  wide: Object.freeze({ 1: [0.42], 2: [0.26, 0.74], 3: [0.16, 0.5, 0.84] }),
  narrow: Object.freeze({ 1: [0.5], 2: [0.29, 0.71], 3: [0.17, 0.5, 0.83] })
});

/**
 * Размер реплики подбирается под облачко: длинная фраза уменьшает кегль, пока
 * текст не поместится в отведённую высоту. Оценка грубая (ширина глифа —
 * доля кегля), но детерминированная, а облачко всё равно с запасом.
 */
function fitBubbleFontSize({ text, bubbleWidth, maxHeight, maxFontSize }) {
  const characters = Math.max(1, String(text).length);
  for (let fontSize = maxFontSize; fontSize > 12; fontSize -= 2) {
    const charsPerLine = Math.max(8, Math.floor(bubbleWidth / (fontSize * GLYPH_WIDTH_RATIO)));
    const lines = Math.ceil(characters / charsPerLine);
    if (lines * fontSize * 1.32 <= maxHeight) return fontSize;
  }
  return 12;
}

function buildCartoonShot(ctx) {
  const { layout, content, topic, s } = ctx;
  // Карточка без явного мультблока всё равно должна дать кадр: один персонаж,
  // говорящий лид сцены. Пустая сцена хуже, чем сцена по умолчанию.
  const cartoon = content.data.cartoon ?? {
    setting: "void",
    cast: [{ id: `char-${topic}`, name: "", pose: "talk", side: "left", speaking: true, look: null }],
    line: "",
    caption: ""
  };
  const frameWidth = layout.width;
  const frameHeight = layout.height;
  const groundY = frameHeight - layout.captionHeight - scaled(layout, 3);
  const ceiling = layout.padTop;
  const available = Math.max(120, groundY - ceiling);
  const charHeight = Math.round(Math.min(available * (layout.isNarrow ? 0.46 : 0.62), frameHeight * 0.46));
  const charWidth = Math.round((charHeight * CHARACTER_VIEWBOX_WIDTH) / CHARACTER_VIEWBOX_HEIGHT);

  const table = layout.isNarrow ? CARTOON_POSITIONS.narrow : CARTOON_POSITIONS.wide;
  const positions = table[cartoon.cast.length] ?? table[1];
  const speakerIndex = Math.max(0, cartoon.cast.findIndex(member => member.speaking));
  const line = cartoon.line || content.lead || content.title;

  const gap = scaled(layout, 2.2);
  const cardFontSize = Math.round(ctx.heroFontSize * 0.32);
  // Карточка места стоит в том же верхнем углу, куда тянется облачко: без
  // вычета её высоты длинная реплика наезжает на неё.
  const cardHeight = cartoon.caption ? Math.round(cardFontSize * 1.5) + scaled(layout, 2.4) : 0;
  const bubbleBottom = frameHeight - groundY + charHeight + gap;
  const bubbleMaxHeight = Math.max(scaled(layout, 8), available - charHeight - gap * 2 - cardHeight);
  // Декорация кроет весь кадр, но реплика — нет: в вертикали интерфейс площадки
  // съедает края, и облачко, прижатое к краю кадра, читается уже под кнопками.
  // Поэтому границы облачка — safe zone, а не отступ «на глаз».
  const bubbleLimitLeft = layout.padLeft;
  const bubbleLimitRight = frameWidth - layout.padRight;
  const bubbleWidth = Math.min(
    Math.round(frameWidth * (layout.isNarrow ? 0.88 : 0.54)),
    bubbleLimitRight - bubbleLimitLeft
  );
  const speakerX = Math.round(frameWidth * positions[speakerIndex % positions.length]);
  const bubbleLeft = Math.min(
    Math.max(speakerX - Math.round(bubbleWidth / 2), bubbleLimitLeft),
    bubbleLimitRight - bubbleWidth
  );
  const tailLeft = Math.min(Math.max(speakerX - bubbleLeft, scaled(layout, 3)), bubbleWidth - scaled(layout, 3));
  const speakerName = cartoon.cast[speakerIndex]?.name ?? "";
  const bubblePadding = scaled(layout, 1.9);
  const nameHeight = speakerName ? scaled(layout, 3) : 0;
  const fontSize = fitBubbleFontSize({
    text: line,
    bubbleWidth: bubbleWidth - bubblePadding * 2,
    maxHeight: bubbleMaxHeight - bubblePadding * 2 - nameHeight,
    maxFontSize: Math.round(ctx.heroFontSize * 0.62)
  });

  const castLooks = resolveCastLooks(cartoon.cast);
  const cast = cartoon.cast.map((member, castIndex) => {
    const position = positions[castIndex % positions.length];
    return `<div class="toon-slot" style="--i:${castIndex};left:${Math.round(frameWidth * position)}px;">
      <svg width="${charWidth}" height="${charHeight}" viewBox="0 0 ${CHARACTER_VIEWBOX_WIDTH} ${CHARACTER_VIEWBOX_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
        ${renderCharacter({
          id: member.id,
          name: member.name,
          look: castLooks[castIndex],
          pose: member.pose,
          facing: position > 0.5 ? "left" : "right",
          index: castIndex
        })}
      </svg>
    </div>`;
  }).join("");

  return {
    stageFlex: "flex-direction:column;align-items:stretch;justify-content:flex-start;",
    stage: `<div class="toon">
      <svg class="toon-set" width="${frameWidth}" height="${frameHeight}" viewBox="0 0 ${frameWidth} ${frameHeight}" xmlns="http://www.w3.org/2000/svg">
        ${renderSetting({ setting: cartoon.setting, width: frameWidth, height: frameHeight, groundY, characterHeight: charHeight, seed: ctx.sceneIndex + 3 })}
      </svg>
      <div class="toon-veil"></div>
      ${cartoon.caption ? `<div class="toon-card">${escapeHtml(cartoon.caption)}</div>` : ""}
      ${cast}
      <svg class="toon-fore" width="${frameWidth}" height="${frameHeight}" viewBox="0 0 ${frameWidth} ${frameHeight}" xmlns="http://www.w3.org/2000/svg">
        ${renderForeground({ setting: cartoon.setting, width: frameWidth, height: frameHeight, groundY, characterHeight: charHeight })}
      </svg>
      ${line ? speechBubble({ text: line, speaker: speakerName, side: speakerX > frameWidth / 2 ? "right" : "left", fontSize, maxWidth: bubbleWidth }) : ""}
    </div>`,
    css: `
  /* Мультсцена занимает весь кадр, а не только safe-зону: рамка вокруг
     декорации выдала бы «слайд с картинкой» вместо кадра мультфильма. */
  .toon {
    position: absolute; left: ${-layout.padLeft}px; top: ${-layout.padTop}px;
    width: ${frameWidth}px; height: ${frameHeight}px; overflow: hidden;
  }
  .toon-set, .toon-fore { position: absolute; inset: 0; pointer-events: none; }
  /* Мультсцена кроет весь кадр, поэтому фирменная плашка поднимается над ней:
     иначе бренд исчезает ровно в тех роликах, где он нужнее всего. */
  .chrome-bar { z-index: 3; }
  .toon-fore { animation: rise-in 0.6s ease-out 0.2s backwards; }
  .toon-veil {
    position: absolute; inset: 0; pointer-events: none;
    background: linear-gradient(180deg, rgba(4, 9, 18, 0.66), rgba(4, 9, 18, 0) 22%, rgba(4, 9, 18, 0) 68%, rgba(4, 9, 18, 0.5));
  }
  .toon-slot {
    position: absolute; bottom: ${frameHeight - groundY}px;
    transform: translateX(-50%);
    animation: toon-enter 0.62s cubic-bezier(0.22, 0.9, 0.3, 1) calc(0.25s + var(--i) * 0.16s) backwards;
  }
  .toon-card {
    position: absolute; left: ${layout.padLeft}px; top: ${ceiling}px;
    background: rgba(4, 9, 18, 0.78); border-left: ${scaled(layout, 0.5)}px solid ${THEME.accentWarm};
    color: ${THEME.text}; font-size: ${cardFontSize}px; font-weight: 700;
    letter-spacing: 2px; text-transform: uppercase;
    padding: ${scaled(layout, 0.9)}px ${scaled(layout, 1.6)}px;
    animation: rise-in 0.5s ease-out 0.15s backwards;
  }
  .toon-bubble {
    position: absolute; left: ${bubbleLeft}px; bottom: ${bubbleBottom}px;
    width: ${bubbleWidth}px; max-height: ${bubbleMaxHeight}px;
    box-sizing: border-box; padding: ${bubblePadding}px ${Math.round(bubblePadding * 1.2)}px;
    background: #f4f8ff; color: #0a1120; border-radius: ${scaled(layout, 2.2)}px;
    box-shadow: 0 ${scaled(layout, 1.4)}px ${scaled(layout, 3.4)}px rgba(1, 6, 14, 0.55);
    animation: toon-pop 0.42s cubic-bezier(0.3, 1.5, 0.5, 1) 0.72s backwards;
  }
  .toon-speaker {
    color: #1c6f63; font-size: ${Math.round(fontSize * 0.62)}px; font-weight: 700;
    letter-spacing: 2px; text-transform: uppercase; margin-bottom: ${scaled(layout, 0.6)}px;
  }
  .toon-line { margin: 0; font-size: ${fontSize}px; line-height: 1.32; font-weight: 600; }
  /* Хвостик — повёрнутый квадрат того же цвета: без него облачко ничьё. */
  .toon-tail {
    position: absolute; bottom: ${-scaled(layout, 1.1)}px; left: ${tailLeft}px;
    width: ${scaled(layout, 2.4)}px; height: ${scaled(layout, 2.4)}px;
    margin-left: ${-scaled(layout, 1.2)}px;
    background: #f4f8ff; transform: rotate(45deg); border-radius: ${scaled(layout, 0.4)}px;
  }
  @keyframes toon-enter { from { opacity: 0; transform: translateX(-50%) translateY(${scaled(layout, 3)}px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
  @keyframes toon-pop { from { opacity: 0; transform: translateY(${scaled(layout, 1.4)}px) scale(0.92); } to { opacity: 1; transform: translateY(0) scale(1); } }
  @keyframes toon-far-drift { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(${scaled(layout, 0.8)}px); } }
  .toon-far { animation: toon-far-drift 26s ease-in-out 0s infinite; }
  .toon-plant { transform-box: fill-box; transform-origin: 50% 100%; animation: amb-sway 19s ease-in-out -3s infinite; }
  ${cartoon.setting === "void" ? "" : ".bd-stars, .bd-grid { opacity: 0; } .glow-a, .glow-b { opacity: 0.4; }"}
  ${cartoonCharacterCss()}`
  };
}

function buildPresenter(ctx) {
  const presenter = ctx.content.data.presenter;
  if (!presenter) throw new TypeError("Presenter scene requires sceneData.presenter with an id");
  const atlas = loadPresenterAtlas(presenter.id);
  const timeline = buildPresenterTimeline({
    beats: presenter.beats,
    frameWidth: ctx.layout.width,
    frameHeight: ctx.layout.height,
    atlas,
    startX: presenter.startX,
    durationMs: ctx.durationMs
  });
  return {
    stageFlex: "flex-direction:column;align-items:stretch;justify-content:flex-start;",
    stage: renderPresenterMarkup({
      timeline,
      atlas,
      beats: presenter.beats,
      originX: -ctx.layout.padLeft,
      originY: -ctx.layout.padTop
    }),
    css: presenterStageCss({ timeline })
  };
}

const BUILDERS = Object.freeze({
  classic: buildClassic,
  "cartoon-shot": buildCartoonShot,
  presenter: buildPresenter,
  statement: buildStatement,
  "device-mockup": buildDeviceMockup,
  "board-columns": buildBoardColumns,
  "format-trio": buildFormatTrio,
  checklist: buildChecklist,
  comparison: buildComparison,
  "stat-highlight": buildStatHighlight,
  "flow-steps": buildFlowSteps,
  quote: buildQuote,
  "metric-grid": buildMetricGrid
});

/**
 * Собирает сцену выбранного архетипа. Возвращает разметку сцены, её CSS и
 * раскладку контейнера .stage; всё остальное (фон, бренд-бар, заморозка по
 * `#t=`) остаётся на шелле.
 */
export function renderSceneArchetype({
  archetype,
  role = "body",
  content,
  layout,
  topic,
  sceneIndex = 0,
  sceneCount = 1,
  sceneTitles = [],
  heroFontSize,
  durationMs = 0
}) {
  const builder = BUILDERS[archetype];
  if (!builder) throw new RangeError(`Unsupported scene archetype: ${archetype}`);
  return builder({
    layout,
    content,
    role,
    topic,
    sceneIndex,
    sceneCount,
    sceneTitles,
    heroFontSize,
    durationMs,
    s: factor => scaled(layout, factor)
  });
}
