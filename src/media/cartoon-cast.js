// Мультипликационный слой: векторные персонажи-марионетки и декорации.
//
// Почему марионетка, а не генеративное видео: кадры снимает тот же headless
// Chromium, и каждая анимация замораживается по `#t=`. Значит покадровая
// мультипликация здесь детерминирована по построению — тот же кадр при том же
// времени, без ключей, без сети и без «нейро-слопа».
//
// Ограничение слоя дизайна действует и тут: ни одного `url(`, никаких внешних
// ссылок, все SVG-заливки сплошные. Градиенты — только CSS.
//
// Внешность персонажа выводится ДЕТЕРМИНИРОВАННО из его id и имени. Это и есть
// преемственность сериала: `char-1` выглядит одинаково в первой серии и в
// десятой, даже если модель забыла повторить описание внешности.

import { escapeHtml, seededRandom } from "./scene-design.js";

export const CARTOON_POSES = Object.freeze([
  "idle",
  "talk",
  "point",
  "shrug",
  "think",
  "facepalm",
  "type",
  "cheer",
  "walk"
]);

export const CARTOON_SETTINGS = Object.freeze(["desk", "room", "street", "void"]);
export const CARTOON_HAIR_STYLES = Object.freeze(["short", "long", "bun", "curly", "cap", "bald"]);
export const CARTOON_ACCESSORIES = Object.freeze(["none", "glasses", "headphones"]);
export const CARTOON_BUILDS = Object.freeze(["slim", "regular", "broad"]);

export const CHARACTER_VIEWBOX_WIDTH = 200;
export const CHARACTER_VIEWBOX_HEIGHT = 420;

const SKIN_TONES = Object.freeze(["#f6cfae", "#eab68d", "#d19467", "#a9703f", "#7c4f2c"]);
const HAIR_COLORS = Object.freeze(["#221a14", "#4a2f1d", "#8c5426", "#d3ac68", "#8c8f9b", "#2f3a4d", "#b4553d"]);
const SHIRT_COLORS = Object.freeze(["#2dd4bf", "#7c5cff", "#f5b944", "#ff5d73", "#4f8dff", "#9ae66e", "#ef8354"]);
const TROUSER_COLORS = Object.freeze(["#1d2b45", "#26354f", "#33294a", "#1f3a3a"]);
const SHOE_COLOR = "#0d1626";
const SHELF_COLORS = Object.freeze(["#2dd4bf", "#7c5cff", "#f5b944", "#ff5d73", "#4f8dff"]);
const OUTLINE = "#0a1120";

// Плечи и бёдра — фиксированные точки: вокруг них вращаются конечности, и
// CSS-правила поз одни на всех персонажей. Телосложение меняет талию, изгиб
// торса и размер головы, а не точки крепления.
const SHOULDER_LEFT_X = 52;
const SHOULDER_RIGHT_X = 148;
const SHOULDER_Y = 158;
const HIP_LEFT_X = 82;
const HIP_RIGHT_X = 118;

const BUILD_FACTORS = Object.freeze({ slim: 0.9, regular: 1, broad: 1.12 });

// Рукав темнее рубашки: без разницы тона руки того же цвета сливаются с
// торсом, и персонаж читается как безрукий столбик.
function shade(hex, ratio) {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map(offset => Number.parseInt(value.slice(offset, offset + 2), 16));
  return `#${channels.map(channel => Math.round(channel * ratio).toString(16).padStart(2, "0")).join("")}`;
}

function hashString(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pickFrom(list, random) {
  return list[Math.floor(random() * list.length) % list.length];
}

function allowed(value, list) {
  return typeof value === "string" && list.includes(value) ? value : null;
}

/**
 * Внешность персонажа. Всё выводится из `id`+`name`, поэтому один и тот же
 * персонаж выглядит одинаково в любой сцене и в любой серии. `look` —
 * необязательное переопределение, каждое поле проверяется по своему словарю:
 * произвольный цвет из модели в разметку не попадает.
 */
export function resolveCharacterLook({ id = "", name = "", look = null } = {}) {
  const random = seededRandom(hashString(`${id}|${name}`));
  const derived = {
    skin: pickFrom(SKIN_TONES, random),
    hairColor: pickFrom(HAIR_COLORS, random),
    hairStyle: pickFrom(CARTOON_HAIR_STYLES, random),
    shirt: pickFrom(SHIRT_COLORS, random),
    trousers: pickFrom(TROUSER_COLORS, random),
    build: pickFrom(CARTOON_BUILDS, random),
    accessory: random() < 0.45 ? pickFrom(CARTOON_ACCESSORIES, random) : "none"
  };
  if (!look || typeof look !== "object") return Object.freeze(derived);
  return Object.freeze({
    skin: allowed(look.skin, SKIN_TONES) ?? derived.skin,
    hairColor: allowed(look.hairColor, HAIR_COLORS) ?? derived.hairColor,
    hairStyle: allowed(look.hairStyle, CARTOON_HAIR_STYLES) ?? derived.hairStyle,
    shirt: allowed(look.shirt, SHIRT_COLORS) ?? derived.shirt,
    trousers: allowed(look.trousers, TROUSER_COLORS) ?? derived.trousers,
    build: allowed(look.build, CARTOON_BUILDS) ?? derived.build,
    accessory: allowed(look.accessory, CARTOON_ACCESSORIES) ?? derived.accessory
  });
}

export function normalizePose(value) {
  return allowed(value, CARTOON_POSES) ?? "idle";
}

export function normalizeSetting(value) {
  return allowed(value, CARTOON_SETTINGS) ?? "void";
}

function hairMarkup(style, color) {
  switch (style) {
    case "long":
      return {
        back: `<path d="M56,74 Q54,150 62,186 L84,186 Q72,140 74,86 Z" fill="${color}"/>`
          + `<path d="M144,74 Q146,150 138,186 L116,186 Q128,140 126,86 Z" fill="${color}"/>`,
        front: `<path d="M58,76 Q58,26 100,26 Q142,26 142,76 Q132,46 100,42 Q68,46 58,76 Z" fill="${color}"/>`
      };
    case "bun":
      return {
        back: `<circle cx="100" cy="20" r="17" fill="${color}"/>`,
        front: `<path d="M59,74 Q60,30 100,30 Q140,30 141,74 Q130,48 100,44 Q70,48 59,74 Z" fill="${color}"/>`
      };
    case "curly":
      return {
        back: "",
        front: `<g fill="${color}">`
          + `<circle cx="70" cy="52" r="17"/><circle cx="92" cy="38" r="19"/>`
          + `<circle cx="114" cy="40" r="18"/><circle cx="133" cy="56" r="16"/>`
          + `<circle cx="61" cy="70" r="13"/><circle cx="139" cy="72" r="13"/>`
          + `</g>`
      };
    case "cap":
      return {
        back: "",
        front: `<path d="M57,66 Q58,24 100,24 Q142,24 143,66 Z" fill="${color}"/>`
          + `<path d="M143,66 Q176,66 178,78 L143,78 Z" fill="${color}"/>`
          + `<circle cx="100" cy="26" r="6" fill="${color}"/>`
      };
    case "bald":
      return {
        back: "",
        front: `<path d="M60,80 Q60,66 66,58 Q64,74 66,84 Z" fill="${color}" opacity="0.85"/>`
          + `<path d="M140,80 Q140,66 134,58 Q136,74 134,84 Z" fill="${color}" opacity="0.85"/>`
      };
    default:
      return {
        back: "",
        front: `<path d="M59,74 Q60,28 100,28 Q140,28 141,74 Q130,46 100,42 Q70,46 59,74 Z" fill="${color}"/>`
      };
  }
}

function accessoryMarkup(accessory) {
  if (accessory === "glasses") {
    return `<g class="tc-acc" fill="none" stroke="#101a2c" stroke-width="3.4">`
      + `<rect x="70" y="64" width="30" height="26" rx="9"/>`
      + `<rect x="104" y="64" width="30" height="26" rx="9"/>`
      + `<path d="M100,76 L104,76"/><path d="M70,72 L58,70"/><path d="M134,72 L146,70"/>`
      + `</g>`;
  }
  if (accessory === "headphones") {
    return `<g class="tc-acc">`
      + `<path d="M56,74 Q56,22 100,22 Q144,22 144,74" fill="none" stroke="#101a2c" stroke-width="8" stroke-linecap="round"/>`
      + `<rect x="44" y="66" width="20" height="34" rx="9" fill="#101a2c"/>`
      + `<rect x="136" y="66" width="20" height="34" rx="9" fill="#101a2c"/>`
      + `</g>`;
  }
  return "";
}

/**
 * Разметка одного персонажа. `index` разводит фазы дыхания и моргания, чтобы
 * двое в кадре не дышали в унисон — иначе это читается как одна кукла дважды.
 */
export function renderCharacter({ id = "", name = "", look = null, pose = "idle", facing = "right", index = 0 } = {}) {
  const appearance = resolveCharacterLook({ id, name, look });
  const resolvedPose = normalizePose(pose);
  const build = BUILD_FACTORS[appearance.build] ?? 1;
  const waistHalf = Math.round(50 * build);
  const headScale = appearance.build === "broad" ? 1.05 : appearance.build === "slim" ? 0.96 : 1;
  const hair = hairMarkup(appearance.hairStyle, appearance.hairColor);
  // Разворот живёт на внешней группе: у `.tc` собственный transform занят
  // бесконечным покачиванием, и анимация просто затёрла бы зеркальное отражение.
  const facingClass = facing === "left" ? "tc-face tc-face-left" : "tc-face";

  const torso = `M${100 - 46},170 Q${100 - 46},140 100,140 Q${100 + 46},140 ${100 + 46},170`
    + ` L${100 + waistHalf},266 Q100,280 ${100 - waistHalf},266 Z`;

  const sleeve = shade(appearance.shirt, 0.78);
  const arm = (side) => {
    const x = side === "left" ? SHOULDER_LEFT_X : SHOULDER_RIGHT_X;
    const elbowX = side === "left" ? x - 7 : x + 7;
    const handX = side === "left" ? elbowX - 5 : elbowX + 5;
    return `<g class="tc-arm tc-arm-${side}">
        <path d="M${x},${SHOULDER_Y} L${elbowX},206" stroke="${sleeve}" stroke-width="21" stroke-linecap="round" fill="none"/>
        <g class="tc-fore tc-fore-${side}">
          <path d="M${elbowX},206 L${handX},248" stroke="${sleeve}" stroke-width="18" stroke-linecap="round" fill="none"/>
          <circle cx="${handX}" cy="254" r="11" fill="${appearance.skin}"/>
        </g>
      </g>`;
  };

  const leg = (side) => {
    const x = side === "left" ? HIP_LEFT_X : HIP_RIGHT_X;
    const footX = side === "left" ? x - 3 : x + 3;
    return `<g class="tc-leg tc-leg-${side}">
        <path d="M${x},262 L${footX},396" stroke="${appearance.trousers}" stroke-width="26" stroke-linecap="round" fill="none"/>
        <ellipse cx="${footX + (side === "left" ? -4 : 4)}" cy="404" rx="19" ry="10" fill="${SHOE_COLOR}"/>
      </g>`;
  };

  return `<g class="${facingClass}"><g class="tc pose-${resolvedPose}" style="--i:${index}">
    ${arm("left")}
    ${leg("left")}
    ${leg("right")}
    <rect x="88" y="120" width="24" height="30" rx="10" fill="${appearance.skin}"/>
    <g class="tc-body">
      <path d="${torso}" fill="${appearance.shirt}"/>
      <path d="M86,142 Q100,162 114,142" fill="none" stroke="${OUTLINE}" stroke-width="2.6" opacity="0.35"/>
      <g class="tc-head" style="--head:${headScale}">
        ${hair.back}
        <ellipse cx="100" cy="80" rx="42" ry="46" fill="${appearance.skin}"/>
        <ellipse cx="57" cy="86" rx="7" ry="10" fill="${appearance.skin}"/>
        <ellipse cx="143" cy="86" rx="7" ry="10" fill="${appearance.skin}"/>
        <g class="tc-eyes">
          <ellipse cx="83" cy="78" rx="10" ry="11.5" fill="#ffffff"/>
          <ellipse cx="117" cy="78" rx="10" ry="11.5" fill="#ffffff"/>
          <circle class="tc-pupil" cx="84" cy="80" r="5" fill="${OUTLINE}"/>
          <circle class="tc-pupil" cx="118" cy="80" r="5" fill="${OUTLINE}"/>
        </g>
        <path class="tc-brow tc-brow-left" d="M73,60 Q83,54 93,59" fill="none" stroke="${appearance.hairColor}" stroke-width="4.2" stroke-linecap="round"/>
        <path class="tc-brow tc-brow-right" d="M107,59 Q117,54 127,60" fill="none" stroke="${appearance.hairColor}" stroke-width="4.2" stroke-linecap="round"/>
        <g class="tc-mouth">
          <path class="tc-mouth-closed" d="M86,104 Q100,114 114,104" fill="none" stroke="${OUTLINE}" stroke-width="3.6" stroke-linecap="round"/>
          <ellipse class="tc-mouth-mid" cx="100" cy="106" rx="11" ry="5" fill="${OUTLINE}"/>
          <ellipse class="tc-mouth-open" cx="100" cy="108" rx="13" ry="11" fill="${OUTLINE}"/>
        </g>
        ${hair.front}
        ${accessoryMarkup(appearance.accessory)}
      </g>
    </g>
    ${arm("right")}
  </g></g>`;
}

/**
 * CSS персонажей: позы задаются переменными углов, а сами правила поворота
 * общие. Точки вращения берутся из bounding box самой конечности
 * (`transform-box: fill-box`), поэтому одно правило работает для любого
 * телосложения — плечи и бёдра у всех в одних координатах.
 */
export function cartoonCharacterCss() {
  return `
  .tc { --arm-l: -5deg; --fore-l: -3deg; --arm-r: 5deg; --fore-r: 3deg; --head: 1; }
  /* Точки вращения заданы в координатах viewBox, а не по bounding box: у
     fill-box начало отсчёта — габарит самой конечности, из-за чего рука
     при повороте отрывалась от плеча. Суставы же — фиксированные числа. */
  .tc-face, .tc-arm, .tc-fore, .tc-leg, .tc-head, .tc-body, .tc-eyes, .tc-brow { transform-box: view-box; }
  .tc-face-left { transform: scaleX(-1); transform-origin: 100px 210px; }
  .tc-arm-left { transform: rotate(var(--arm-l)); transform-origin: ${SHOULDER_LEFT_X}px ${SHOULDER_Y}px; }
  .tc-arm-right { transform: rotate(var(--arm-r)); transform-origin: ${SHOULDER_RIGHT_X}px ${SHOULDER_Y}px; }
  .tc-fore-left { transform: rotate(var(--fore-l)); transform-origin: ${SHOULDER_LEFT_X - 7}px 206px; }
  .tc-fore-right { transform: rotate(var(--fore-r)); transform-origin: ${SHOULDER_RIGHT_X + 7}px 206px; }
  .tc-leg-left { transform-origin: ${HIP_LEFT_X}px 262px; }
  .tc-leg-right { transform-origin: ${HIP_RIGHT_X}px 262px; }
  .tc-head { transform-origin: 100px 126px; transform: scale(var(--head)); }
  .tc-body { transform-origin: 100px 268px; }
  .tc-eyes { transform-origin: 100px 78px; }
  .tc-brow-left { transform-origin: 83px 58px; }
  .tc-brow-right { transform-origin: 117px 58px; }
  .tc-mouth-mid, .tc-mouth-open { opacity: 0; }

  @keyframes tc-breathe { 0%, 100% { transform: scaleY(1); } 50% { transform: scaleY(1.012); } }
  @keyframes tc-sway { 0%, 100% { transform: translateY(0) rotate(-0.5deg); } 50% { transform: translateY(-4px) rotate(0.5deg); } }
  @keyframes tc-blink { 0%, 93.4%, 100% { transform: scaleY(1); } 95.2% { transform: scaleY(0.07); } 96.8% { transform: scaleY(1); } }
  @keyframes tc-nod { 0%, 100% { transform: scale(var(--head)) rotate(0deg); } 27% { transform: scale(var(--head)) rotate(-1.8deg) translateY(-1.5px); } 63% { transform: scale(var(--head)) rotate(1.4deg); } }

  /* Речь: три формы рта переключаются жёстко и неравномерно. Ровный метроном
     читается как механизм, поэтому цикл длинный и с рваным ритмом. */
  @keyframes tc-mouth-closed {
    0%, 7.9% { opacity: 1; } 8%, 37.9% { opacity: 0; } 38%, 43.9% { opacity: 1; }
    44%, 67.9% { opacity: 0; } 68%, 73.9% { opacity: 1; } 74%, 93.9% { opacity: 0; } 94%, 100% { opacity: 1; }
  }
  @keyframes tc-mouth-mid {
    0%, 18.9% { opacity: 0; } 19%, 25.9% { opacity: 1; } 26%, 43.9% { opacity: 0; }
    44%, 56.9% { opacity: 1; } 57%, 73.9% { opacity: 0; } 74%, 85.9% { opacity: 1; } 86%, 100% { opacity: 0; }
  }
  @keyframes tc-mouth-open {
    0%, 7.9% { opacity: 0; } 8%, 18.9% { opacity: 1; } 19%, 25.9% { opacity: 0; } 26%, 37.9% { opacity: 1; }
    38%, 56.9% { opacity: 0; } 57%, 67.9% { opacity: 1; } 68%, 85.9% { opacity: 0; }
    86%, 93.9% { opacity: 1; } 94%, 100% { opacity: 0; }
  }
  @keyframes tc-tap-a { 0%, 100% { transform: rotate(var(--fore-r)); } 50% { transform: rotate(calc(var(--fore-r) + 7deg)); } }
  @keyframes tc-tap-b { 0%, 100% { transform: rotate(calc(var(--fore-l) + 6deg)); } 50% { transform: rotate(var(--fore-l)); } }
  @keyframes tc-hop { 0%, 62%, 100% { transform: translateY(0); } 30% { transform: translateY(-16px); } }
  @keyframes tc-step-a { 0%, 100% { transform: rotate(19deg); } 50% { transform: rotate(-19deg); } }
  @keyframes tc-step-b { 0%, 100% { transform: rotate(-19deg); } 50% { transform: rotate(19deg); } }
  @keyframes tc-gesture { 0%, 100% { transform: rotate(var(--arm-r)); } 45% { transform: rotate(calc(var(--arm-r) - 16deg)); } }

  .tc { animation: tc-sway 6.4s ease-in-out calc(var(--i, 0) * -1.9s) infinite; }
  .tc-body { animation: tc-breathe 4.6s ease-in-out calc(var(--i, 0) * -1.3s) infinite; }
  .tc-eyes { animation: tc-blink 5.6s linear calc(var(--i, 0) * -2.3s) infinite; }

  .pose-talk .tc-mouth-closed { animation: tc-mouth-closed 1.45s linear calc(var(--i, 0) * -0.4s) infinite; }
  .pose-talk .tc-mouth-mid { animation: tc-mouth-mid 1.45s linear calc(var(--i, 0) * -0.4s) infinite; }
  .pose-talk .tc-mouth-open { animation: tc-mouth-open 1.45s linear calc(var(--i, 0) * -0.4s) infinite; }
  .pose-talk .tc-head { animation: tc-nod 2.9s ease-in-out calc(var(--i, 0) * -0.7s) infinite; }
  .pose-talk .tc-arm-right { animation: tc-gesture 3.4s ease-in-out calc(var(--i, 0) * -1.1s) infinite; }

  .pose-point { --arm-r: -64deg; --fore-r: -12deg; }
  .pose-shrug { --arm-r: -36deg; --fore-r: -76deg; --arm-l: 36deg; --fore-l: 76deg; }
  /* Углы подобраны по геометрии, а не на глаз: рука двухзвенная, и чтобы
     ладонь дошла до лица, предплечье обязано сложиться навстречу плечу. */
  .pose-think { --arm-r: -100deg; --fore-r: -126deg; }
  .pose-facepalm { --arm-r: -142deg; --fore-r: -92deg; }
  .pose-type { --arm-r: -20deg; --fore-r: 64deg; --arm-l: 20deg; --fore-l: -64deg; }
  .pose-cheer { --arm-r: -158deg; --fore-r: -10deg; --arm-l: 158deg; --fore-l: 10deg; }

  .pose-facepalm .tc-head { transform: scale(var(--head)) rotate(-7deg); }
  /* Закрытые глаза важнее моргания: жест без них читается как «рука у лба». */
  .pose-facepalm .tc-eyes { animation: none; transform: scaleY(0.14); }
  .pose-think .tc-brow-right { transform: translateY(-4px) rotate(-8deg); }
  .pose-shrug .tc-brow-left, .pose-shrug .tc-brow-right { transform: translateY(-5px); }
  .pose-type .tc-fore-right { animation: tc-tap-a 0.34s ease-in-out 0s infinite; }
  .pose-type .tc-fore-left { animation: tc-tap-b 0.34s ease-in-out 0s infinite; }
  .pose-cheer { animation: tc-hop 1.5s ease-in-out calc(var(--i, 0) * -0.5s) infinite; }
  .pose-walk .tc-leg-left { animation: tc-step-a 0.92s ease-in-out 0s infinite; }
  .pose-walk .tc-leg-right { animation: tc-step-b 0.92s ease-in-out 0s infinite; }
  .pose-walk .tc-arm-left { animation: tc-step-b 0.92s ease-in-out 0s infinite; }
  .pose-walk .tc-arm-right { animation: tc-step-a 0.92s ease-in-out 0s infinite; }`;
}

// Декорации строятся не от линии пола, а от линии горизонта. Пока всё считалось
// от пола, дальний план оказывался вровень с персонажами: город вырастал им по
// пояс, и кадр читался как «великаны над макетом», а не «люди на улице».
// Горизонт — на уровне глаз стоящего человека, всё дальнее уходит за него.
function horizonFor(floor, characterHeight) {
  return Math.round(floor - characterHeight * 0.62);
}

// Силуэты домов растут ВВЕРХ от горизонта: их основания скрыты за ним, как у
// настоящей улицы, поэтому высота задаётся в ростах человека, а не в долях кадра.
function skyline({ width, horizon, characterHeight, skyFloor = 0, seed }) {
  const random = seededRandom(seed);
  const parts = [];
  let x = -60;
  while (x < width + 60) {
    const buildingWidth = Math.round(characterHeight * (0.34 + random() * 0.5));
    const buildingHeight = Math.round(characterHeight * (0.28 + random() * 0.44));
    const top = Math.max(skyFloor, horizon - buildingHeight);
    parts.push(`<rect x="${x}" y="${top}" width="${buildingWidth}" height="${horizon - top + 8}" fill="#0d1b30"/>`);
    const step = Math.max(26, Math.round(characterHeight * 0.11));
    const windowSize = Math.max(8, Math.round(step * 0.36));
    const rows = Math.floor((horizon - top - step) / step);
    const cols = Math.max(1, Math.floor((buildingWidth - step * 0.5) / step));
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        if (random() < 0.45) continue;
        parts.push(
          `<rect x="${x + Math.round(step * 0.4) + col * step}" y="${top + Math.round(step * 0.6) + row * step}" width="${windowSize}" height="${Math.round(windowSize * 1.25)}" rx="2" fill="#f5b944" opacity="${(0.25 + random() * 0.5).toFixed(2)}"/>`
        );
      }
    }
    x += buildingWidth + Math.round(characterHeight * (0.04 + random() * 0.12));
  }
  return parts.join("");
}

/**
 * Декорация кадра. Каждая — самостоятельный слой, персонажи ставятся поверх.
 * `groundY` — линия пола: на ней стоят ноги, поэтому декорация обязана
 * согласовать с ней свою геометрию, иначе персонаж «висит».
 * `characterHeight` задаёт масштаб: мебель и дома меряются в человеке, а не в
 * долях кадра, иначе в вертикали комната растягивается, а в квадрате сплющивается.
 */
export function renderSetting({ setting = "void", width, height, groundY, characterHeight = 0, seed = 1 } = {}) {
  const resolved = normalizeSetting(setting);
  const floor = Math.round(groundY);
  const scale = Math.max(0.6, characterHeight / 520);
  if (resolved === "street") {
    const horizon = horizonFor(floor, characterHeight);
    const moonR = Math.round(characterHeight * 0.13);
    // Луна и крыши считаются от ВЕРХА кадра, а не от роста человека: иначе на
    // узком кадре они уезжают за границу и небо пропадает целиком.
    const moonY = Math.round(Math.max(moonR * 1.4, horizon * 0.18));
    return `<rect x="0" y="0" width="${width}" height="${horizon}" fill="#0a1426"/>
      <circle cx="${Math.round(width * 0.8)}" cy="${moonY}" r="${moonR}" fill="#f2f6ff" opacity="0.9"/>
      <circle cx="${Math.round(width * 0.8)}" cy="${moonY}" r="${Math.round(moonR * 2.1)}" fill="#f2f6ff" opacity="0.08"/>
      <g class="toon-far">${skyline({ width, horizon, characterHeight, skyFloor: Math.round(height * 0.22), seed })}</g>
      <rect x="0" y="${horizon}" width="${width}" height="${height - horizon}" fill="#101a2c"/>
      <rect x="0" y="${horizon}" width="${width}" height="${Math.max(3, Math.round(4 * scale))}" fill="#22304a"/>
      <rect x="0" y="${floor}" width="${width}" height="${height - floor}" fill="#141d2e"/>
      <rect x="0" y="${floor}" width="${width}" height="${Math.max(4, Math.round(6 * scale))}" fill="#26354f"/>
      ${dashedRoad({ width, from: horizon, to: floor, scale })}`;
  }
  if (resolved === "room" || resolved === "desk") {
    const rail = Math.round(floor - characterHeight * 1.05);
    const skirting = Math.max(8, Math.round(16 * scale));
    // Пол — не чёрный провал под ногами, а поверхность: свой тон, плинтус на
    // стыке и половицы, уходящие к зрителю.
    const boards = [];
    const boardStep = Math.max(28, Math.round(characterHeight * 0.16));
    for (let y = floor + boardStep; y < height; y += boardStep) {
      boards.push(`<rect x="0" y="${y}" width="${width}" height="${Math.max(2, Math.round(2 * scale))}" fill="#0f1c30" opacity="0.7"/>`);
    }
    const rugTop = floor + Math.round((height - floor) * 0.18);
    const rugInset = Math.round(width * 0.12);
    return `<rect x="0" y="0" width="${width}" height="${floor}" fill="#1d3252"/>
      <rect x="0" y="0" width="${width}" height="${Math.max(0, rail)}" fill="#22395c"/>
      <rect x="0" y="${rail}" width="${width}" height="${Math.max(3, Math.round(5 * scale))}" fill="#2b4a75"/>
      <rect x="0" y="${floor - skirting}" width="${width}" height="${skirting}" fill="#2b4a75"/>
      <rect x="0" y="${floor}" width="${width}" height="${height - floor}" fill="#16243c"/>
      ${boards.join("")}
      <path d="M${rugInset},${height} L${Math.round(width * 0.3)},${rugTop} H${Math.round(width * 0.7)} L${width - rugInset},${height} Z" fill="#1b3d5e" opacity="0.55"/>
      ${windowFrame({ x: Math.round(resolved === "desk" ? width * 0.5 + characterHeight * 0.5 : width * 0.5 - characterHeight * 0.31), y: Math.round(floor - characterHeight * 1.02), w: Math.round(characterHeight * 0.62), h: Math.round(characterHeight * 0.56), scale, seed })}
      ${posterFrame({ x: Math.round(width * 0.06), y: Math.round(floor - characterHeight * 0.98), w: Math.round(characterHeight * 0.3), h: Math.round(characterHeight * 0.4) })}
      ${shelf({ x: Math.round(width * 0.84), y: Math.round(floor - characterHeight * 0.72), w: Math.round(characterHeight * 0.46), scale, seed })}
      ${plant({ x: Math.round(width * 0.04 + characterHeight * 0.1), baseY: floor, scale })}`;
  }
  // `void` намеренно прозрачен: под ним остаётся фирменный звёздный фон шелла,
  // и мультсцена не выпадает из общего оформления ролика.
  return `<ellipse class="toon-far" cx="${Math.round(width * 0.5)}" cy="${floor}" rx="${Math.round(width * 0.42)}" ry="${Math.round(height * 0.05)}" fill="#0d1c33" opacity="0.85"/>
    <rect x="0" y="${floor}" width="${width}" height="4" fill="#1b3050" opacity="0.8"/>`;
}

/**
 * Передний план: то, что стоит МЕЖДУ зрителем и персонажами. Без этого слоя
 * стол невозможен — персонаж за столом обязан быть им частично закрыт,
 * иначе мебель читается как плинтус у него под ногами.
 */
export function renderForeground({ setting = "void", width, height, groundY, characterHeight = 0 } = {}) {
  const resolved = normalizeSetting(setting);
  const floor = Math.round(groundY);
  const scale = Math.max(0.6, characterHeight / 520);
  if (resolved === "desk") {
    // Столешница на высоте пояса — иначе это не стол, а плинтус под ногами.
    // Персонажи закрыты по бёдра, ровно как человек, стоящий за столом.
    const topY = Math.round(floor - characterHeight * 0.45);
    const thickness = Math.max(10, Math.round(22 * scale));
    const legWidth = Math.max(10, Math.round(26 * scale));
    const legInset = Math.round(width * 0.08);
    const laptopWidth = Math.max(90, Math.round(characterHeight * 0.56));
    const laptopBase = Math.max(6, Math.round(10 * scale));
    const screenHeight = Math.round(laptopWidth * 0.58);
    const laptopX = Math.round(width * 0.5 - characterHeight * 0.28);
    const mugSize = Math.max(16, Math.round(characterHeight * 0.09));
    const mugX = Math.round(width * 0.5 + characterHeight * 0.36);
    const paperW = Math.round(characterHeight * 0.24);
    const paperX = Math.round(width * 0.5 - characterHeight * 0.62);
    return `<g class="toon-prop">
        <rect x="${laptopX}" y="${topY - screenHeight}" width="${laptopWidth}" height="${screenHeight}" rx="${Math.round(6 * scale)}" fill="#16243c"/>
        <rect x="${laptopX + Math.round(laptopWidth * 0.06)}" y="${topY - screenHeight + Math.round(screenHeight * 0.1)}" width="${Math.round(laptopWidth * 0.88)}" height="${Math.round(screenHeight * 0.74)}" rx="${Math.round(3 * scale)}" fill="#2dd4bf" opacity="0.42"/>
        <rect x="${laptopX - Math.round(laptopWidth * 0.09)}" y="${topY - laptopBase}" width="${Math.round(laptopWidth * 1.18)}" height="${laptopBase}" rx="${Math.round(laptopBase / 2)}" fill="#22364f"/>
      </g>
      <g class="toon-prop">
        <rect x="${paperX}" y="${topY - Math.round(paperW * 0.12)}" width="${paperW}" height="${Math.round(paperW * 0.12)}" rx="2" fill="#dce6f7" opacity="0.85"/>
        <rect x="${paperX + Math.round(paperW * 0.06)}" y="${topY - Math.round(paperW * 0.2)}" width="${paperW}" height="${Math.round(paperW * 0.1)}" rx="2" fill="#c7d5ee" opacity="0.7"/>
      </g>
      <g class="toon-prop">
        <rect x="${mugX}" y="${topY - mugSize}" width="${mugSize}" height="${mugSize}" rx="${Math.round(mugSize * 0.22)}" fill="#f5b944"/>
        <path d="M${mugX + mugSize},${topY - Math.round(mugSize * 0.72)} q${Math.round(mugSize * 0.42)},${Math.round(mugSize * 0.24)} 0,${Math.round(mugSize * 0.48)}" fill="none" stroke="#f5b944" stroke-width="${Math.max(3, Math.round(mugSize * 0.14))}"/>
      </g>
      <rect x="${legInset}" y="${topY + thickness}" width="${legWidth}" height="${height - topY - thickness}" fill="#1a2b42"/>
      <rect x="${width - legInset - legWidth}" y="${topY + thickness}" width="${legWidth}" height="${height - topY - thickness}" fill="#1a2b42"/>
      <rect x="${Math.round(width * -0.03)}" y="${topY}" width="${Math.round(width * 1.06)}" height="${thickness}" rx="${Math.round(thickness / 2)}" fill="#33507a"/>
      <rect x="${Math.round(width * -0.03)}" y="${topY + thickness}" width="${Math.round(width * 1.06)}" height="${Math.max(3, Math.round(6 * scale))}" fill="#1f3352"/>`;
  }
  if (resolved === "street") {
    const poleX = Math.round(width * 0.09);
    const poleWidth = Math.max(10, Math.round(15 * scale));
    // Лампа не выше верхней трети кадра: столб, уходящий за границу, читается
    // как случайная палка, а не как фонарь.
    const lampY = Math.round(Math.max(height * 0.36, floor - characterHeight * 1.35));
    return `<rect x="${poleX}" y="${lampY}" width="${poleWidth}" height="${height - lampY}" fill="#1b2c44"/>
      <rect x="${poleX - Math.round(poleWidth * 2.2)}" y="${lampY}" width="${Math.round(poleWidth * 5.4)}" height="${Math.round(poleWidth * 2.2)}" rx="${poleWidth}" fill="#263c5c"/>
      <ellipse cx="${poleX + Math.round(poleWidth / 2)}" cy="${lampY + Math.round(poleWidth * 2.6)}" rx="${Math.round(poleWidth * 3.4)}" ry="${Math.round(poleWidth * 2.4)}" fill="#f5b944" opacity="0.6"/>
      <ellipse cx="${poleX + Math.round(poleWidth / 2)}" cy="${lampY + Math.round(poleWidth * 3)}" rx="${Math.round(poleWidth * 9)}" ry="${Math.round(poleWidth * 7)}" fill="#f5b944" opacity="0.1"/>`;
  }
  return "";
}

// Полка с корешками книг: дешёвая, но сразу говорит «здесь живут люди».
function shelf({ x, y, w, scale, seed }) {
  const random = seededRandom(seed + 41);
  const bookHeight = Math.round(38 * scale);
  const books = [];
  let cursor = x + Math.round(8 * scale);
  while (cursor < x + w - Math.round(10 * scale)) {
    const bookWidth = Math.round((9 + random() * 11) * scale);
    const height = Math.round(bookHeight * (0.7 + random() * 0.3));
    const color = SHELF_COLORS[Math.floor(random() * SHELF_COLORS.length) % SHELF_COLORS.length];
    books.push(`<rect x="${cursor}" y="${y - height}" width="${bookWidth}" height="${height}" rx="2" fill="${color}" opacity="0.8"/>`);
    cursor += bookWidth + Math.round(3 * scale);
  }
  return `${books.join("")}<rect x="${x}" y="${y}" width="${w}" height="${Math.round(9 * scale)}" rx="3" fill="#2b4a75"/>`;
}

// Разметка уходит к горизонту: штрихи короче и чаще у дальнего края, иначе
// дорога читается как плоская полоса под ногами.
function dashedRoad({ width, from, to, scale }) {
  const dashes = [];
  const rows = 4;
  for (let row = 0; row < rows; row += 1) {
    const t = (row + 1) / (rows + 1);
    const y = Math.round(from + (to - from) * t * t);
    const dashWidth = Math.round((26 + 90 * t) * scale);
    const gap = Math.round(dashWidth * 1.6);
    for (let x = Math.round(-dashWidth * t * 4); x < width; x += dashWidth + gap) {
      dashes.push(`<rect x="${x}" y="${y}" width="${dashWidth}" height="${Math.max(2, Math.round(6 * scale * t))}" rx="3" fill="#2a3c5c" opacity="${(0.35 + t * 0.5).toFixed(2)}"/>`);
    }
  }
  return dashes.join("");
}

function windowFrame({ x, y, w, h, scale, seed }) {
  const random = seededRandom(seed + 17);
  const stars = [];
  for (let index = 0; index < 10; index += 1) {
    stars.push(
      `<circle cx="${x + Math.round(random() * w)}" cy="${y + Math.round(random() * h)}" r="${Math.max(2, Math.round(2.5 * scale))}" fill="#cfe3ff" opacity="0.7"/>`
    );
  }
  const stroke = Math.max(4, Math.round(7 * scale));
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.round(10 * scale)}" fill="#0a1830"/>
    ${stars.join("")}
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.round(10 * scale)}" fill="none" stroke="#2b4a75" stroke-width="${stroke}"/>
    <line x1="${x + Math.round(w / 2)}" y1="${y}" x2="${x + Math.round(w / 2)}" y2="${y + h}" stroke="#2b4a75" stroke-width="${Math.max(3, stroke - 2)}"/>
    <line x1="${x}" y1="${y + Math.round(h / 2)}" x2="${x + w}" y2="${y + Math.round(h / 2)}" stroke="#2b4a75" stroke-width="${Math.max(3, stroke - 2)}"/>`;
}

function posterFrame({ x, y, w, h }) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="#132444" stroke="#2b4a75" stroke-width="4"/>
    <circle cx="${x + Math.round(w / 2)}" cy="${y + Math.round(h * 0.36)}" r="${Math.round(Math.min(w, h) * 0.2)}" fill="#2dd4bf" opacity="0.7"/>
    <rect x="${x + Math.round(w * 0.18)}" y="${y + Math.round(h * 0.64)}" width="${Math.round(w * 0.64)}" height="${Math.max(6, Math.round(h * 0.05))}" rx="4" fill="#7c5cff" opacity="0.7"/>`;
}

function plant({ x, baseY, scale }) {
  const s = scale;
  // Горшок — трапеция, сужающаяся книзу. Треугольник вершиной вниз читался
  // как стрелка, а не как кашпо.
  return `<g class="toon-plant">
    <path d="M${x - 26 * s},${baseY - 34 * s} L${x + 26 * s},${baseY - 34 * s} L${x + 19 * s},${baseY} L${x - 19 * s},${baseY} Z" fill="#24406a"/>
    <path d="M${x},${baseY - 34 * s} q${-8 * s},${-46 * s} ${-34 * s},${-64 * s} q${30 * s},${4 * s} ${34 * s},${44 * s} q${6 * s},${-42 * s} ${34 * s},${-52 * s} q${-22 * s},${26 * s} ${-26 * s},${72 * s} z" fill="#1f8f6d"/>
  </g>`;
}

/** Реплика в облачке. Хвостик направлен к говорящему. */
export function speechBubble({ text, speaker = "", side = "left", fontSize, maxWidth }) {
  const safeText = escapeHtml(String(text ?? ""));
  const label = speaker ? `<div class="toon-speaker">${escapeHtml(speaker)}</div>` : "";
  return `<div class="toon-bubble toon-bubble-${side === "right" ? "right" : "left"}" style="--bw:${maxWidth}px;--bf:${fontSize}px;">
      ${label}
      <p class="toon-line">${safeText}</p>
      <span class="toon-tail" aria-hidden="true"></span>
    </div>`;
}
