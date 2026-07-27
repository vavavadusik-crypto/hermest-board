// Доли сцены (beat track): элементы списка реагируют на то, о чём диктор
// говорит СЕЙЧАС, а не въезжают все разом в первые две секунды. Раньше сцена
// длиной 8–15 секунд замирала сразу после build-in, хотя голос шёл дальше.
//
// Кадр снимается со свежего документа, где каждая анимация поставлена на
// точное виртуальное время, поэтому доля — чистая функция времени: элемент k
// владеет окном [start_k, end_k), появляется в его начале, держит сдержанный
// акцент, пока окно идёт, и мягко приглушается, когда окно прошло.
//
// Соглашение то же, что у камеры и build-in слоёв шелла: база элемента — его
// КОНЕЧНОЕ состояние (отыгранная доля), а @keyframes с fill-mode backwards
// лишь ведут к нему от начала. Выключенные анимации дают ровно последний кадр
// сцены, и никакого JS-состояния между кадрами не существует.

// Хвост сцены всегда свободен: последняя доля заканчивается минимум за 0.4 с
// до конца, иначе акцент обрезался бы стыком со следующей сценой.
const TAIL_MS = 400;
// Вступление сцены занято шеллом и заголовком: доля первого элемента,
// начавшись раньше, утонула бы в общем появлении кадра.
const LEAD_MS = 900;
// Доля короче этой читается как мигание, а не как акцент.
const MIN_BEAT_MS = 300;

const FALLBACK_DURATION_MS = 6000;
const MIN_DURATION_MS = 1200;
const MAX_DURATION_MS = 600000;

// Подъём при акценте — единицы пикселей: больший сдвиг выталкивал бы элемент
// за границу контейнера на длинных сценах с высокими строками.
const ENTER_PX = 12;
const LIFT_PX = 3;
// Отыгравший элемент отступает, но не гаснет. На 0.66 к концу сцены весь
// список становился заметно бледнее прежнего — а последний кадр сцены идёт ещё
// и в обложку. Читаемость важнее глубины акцента: разницу с активной долей и
// так держат яркость с контрастом.
const REST_OPACITY = 0.82;
// Фильтры перечислены одним списком в обеих точках: brightness без contrast
// (или наоборот) интерполировался бы рывком, а не плавно.
const ACCENT_FILTER = "brightness(1.12) contrast(1.04)";
const REST_FILTER = "brightness(1) contrast(1)";

const ENTER_MS = 450;
const DIM_MS = 500;

function sceneDurationMs(durationMs) {
  const value = Number(durationMs);
  if (!Number.isFinite(value) || value <= 0) return FALLBACK_DURATION_MS;
  return Math.min(Math.max(value, MIN_DURATION_MS), MAX_DURATION_MS);
}

/**
 * Окна долей для `count` элементов внутри сцены длиной `durationMs`. Окна
 * идут подряд в порядке чтения, а последнее заканчивается минимум за TAIL_MS
 * до конца сцены. Длина окна округляется вниз до миллисекунды: округление
 * вверх могло бы съесть хвост сцены на длинных списках.
 */
export function planBeats({ durationMs, count } = {}) {
  const total = sceneDurationMs(durationMs);
  const n = Number.isSafeInteger(count) ? count : 0;
  if (n <= 0) return [];
  // На короткой сцене вступление сжимается: доли важнее паузы перед ними.
  const leadMs = Math.min(LEAD_MS, Math.max(0, total - TAIL_MS - n * MIN_BEAT_MS));
  const windowMs = Math.floor((total - TAIL_MS - leadMs) / n);
  return Array.from({ length: n }, (unused, index) => ({
    startMs: leadMs + index * windowMs,
    endMs: leadMs + (index + 1) * windowMs
  }));
}

// Проценты в keyframes: Number убирает хвостовые нули, чтобы строка была
// короткой, но детерминированной.
function percent(fraction) {
  return Number((fraction * 100).toFixed(2));
}

/**
 * CSS долей для элементов `selector`, у которых уже стоит `--i` с номером в
 * списке. Одно правило на весь список: окно элемента едет по `var(--i)`.
 * Пустой список отдаёт пустую строку, чтобы архетип вклеивал результат без
 * условий.
 */
export function buildBeatCss({ durationMs, count, selector, name = "beat" } = {}) {
  if (!/^[a-z][a-z0-9-]*$/u.test(String(name))) {
    throw new RangeError(`Beat track name must be a CSS identifier fragment: ${name}`);
  }
  const beats = planBeats({ durationMs, count });
  if (!beats.length || !selector) return "";
  const windowMs = beats[0].endMs - beats[0].startMs;
  const windowSec = (windowMs / 1000).toFixed(3);
  const leadSec = (beats[0].startMs / 1000).toFixed(3);
  // Доля делится на вход, долгое удержание акцента и мягкий спад в конце.
  const enterPct = percent(Math.min(ENTER_MS, windowMs * 0.3) / windowMs);
  const holdPct = percent(1 - Math.min(DIM_MS, windowMs * 0.35) / windowMs);
  return `
  @keyframes beat-${name} {
    0% { opacity: 0; transform: translateY(${ENTER_PX}px); }
    ${enterPct}% { opacity: 1; transform: translateY(-${LIFT_PX}px); filter: ${ACCENT_FILTER}; }
    ${holdPct}% { opacity: 1; transform: translateY(-${LIFT_PX}px); filter: ${ACCENT_FILTER}; }
    100% { opacity: ${REST_OPACITY}; transform: translateY(0); filter: ${REST_FILTER}; }
  }
  /* База — отыгранная доля: ровно тот кадр, который покажет сцена при
     выключенных анимациях. */
  ${selector} {
    opacity: ${REST_OPACITY};
    animation: beat-${name} ${windowSec}s ease-in-out calc(${leadSec}s + var(--i) * ${windowSec}s) backwards;
  }`;
}
