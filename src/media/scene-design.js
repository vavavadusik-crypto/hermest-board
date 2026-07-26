// Дизайн-токены и геометрия сцены: единственный источник цвета, шкалы и
// safe-zone-осведомлённой раскладки для шелла и всех архетипов.
//
// Ограничение всего слоя: разметка обязана быть самодостаточной. Ни одного
// `url(`, ни одной внешней ссылки — иначе кадр перестаёт собираться офлайн
// (это стережёт тест "scene markup contains no external network references").
// Практическое следствие: SVG-градиенты через fill="url(#id)" запрещены, все
// градиенты — CSS-овые, все SVG-заливки сплошные.

import { resolveSubtitleBand } from "./subtitle-band.js";

export const THEME = Object.freeze({
  background: "#050b16",
  panel: "rgba(11, 21, 38, 0.82)",
  panelBorder: "#1e2f4a",
  panelDeep: "rgba(6, 13, 26, 0.9)",
  text: "#e8eefc",
  textMuted: "#8fa3c8",
  accent: "#2dd4bf",
  accentAlt: "#7c5cff",
  accentWarm: "#f5b944",
  accentRed: "#ff5d73",
  captionBar: "rgba(4, 9, 18, 0.78)"
});

export const NODE_COLORS = Object.freeze(["#2dd4bf", "#7c5cff", "#f5b944", "#ff5d73", "#4f8dff", "#9ae66e"]);

export const MAX_TEXT_CHARS = 400;

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// mulberry32: deterministic star field for a given project seed.
export function seededRandom(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clampText(value, limit = MAX_TEXT_CHARS) {
  const text = String(value ?? "").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1)}…`;
}

// Заголовок и дикторский текст сравниваются без хвостовой пунктуации и
// регистра: сборщик нарратива добавляет к заголовку точку, поэтому дословное
// сравнение строк повтор не поймает.
export function sentenceKey(value) {
  return String(value ?? "")
    .trim()
    .replace(/[.!?…]+$/u, "")
    .toLocaleLowerCase();
}

export function splitSentences(value) {
  return String(value ?? "")
    .split(/(?<=[.!?…])\s+/)
    .map(sentence => sentence.trim())
    .filter(Boolean);
}

/**
 * Предложение целиком состоит из перечисления `items`? Тогда абзац и список в
 * одном кадре — это один и тот же текст дважды.
 */
function isCoveredByItems(sentence, items) {
  if (!items.length) return false;
  const rest = items.reduce((text, item) => text.replaceAll(item, " "), sentence);
  return !/[\p{L}\p{N}]/u.test(rest);
}

/**
 * Лид сцены: первое предложение, которое не повторяет ни заголовок, ни уже
 * разобранное перечисление. Второе условие и лечит кадр, где слева абзацем
 * стояли те же пять пунктов, что и списком справа.
 */
export function pickLeadSentence(narration, title, items = []) {
  const titleKey = sentenceKey(title);
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  return splitSentences(narration).find(
    sentence => sentenceKey(sentence) !== titleKey && !isCoveredByItems(sentence, list)
  ) ?? "";
}

function nonNegativeInset(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

// Высота точек прогресса в шелле: полоса субтитров, ряд точек и сцена стоят
// друг над другом, поэтому шеллу нужна не только высота полосы.
const PROGRESS_DOT_HEIGHT = 10;

/**
 * Геометрия кадра. Отступы сцены — максимум из исторического процента и
 * safe zone рецепта: без рецепта раскладка ровно текущая, с рецептом 9:16
 * перестаёт нарушать боковую защитную зону (54px против требуемых 96).
 *
 * Низ кадра больше не резервируется «на глаз» (было `height * 0.16` плюс ещё
 * 3%): `captionHeight` — измеренная высота выжигаемого субтитра из
 * subtitle-band.js, то есть ровно то, что займёт ffmpeg. Ниже сцены помещаются
 * ряд точек прогресса и сама полоса субтитров, и ничего не пересекается.
 */
export function resolveSceneLayout({ width, height, safeZones } = {}) {
  const safeWidth = Number(width);
  const safeHeight = Number(height);
  if (!Number.isSafeInteger(safeWidth) || safeWidth <= 0 || !Number.isSafeInteger(safeHeight) || safeHeight <= 0) {
    throw new TypeError("Scene markup requires positive width and height");
  }
  const safe = {
    top: nonNegativeInset(safeZones?.top),
    right: nonNegativeInset(safeZones?.right),
    bottom: nonNegativeInset(safeZones?.bottom),
    left: nonNegativeInset(safeZones?.left)
  };
  const isVertical = safeHeight > safeWidth;
  const unit = Math.max(1, Math.round(Math.min(safeWidth, safeHeight) / 100));
  // Без рецепта safe.bottom нет — тогда строка всё равно не должна лежать на
  // самой кромке, отсюда нижний порог в 5% высоты.
  const subtitleMarginBottom = Math.max(safe.bottom, Math.round(safeHeight * 0.05));
  const subtitle = resolveSubtitleBand({
    width: safeWidth,
    height: safeHeight,
    marginBottom: subtitleMarginBottom
  });
  const captionHeight = subtitle.bandHeight;
  const barPadX = Math.max(Math.round(safeWidth * 0.04), safe.left, safe.right);
  const barPadY = Math.max(Math.round(safeHeight * 0.028), safe.top);
  const barHeight = Math.round(Math.min(safeWidth, safeHeight) * 0.039);
  const padLeft = Math.max(Math.round(safeWidth * 0.05), safe.left);
  const padRight = Math.max(Math.round(safeWidth * 0.05), safe.right);
  const padTop = Math.max(Math.round(safeHeight * 0.14), barPadY + barHeight + Math.round(safeHeight * 0.02));
  const progressGap = Math.max(1, Math.round(Math.min(safeWidth, safeHeight) * 0.012));
  const progressBottom = captionHeight + progressGap;
  const stageClearance = Math.max(1, Math.round(Math.min(safeWidth, safeHeight) * 0.012));
  const padBottom = Math.max(
    progressBottom + PROGRESS_DOT_HEIGHT + stageClearance,
    safe.bottom
  );
  return {
    width: safeWidth,
    height: safeHeight,
    isVertical,
    unit,
    safe,
    captionHeight,
    subtitle,
    progressBottom,
    barPadX,
    barPadY,
    padLeft,
    padRight,
    padTop,
    padBottom,
    stageWidth: Math.max(1, safeWidth - padLeft - padRight),
    stageHeight: Math.max(1, safeHeight - padTop - padBottom)
  };
}

/** Размер в пикселях от короткой стороны кадра: одна шкала для 16:9 и 9:16. */
export function scaled(layout, factor) {
  return Math.max(1, Math.round(layout.unit * factor));
}

// Ambient-слой: медленное бесконечное движение, живущее ровно столько, сколько
// длится сцена. Кадры снимаются на всю длительность сцены, поэтому эти
// анимации не «умирают» на середине, как это было с фиксированным окном 2.8 с.
// Фазы разводятся отрицательными задержками через --i, поэтому элементы дышат
// не в унисон, а картинка остаётся детерминированной.
export function ambientCss(layout) {
  const driftX = scaled(layout, 1.1);
  const driftY = scaled(layout, 1.7);
  return `
  @keyframes amb-float { 0%, 100% { transform: translate3d(0, 0, 0); } 50% { transform: translate3d(0, -${scaled(layout, 0.7)}px, 0); } }
  @keyframes amb-breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.012); } }
  @keyframes amb-sway { 0%, 100% { transform: translate3d(-${driftX}px, 0, 0); } 50% { transform: translate3d(${driftX}px, ${driftY}px, 0); } }
  @keyframes amb-sheen { 0% { transform: translateX(-140%) skewX(-18deg); } 55%, 100% { transform: translateX(260%) skewX(-18deg); } }
  @keyframes amb-pulse { 0%, 100% { opacity: 0.32; } 50% { opacity: 0.85; } }
  .amb-float { animation: amb-float 9s ease-in-out calc(var(--i, 0) * -1.3s) infinite; }
  .amb-breathe { animation: amb-breathe 11s ease-in-out calc(var(--i, 0) * -1.7s) infinite; }
  .amb-sway { animation: amb-sway 16s ease-in-out calc(var(--i, 0) * -2.1s) infinite; }`;
}
