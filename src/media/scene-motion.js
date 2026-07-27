// Камера как отдельный слой сцены.
//
// Раньше движение внутри сцены заканчивалось через две секунды: элементы
// въезжали, и дальше десять секунд стоял неподвижный кадр, по которому ffmpeg
// вёл лёгкий zoompan. Отсюда и ощущение мёртвой картинки — глаз привыкает к
// статике за долю секунды, а голос продолжает рассказывать.
//
// Здесь движение живёт всю сцену и складывается из слоёв, идущих с разной
// скоростью: фон отстаёт от сцены. Разная скорость — это и есть параллакс, то
// есть ощущение глубины, которого у плоских слайдов нет.
//
// Камера считается в браузере, а не в ffmpeg: zoompan пересэмплировал уже
// готовый кадр и мылил мелкий текст, а здесь тот же наезд рисуется в исходном
// разрешении. Значения выводятся из номера сцены и seed — тот же проект даёт
// тот же кадр.
//
// Главный инвариант: сцена не выходит за защитную зону НИ В ОДИН момент
// движения. Наезд — величина относительная, поэтому ход камеры нормируется так,
// что максимум приходится ровно на границу зоны, а не за неё: путь 0.957→1.000
// смотрится тем же наездом, что и 1.000→1.045, но не заводит текст под
// интерфейс площадки. Фоновые слои, наоборот, всегда чуть крупнее кадра —
// иначе на краю появилась бы щель.

const CAMERA_MOVES = Object.freeze([
  { id: "push-in", from: { scale: 1, x: 0, y: 0 }, to: { scale: 1.045, x: 0, y: -0.4 }, origin: "50% 46%" },
  { id: "drift-left", from: { scale: 1.03, x: 0.7, y: 0 }, to: { scale: 1.048, x: -0.5, y: -0.2 }, origin: "42% 50%" },
  { id: "pull-back", from: { scale: 1.055, x: 0, y: 0.3 }, to: { scale: 1.006, x: 0, y: 0 }, origin: "50% 52%" },
  { id: "drift-right", from: { scale: 1.03, x: -0.7, y: 0 }, to: { scale: 1.048, x: 0.5, y: -0.2 }, origin: "58% 50%" },
  { id: "rise", from: { scale: 1.02, x: 0, y: 0.8 }, to: { scale: 1.05, x: 0, y: -0.5 }, origin: "50% 58%" }
]);

// Дальний план движется медленнее ближнего — так работает параллакс.
const BACKDROP_FACTOR = 0.34;
const GLOW_FACTOR = 0.6;
// Фоновые слои перекрывают кадр с запасом: сдвиг фона не должен обнажать край.
const BACKGROUND_OVERSCAN = 0.06;
// Камера не должна останавливаться посередине: кривая с ненулевой скоростью в
// конце оставляет кадр живым до самого стыка сцен.
const CAMERA_EASING = "cubic-bezier(0.25, 0.35, 0.4, 1)";
const MIN_CAMERA_SECONDS = 1.2;
const MAX_CAMERA_SECONDS = 600;

export function selectCameraMove({ sceneIndex = 0, role = "body", seed = 1 } = {}) {
  const index = Number.isSafeInteger(sceneIndex) && sceneIndex >= 0 ? sceneIndex : 0;
  // Открывающая сцена всегда наезжает, закрывающая всегда отъезжает: это
  // грамматика, а не украшение — зритель читает начало и конец без подписи.
  if (role === "opening") return CAMERA_MOVES[0];
  if (role === "closing") return CAMERA_MOVES[2];
  const offset = Number.isSafeInteger(seed) ? Math.abs(seed) % CAMERA_MOVES.length : 0;
  // Соседние сцены обязаны двигаться по-разному, иначе повтор читается как
  // зацикленная заставка.
  return CAMERA_MOVES[(index + offset) % CAMERA_MOVES.length];
}

/**
 * Ход камеры для слоя сцены: максимум масштаба приведён к единице, а сдвиг
 * ограничен запасом, который остаётся от неполного масштаба. Пока это
 * выполняется, слой физически не может выйти за свой прямоугольник.
 */
export function stageCameraKeyframes(move) {
  const peak = Math.max(move.from.scale, move.to.scale);
  return [move.from, move.to].map(point => {
    const scale = point.scale / peak;
    // Запас с каждой стороны — половина того, что осталось от полного размера.
    const slackPercent = ((1 - scale) / 2) * 100;
    return {
      scale,
      x: clamp(point.x, -slackPercent, slackPercent),
      y: clamp(point.y, -slackPercent, slackPercent)
    };
  });
}

/**
 * Готовит CSS камеры для одной сцены. Отдаётся всегда, в том числе для
 * статичного режима: там анимации глушатся общим правилом, а базовый стиль
 * оставляет слои ровно в том положении, где сцена заканчивается.
 */
export function buildCameraCss({
  sceneIndex = 0,
  role = "body",
  durationMs = 6000,
  seed = 1
} = {}) {
  const duration = cameraSeconds(durationMs).toFixed(3);
  const move = selectCameraMove({ sceneIndex, role, seed });
  const [stageFrom, stageTo] = stageCameraKeyframes(move);
  const background = factor => [move.from, move.to].map(point => ({
    scale: 1 + (point.scale - 1) * factor + BACKGROUND_OVERSCAN,
    x: point.x * factor,
    y: point.y * factor
  }));
  const [backdropFrom, backdropTo] = background(BACKDROP_FACTOR);
  const [glowFrom, glowTo] = background(GLOW_FACTOR);

  // Тот же приём, что у остальных build-in анимаций шелла: база слоя — это
  // КОНЕЦ движения, а keyframes с fill-mode backwards лишь ведут к нему от
  // начала. Поэтому выключенная анимация даёт ровно последний кадр сцены.
  return `
  /* Камера сцены: движение ${move.id}, ${duration}s на всю длину сцены. */
${keyframes("cam-stage", stageFrom)}
${keyframes("cam-back", backdropFrom)}
${keyframes("cam-glow", glowFrom)}
${layer(".stage", "cam-stage", move.origin, stageTo, duration)}
${layer(".backdrop", "cam-back", move.origin, backdropTo, duration)}
  .parallax-near { position: absolute; inset: 0; }
${layer(".parallax-near", "cam-glow", move.origin, glowTo, duration)}`;
}

function layer(selector, name, origin, endpoint, duration) {
  return `  ${selector} { transform-origin: ${origin}; transform: ${transform(endpoint)};`
    + ` animation: ${name} ${duration}s ${CAMERA_EASING} backwards; }`;
}

function keyframes(name, endpoint) {
  // Только `from`: конечное состояние берётся из базового стиля слоя.
  return `  @keyframes ${name} { from { transform: ${transform(endpoint)}; } }`;
}

function transform({ scale, x, y }) {
  return `translate3d(${x.toFixed(3)}%, ${y.toFixed(3)}%, 0) scale(${scale.toFixed(4)})`;
}

function cameraSeconds(durationMs) {
  const seconds = Number(durationMs) / 1000;
  if (!Number.isFinite(seconds) || seconds <= 0) return MIN_CAMERA_SECONDS;
  return Math.min(Math.max(seconds, MIN_CAMERA_SECONDS), MAX_CAMERA_SECONDS);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
