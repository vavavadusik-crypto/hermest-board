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

import { NODE_COLORS, THEME, clampText, escapeHtml, scaled } from "./scene-design.js";

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

function topicDiagram({ centerLabel, orbitLabels, activeIndex, size }) {
  const half = size / 2;
  const orbitRadius = half * 0.72;
  const nodes = orbitLabels.map((label, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(orbitLabels.length, 1) - Math.PI / 2;
    const x = half + orbitRadius * Math.cos(angle);
    const y = half + orbitRadius * Math.sin(angle);
    const color = accentColor(index);
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

function buildClassic(ctx) {
  const { layout, content, topic, sceneIndex, sceneTitles } = ctx;
  const diagramSize = layout.isVertical
    ? Math.round(layout.width * 0.68)
    : Math.round(layout.height * 0.52);
  const diagram = topicDiagram({
    centerLabel: topic,
    orbitLabels: sceneTitles.slice(0, 6),
    activeIndex: sceneIndex,
    size: diagramSize
  });
  return {
    stageFlex: layout.isVertical
      ? "flex-direction:column;align-items:center;text-align:center;gap:48px;"
      : "flex-direction:row;align-items:center;justify-content:space-between;gap:64px;",
    stage: `${headlineBlock({ topic, title: content.title, lead: content.lead })}
    <div class="diagram-panel"><div class="dg-drift">${diagram}</div></div>`,
    css: `
  .headline { max-width: ${layout.isVertical ? "100%" : "46%"}; }
  .diagram-panel {
    background: ${THEME.panel}; border: 1px solid ${THEME.panelBorder}; border-radius: 18px;
    padding: ${Math.round(diagramSize * 0.06)}px;
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
  .dg-node { animation: node-in 0.5s cubic-bezier(0.22, 0.9, 0.3, 1) calc(1.08s + var(--i) * 0.16s) backwards; }
  .dg-label { animation: label-in 0.4s ease-out calc(1.2s + var(--i) * 0.16s) backwards; }
  .dg-node-active { animation: node-in 0.5s cubic-bezier(0.22, 0.9, 0.3, 1) calc(1.08s + var(--i) * 0.16s) backwards, node-pulse 2.6s ease-in-out calc(2.2s + var(--i) * 0.16s) infinite; }`
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
  const ruleWidth = s(layout.isVertical ? 34 : 26);
  const auraSize = Math.round(Math.min(layout.width, layout.height) * 0.9);
  const cta = content.data.cta ? `<div class="st-cta">${escapeHtml(content.data.cta)}</div>` : "";
  const closing = role === "closing";
  return {
    stageFlex: `flex-direction:column;align-items:${layout.isVertical || closing ? "center" : "flex-start"};justify-content:center;text-align:${layout.isVertical || closing ? "center" : "left"};gap:0;`,
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
    left: ${layout.isVertical || closing ? "50%" : "22%"}; top: 50%;
    transform: translate(-50%, -50%);
    background: radial-gradient(circle, rgba(45, 212, 191, 0.16), rgba(124, 92, 255, 0.06) 55%, rgba(5, 11, 22, 0) 72%);
    filter: blur(${s(3)}px);
    animation: amb-breathe 13s ease-in-out 0s infinite;
  }
  .a-statement { position: relative; max-width: ${layout.isVertical || closing ? "100%" : "82%"}; animation: amb-float 15s ease-in-out 0s infinite; }
  .a-statement h1 { font-size: ${Math.round(ctx.heroFontSize * 1.06)}px; }
  .st-w { display: inline-block; animation: rise-in 0.62s cubic-bezier(0.22, 0.9, 0.3, 1) calc(0.28s + var(--i) * 0.085s) backwards; }
  .st-rule {
    height: ${s(0.7)}px; width: ${ruleWidth}px; margin: ${s(2)}px ${layout.isVertical || closing ? "auto" : "0"} ${s(2.6)}px;
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
  const kind = device.kind === "phone" || (layout.isVertical && device.kind !== "laptop") ? "phone" : "laptop";
  const uiTitle = device.title || clampText(content.title, 28);
  const rows = (device.lines?.length ? device.lines : content.bullets).slice(0, 4);
  const screenWidth = kind === "phone"
    ? Math.round(Math.min(layout.stageWidth * (layout.isVertical ? 0.62 : 0.3), layout.stageHeight * 0.46))
    : Math.round(layout.isVertical ? layout.stageWidth * 0.94 : layout.stageWidth * 0.52);
  const screenHeight = kind === "phone"
    ? Math.round(screenWidth * 1.9)
    : Math.round(screenWidth * 0.61);
  const copyFirst = layout.isVertical || sceneIndex % 2 === 0;
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
  const copy = headlineBlock({ topic, title: content.title, lead: content.lead, className: "headline dv-copy" });
  return {
    stageFlex: layout.isVertical
      ? "flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:0;"
      : `flex-direction:row;align-items:center;justify-content:space-between;gap:${s(5)}px;`,
    stage: copyFirst ? `${copy}\n    ${deviceHtml}` : `${deviceHtml}\n    ${copy}`,
    css: `
  .dv-copy { max-width: ${layout.isVertical ? "100%" : "42%"}; margin-bottom: ${layout.isVertical ? `${s(3.4)}px` : "0"}; }
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
    animation: rise-in 0.45s cubic-bezier(0.22, 0.9, 0.3, 1) calc(1.25s + var(--i) * 0.19s) backwards;
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
    width: ${Math.round(screenWidth * 1.14)}px; height: ${s(1.5)}px; margin: ${s(0.5)}px auto 0;
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
  @keyframes dv-blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }`
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
  ).slice(0, layout.isVertical ? 3 : 4);
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
  .bc-copy { max-width: 100%; margin-bottom: ${s(2.6)}px; }
  .bc-copy h1 { font-size: ${Math.round(ctx.heroFontSize * 0.82)}px; }
  .bc-board {
    display: flex; flex-direction: ${layout.isVertical ? "column" : "row"}; gap: ${s(1.8)}px;
    animation: panel-in 0.7s cubic-bezier(0.22, 0.9, 0.3, 1) 0.5s backwards;
  }
  .bc-lane {
    flex: 1; display: flex; flex-direction: ${layout.isVertical ? "row" : "column"};
    align-items: ${layout.isVertical ? "center" : "stretch"};
    gap: ${s(1.2)}px; border-radius: ${s(1.4)}px; padding: ${s(1.4)}px;
    ${panelSurface()}
    animation: rise-in 0.55s cubic-bezier(0.22, 0.9, 0.3, 1) calc(0.62s + var(--i) * 0.14s) backwards;
  }
  .bc-head {
    display: flex; align-items: center; gap: ${s(0.8)}px;
    color: ${THEME.text}; font-size: ${s(1.7)}px; font-weight: 700;
    ${layout.isVertical ? `width: 30%; flex: none;` : ""}
  }
  .bc-chip { width: ${s(0.9)}px; height: ${s(0.9)}px; border-radius: ${s(0.3)}px; flex: none; }
  .bc-cards { display: flex; flex-direction: ${layout.isVertical ? "row" : "column"}; gap: ${s(1)}px; flex: 1; }
  .bc-card {
    position: relative; display: flex; align-items: center; gap: ${s(0.8)}px; flex: 1;
    padding: ${s(1)}px ${s(1.1)}px; border-radius: ${s(0.9)}px;
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
    38%, 62% { transform: translate3d(${layout.isVertical ? `0, ${s(6)}px` : `${s(11)}px, 0`}, 0); }
    88%, 100% { transform: translate3d(0, 0, 0); }
  }`
  };
}

// ---------------------------------------------------------------------------
// format-trio — три формата кадра рядом: 16:9, 9:16, 1:1.
// ---------------------------------------------------------------------------

function buildFormatTrio(ctx) {
  const { layout, content, topic, s } = ctx;
  const labels = content.data.formats?.length ? content.data.formats.slice(0, 3) : ["16:9", "9:16", "1:1"];
  const ratios = [[16, 9], [9, 16], [1, 1]];
  const base = layout.isVertical
    ? Math.round(layout.stageWidth * 0.42)
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
    display: flex; flex-wrap: ${layout.isVertical ? "wrap" : "nowrap"};
    align-items: flex-end; justify-content: center; gap: ${s(2.6)}px;
  }
  .ft-item {
    margin: 0; display: flex; flex-direction: column; align-items: center; gap: ${s(1.2)}px;
    animation: panel-in 0.65s cubic-bezier(0.22, 0.9, 0.3, 1) calc(0.6s + var(--i) * 0.18s) backwards, amb-float 9s ease-in-out calc(var(--i) * -2.4s) infinite;
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
    color: ${THEME.textMuted}; font-size: ${s(1.9)}px; font-weight: 700; letter-spacing: 2px;
    animation: rise-in 0.45s ease-out calc(1.05s + var(--i) * 0.18s) backwards;
  }`
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
    stageFlex: layout.isVertical
      ? "flex-direction:column;align-items:stretch;justify-content:center;gap:0;"
      : `flex-direction:row;align-items:center;justify-content:space-between;gap:${s(5)}px;`,
    stage: `${headlineBlock({ topic, title: content.title, lead: layout.isVertical ? "" : content.lead, className: "headline cl-copy" })}
    <ul class="cl-list">${rowsHtml}<li class="cl-sweep"></li></ul>`,
    css: `
  .cl-copy { max-width: ${layout.isVertical ? "100%" : "40%"}; margin-bottom: ${layout.isVertical ? `${s(3)}px` : "0"}; }
  .cl-list {
    position: relative; overflow: hidden; list-style: none; margin: 0; padding: ${s(1.8)}px;
    display: flex; flex-direction: column; gap: ${s(1.2)}px;
    flex: ${layout.isVertical ? "none" : "1"}; border-radius: ${s(1.6)}px;
    ${panelSurface()}
    animation: panel-in 0.7s cubic-bezier(0.22, 0.9, 0.3, 1) 0.5s backwards;
  }
  .cl-row {
    display: flex; align-items: center; gap: ${s(1.3)}px;
    padding: ${s(1.1)}px ${s(1.2)}px; border-radius: ${s(0.9)}px;
    background: rgba(17, 32, 54, 0.6); border: 1px solid rgba(36, 64, 95, 0.6);
    animation: rise-in 0.5s cubic-bezier(0.22, 0.9, 0.3, 1) calc(0.75s + var(--i) * 0.2s) backwards;
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
  @keyframes cl-sweep { 0% { transform: translateY(-100%); } 100% { transform: translateY(${Math.max(items.length, 1) * 100}%); } }`
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
  .cp-copy { max-width: 100%; margin-bottom: ${s(2.8)}px; text-align: ${layout.isVertical ? "center" : "left"}; }
  .cp-copy h1 { font-size: ${Math.round(ctx.heroFontSize * 0.86)}px; }
  .cp-split {
    display: flex; flex-direction: ${layout.isVertical ? "column" : "row"};
    align-items: stretch; gap: ${s(2)}px;
  }
  .cp-side {
    flex: 1; display: flex; flex-direction: column; gap: ${s(1.2)}px;
    padding: ${s(2.2)}px; border-radius: ${s(1.6)}px;
    ${panelSurface()}
  }
  .cp-before {
    border-color: rgba(255, 93, 115, 0.45);
    animation: cp-in-before 0.7s cubic-bezier(0.22, 0.9, 0.3, 1) 0.55s backwards, amb-breathe 12s ease-in-out 1.4s infinite;
  }
  .cp-after {
    border-color: rgba(45, 212, 191, 0.5);
    animation: cp-in-after 0.7s cubic-bezier(0.22, 0.9, 0.3, 1) 0.72s backwards, cp-glow 6.5s ease-in-out 1.6s infinite;
  }
  .cp-label {
    font-size: ${s(1.6)}px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase;
    color: ${THEME.textMuted};
  }
  .cp-before .cp-label { color: ${THEME.accentRed}; }
  .cp-after .cp-label { color: ${THEME.accent}; }
  .cp-text { color: ${THEME.text}; font-size: ${s(2.2)}px; line-height: 1.28; font-weight: 700; }
  .cp-items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: ${s(0.8)}px; }
  .cp-item {
    color: ${THEME.textMuted}; font-size: ${s(1.6)}px; padding-left: ${s(1.6)}px; position: relative;
    animation: rise-in 0.42s ease-out calc(1s + var(--i) * 0.14s) backwards;
  }
  .cp-divider {
    ${layout.isVertical
    ? `height: ${s(0.3)}px; width: 100%;`
    : `width: ${s(0.3)}px; align-self: stretch;`}
    border-radius: ${s(0.2)}px;
    background: linear-gradient(${layout.isVertical ? "90deg" : "180deg"}, rgba(45, 212, 191, 0), ${THEME.accent}, rgba(124, 92, 255, 0));
    animation: cp-divider 0.8s ease-out 0.9s backwards, amb-pulse 7s ease-in-out 1.8s infinite;
  }
  @keyframes cp-in-before { from { opacity: 0; transform: translate3d(${layout.isVertical ? `0, -${s(3)}px` : `-${s(4)}px, 0`}, 0); } to { opacity: 1; transform: translate3d(0, 0, 0); } }
  @keyframes cp-in-after { from { opacity: 0; transform: translate3d(${layout.isVertical ? `0, ${s(3)}px` : `${s(4)}px, 0`}, 0); } to { opacity: 1; transform: translate3d(0, 0, 0); } }
  @keyframes cp-divider { from { opacity: 0; transform: scale${layout.isVertical ? "X" : "Y"}(0.2); } to { opacity: 1; transform: none; } }
  @keyframes cp-glow {
    0%, 100% { box-shadow: 0 24px 60px rgba(1, 6, 14, 0.6), 0 0 0 rgba(45, 212, 191, 0); }
    50% { box-shadow: 0 24px 60px rgba(1, 6, 14, 0.6), 0 0 ${s(4)}px rgba(45, 212, 191, 0.3); }
  }`
  };
}

// ---------------------------------------------------------------------------
// stat-highlight / metric-grid — крупные цифры с набегающим счётчиком.
// ---------------------------------------------------------------------------

function counterMarkup({ number, className, id }) {
  // CSS-счётчик набегает по виртуальному времени, поэтому кадр остаётся
  // детерминированным. Нецелые значения счётчиком не набежать — тогда цифра
  // просто появляется целиком.
  if (!number.integer) {
    return { html: `<span class="${className}">${escapeHtml(number.raw)}</span>`, css: "" };
  }
  return {
    html: `<span class="${className} ${id}" aria-hidden="true"></span><span class="sr-value">${escapeHtml(number.raw)}</span>`,
    css: `
  @property --${id} { syntax: "<integer>"; initial-value: 0; inherits: false; }
  @keyframes run-${id} { from { --${id}: 0; } to { --${id}: ${number.value}; } }
  .${id} { counter-reset: ${id} var(--${id}); animation: run-${id} 1.5s cubic-bezier(0.16, 0.84, 0.24, 1) 0.6s backwards; }
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
  const ringSize = Math.round(Math.min(layout.stageWidth, layout.stageHeight) * (layout.isVertical ? 0.72 : 0.62));
  const circumference = (Math.PI * 2 * 52).toFixed(1);
  const counter = counterMarkup({ number, className: "sh-value", id: "shnum" });
  return {
    stageFlex: "flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:0;",
    stage: `<div class="sh-wrap">
      <div class="sh-halo"></div>
      <svg class="sh-ring" width="${ringSize}" height="${ringSize}" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle cx="60" cy="60" r="52" fill="none" stroke="#152840" stroke-width="5"/>
        <circle class="sh-arc" cx="60" cy="60" r="52" fill="none" stroke="${THEME.accent}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${circumference}" transform="rotate(-90 60 60)"/>
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
  .sh-figure {
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    gap: ${s(0.6)}px; color: ${THEME.text};
  }
  .sh-value { font-size: ${Math.round(ringSize * 0.34)}px; font-weight: 700; line-height: 1; letter-spacing: -2px; }
  .sh-unit { font-size: ${Math.round(ringSize * 0.14)}px; font-weight: 700; color: ${THEME.accent}; align-self: flex-start; margin-top: ${s(2)}px; }
  .sr-value { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .sh-kicker { animation: rise-in 0.5s ease-out 1.2s backwards; }
  .sh-title { font-size: ${Math.round(ctx.heroFontSize * 0.9)}px; animation: rise-in 0.55s cubic-bezier(0.22, 0.9, 0.3, 1) 1.32s backwards; }
  .sh-caption { animation: rise-in 0.5s ease-out 1.5s backwards; }
  @keyframes sh-arc { from { stroke-dashoffset: ${circumference}; } to { stroke-dashoffset: ${(Number(circumference) * 0.18).toFixed(1)}; } }${counter.css}`
  };
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
    const label = content.bullets[index] ?? content.bullets[0] ?? "";
    return `<div class="mg-tile" style="--i:${index};border-color:${accentColor(index)}">
        <div class="mg-figure">${counters[index].html}${number.unit ? `<span class="mg-unit">${escapeHtml(number.unit)}</span>` : ""}</div>
        ${label ? `<div class="mg-label">${escapeHtml(clampText(label, 46))}</div>` : ""}
      </div>`;
  }).join("");
  const columns = layout.isVertical ? Math.min(numbers.length, 2) : Math.min(numbers.length, 4);
  return {
    stageFlex: "flex-direction:column;align-items:stretch;justify-content:center;gap:0;",
    stage: `${headlineBlock({ topic, title: content.title, lead: "", className: "headline mg-copy" })}
    <div class="mg-grid">${tiles}</div>`,
    css: `
  .mg-copy { max-width: 100%; margin-bottom: ${s(3)}px; text-align: ${layout.isVertical ? "center" : "left"}; }
  .mg-copy h1 { font-size: ${Math.round(ctx.heroFontSize * 0.84)}px; }
  .mg-grid { display: grid; grid-template-columns: repeat(${columns}, minmax(0, 1fr)); gap: ${s(1.8)}px; }
  .mg-tile {
    display: flex; flex-direction: column; gap: ${s(1)}px;
    padding: ${s(2)}px; border-radius: ${s(1.5)}px;
    ${panelSurface()}
    border-left-width: ${s(0.4)}px;
    animation: panel-in 0.62s cubic-bezier(0.22, 0.9, 0.3, 1) calc(0.55s + var(--i) * 0.15s) backwards, amb-float 10s ease-in-out calc(var(--i) * -2.2s) infinite;
  }
  .mg-figure { display: flex; align-items: baseline; gap: ${s(0.5)}px; color: ${THEME.text}; }
  .mg-value { font-size: ${s(layout.isVertical ? 7 : 6)}px; font-weight: 700; line-height: 1; letter-spacing: -1px; }
  .mg-unit { font-size: ${s(2.4)}px; font-weight: 700; color: ${THEME.accent}; }
  .mg-label { color: ${THEME.textMuted}; font-size: ${s(1.5)}px; line-height: 1.3; }
  .sr-value { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }${counters.map(counter => counter.css).join("")}`
  };
}

// ---------------------------------------------------------------------------
// flow-steps — 3–5 шагов со стрелками, подсветка идёт по кругу.
// ---------------------------------------------------------------------------

function buildFlowSteps(ctx) {
  const { layout, content, topic, s } = ctx;
  const steps = (content.steps.length ? content.steps : content.bullets).slice(0, MAX_CHIPS);
  const cycleSeconds = (Math.max(steps.length, 1) * 1.6).toFixed(1);
  const arrow = layout.isVertical
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
  .fs-copy { max-width: 100%; margin-bottom: ${s(3)}px; text-align: ${layout.isVertical ? "center" : "left"}; }
  .fs-copy h1 { font-size: ${Math.round(ctx.heroFontSize * 0.84)}px; }
  .fs-flow {
    display: flex; flex-direction: ${layout.isVertical ? "column" : "row"};
    align-items: ${layout.isVertical ? "stretch" : "center"}; justify-content: center; gap: ${s(1.2)}px;
  }
  .fs-step {
    flex: 1; display: flex; align-items: center; gap: ${s(1.1)}px;
    padding: ${s(1.5)}px ${s(1.6)}px; border-radius: ${s(1.2)}px;
    ${panelSurface()}
    border-color: rgba(36, 64, 95, 0.8);
    animation: rise-in 0.5s cubic-bezier(0.22, 0.9, 0.3, 1) calc(0.6s + var(--i) * 0.16s) backwards,
      fs-active ${cycleSeconds}s ease-in-out calc(1.9s + var(--i) * ${(Number(cycleSeconds) / Math.max(steps.length, 1)).toFixed(2)}s) infinite;
  }
  .fs-index {
    width: ${s(2.8)}px; height: ${s(2.8)}px; flex: none; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    background: var(--c); color: #04211c; font-weight: 700; font-size: ${s(1.5)}px;
  }
  .fs-text { color: ${THEME.text}; font-size: ${s(1.6)}px; line-height: 1.28; }
  .fs-arrow {
    flex: none; ${layout.isVertical ? `width: ${s(2.4)}px; height: ${s(3.4)}px; align-self: center;` : `width: ${s(3.4)}px; height: ${s(2.4)}px;`}
  }
  .fs-line { animation: fs-draw 0.4s ease-out 1.15s backwards; }
  .fs-tip { animation: rise-in 0.3s ease-out 1.45s backwards; }
  @keyframes fs-draw { from { stroke-dashoffset: 26; } to { stroke-dashoffset: 0; } }
  @keyframes fs-active {
    0%, 100% { border-color: rgba(36, 64, 95, 0.8); transform: translate3d(0, 0, 0); }
    ${(100 / Math.max(steps.length, 1) / 2).toFixed(1)}% { border-color: var(--c); transform: translate3d(0, -${s(0.6)}px, 0); }
    ${(100 / Math.max(steps.length, 1)).toFixed(1)}% { border-color: rgba(36, 64, 95, 0.8); transform: translate3d(0, 0, 0); }
  }`
  };
}

// ---------------------------------------------------------------------------
// quote — оформленная цитата.
// ---------------------------------------------------------------------------

function buildQuote(ctx) {
  const { layout, content, topic, s } = ctx;
  const quote = content.quote ?? { text: content.lead || content.title, source: "" };
  const glyphSize = Math.round(Math.min(layout.width, layout.height) * 0.3);
  return {
    stageFlex: "flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:0;",
    stage: `<div class="qt-wrap">
      <div class="qt-glyph" aria-hidden="true">“</div>
      <div class="kicker qt-kicker">${escapeHtml(topic)}</div>
      <blockquote class="qt-text">${escapeHtml(quote.text)}</blockquote>
      ${quote.source ? `<div class="qt-source">${escapeHtml(quote.source)}</div>` : ""}
    </div>`,
    css: `
  .qt-wrap { position: relative; max-width: ${layout.isVertical ? "100%" : "82%"}; animation: amb-float 14s ease-in-out 0s infinite; }
  .qt-glyph {
    position: absolute; top: -${Math.round(glyphSize * 0.42)}px; left: 50%;
    transform: translateX(-50%);
    font-size: ${glyphSize}px; line-height: 1; color: rgba(45, 212, 191, 0.16);
    animation: amb-sway 18s ease-in-out 0s infinite;
  }
  .qt-kicker { position: relative; animation: rise-in 0.5s ease-out 0.3s backwards; }
  .qt-text {
    position: relative; margin: ${s(1.6)}px 0 0; color: ${THEME.text};
    font-size: ${Math.round(ctx.heroFontSize * 0.86)}px; line-height: 1.28; font-weight: 700;
    animation: rise-in 0.7s cubic-bezier(0.22, 0.9, 0.3, 1) 0.5s backwards;
  }
  .qt-source {
    position: relative; margin-top: ${s(2.6)}px; color: ${THEME.accent};
    font-size: ${Math.round(ctx.heroFontSize * 0.36)}px; font-weight: 700; letter-spacing: 2px;
    animation: rise-in 0.5s ease-out 0.95s backwards;
  }
  .qt-source::before { content: "— "; }`
  };
}

const BUILDERS = Object.freeze({
  classic: buildClassic,
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
  heroFontSize
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
    s: factor => scaled(layout, factor)
  });
}
