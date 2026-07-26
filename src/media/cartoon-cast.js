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

// Дома ниже людей: пока силуэты были вровень с персонажами, кадр читался как
// «человек внутри дома», а не «человек на фоне города».
function skyline({ width, height, seed }) {
  const random = seededRandom(seed);
  const buildings = [];
  let x = -40;
  while (x < width + 40) {
    const buildingWidth = Math.round(70 + random() * 120);
    const buildingHeight = Math.round(height * (0.12 + random() * 0.2));
    const top = height - buildingHeight;
    buildings.push(`<rect x="${x}" y="${top}" width="${buildingWidth}" height="${buildingHeight}" fill="#0d1b30"/>`);
    const windowRows = Math.floor(buildingHeight / 46);
    const windowCols = Math.max(1, Math.floor(buildingWidth / 42));
    for (let row = 0; row < windowRows; row += 1) {
      for (let col = 0; col < windowCols; col += 1) {
        if (random() < 0.42) continue;
        buildings.push(
          `<rect x="${x + 14 + col * 42}" y="${top + 18 + row * 46}" width="16" height="20" rx="2" fill="#f5b944" opacity="${(0.25 + random() * 0.5).toFixed(2)}"/>`
        );
      }
    }
    x += buildingWidth + Math.round(6 + random() * 22);
  }
  return buildings.join("");
}

/**
 * Декорация кадра. Каждая — самостоятельный слой, персонажи ставятся поверх.
 * `groundY` — линия пола: на ней стоят ноги, поэтому декорация обязана
 * согласовать с ней свою геометрию, иначе персонаж «висит».
 */
export function renderSetting({ setting = "void", width, height, groundY, seed = 1 } = {}) {
  const resolved = normalizeSetting(setting);
  const floor = Math.round(groundY);
  if (resolved === "street") {
    return `<rect x="0" y="0" width="${width}" height="${floor}" fill="#0a1426"/>
      <circle cx="${Math.round(width * 0.82)}" cy="${Math.round(floor * 0.22)}" r="${Math.round(Math.min(width, height) * 0.05)}" fill="#f2f6ff" opacity="0.85"/>
      <g class="toon-far">${skyline({ width, height: floor, seed })}</g>
      <rect x="0" y="${floor}" width="${width}" height="${height - floor}" fill="#141d2e"/>
      <rect x="0" y="${floor}" width="${width}" height="6" fill="#22304a"/>
      ${dashedRoad({ width, floor, height })}`;
  }
  if (resolved === "room" || resolved === "desk") {
    const scale = Math.max(1, width / 1100);
    // Стена светлее пола и отбита плинтусом: без разницы тона комната читалась
    // как та же пустота, только с рамками на ней.
    return `<rect x="0" y="0" width="${width}" height="${floor}" fill="#182a45"/>
      <rect x="0" y="${Math.round(floor * 0.62)}" width="${width}" height="${floor - Math.round(floor * 0.62)}" fill="#1c3150"/>
      <rect x="0" y="${floor - Math.round(10 * scale)}" width="${width}" height="${Math.round(10 * scale)}" fill="#24406a"/>
      <rect x="0" y="${floor}" width="${width}" height="${height - floor}" fill="#0a1220"/>
      ${windowFrame({ x: Math.round(width * 0.6), y: Math.round(floor * 0.14), w: Math.round(width * 0.2), h: Math.round(floor * 0.4), seed })}
      ${posterFrame({ x: Math.round(width * 0.12), y: Math.round(floor * 0.16), w: Math.round(width * 0.12), h: Math.round(floor * 0.26) })}
      ${shelf({ x: Math.round(width * 0.3), y: Math.round(floor * 0.34), w: Math.round(width * 0.16), scale, seed })}
      ${plant({ x: Math.round(width * 0.93), baseY: floor, scale })}`;
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
  if (resolved === "desk") {
    // Столешница на высоте пояса — иначе это не стол, а плинтус под ногами.
    // Персонажи закрыты по бёдра, ровно как человек, стоящий за столом.
    const topY = Math.round(floor - characterHeight * 0.42);
    const thickness = Math.max(8, Math.round(height * 0.016));
    const laptopWidth = Math.max(60, Math.round(characterHeight * 0.34));
    const laptopHeight = Math.round(laptopWidth * 0.66);
    const laptopX = Math.round(width * 0.54);
    const mugX = Math.round(width * 0.3);
    const mugSize = Math.max(14, Math.round(characterHeight * 0.075));
    return `<g class="toon-prop">
        <path d="M${laptopX},${topY} l${Math.round(laptopWidth * 0.12)},${-laptopHeight} h${Math.round(laptopWidth * 0.76)} l${Math.round(laptopWidth * 0.12)},${laptopHeight} z" fill="#16243c"/>
        <path d="M${laptopX + Math.round(laptopWidth * 0.19)},${topY - Math.round(laptopHeight * 0.12)} l${Math.round(laptopWidth * 0.08)},${-Math.round(laptopHeight * 0.74)} h${Math.round(laptopWidth * 0.6)} l${Math.round(laptopWidth * 0.08)},${Math.round(laptopHeight * 0.74)} z" fill="#2dd4bf" opacity="0.34"/>
      </g>
      <g class="toon-prop">
        <rect x="${mugX}" y="${topY - mugSize}" width="${mugSize}" height="${mugSize}" rx="${Math.round(mugSize * 0.22)}" fill="#f5b944"/>
        <path d="M${mugX + mugSize},${topY - Math.round(mugSize * 0.72)} q${Math.round(mugSize * 0.42)},${Math.round(mugSize * 0.24)} 0,${Math.round(mugSize * 0.48)}" fill="none" stroke="#f5b944" stroke-width="${Math.max(3, Math.round(mugSize * 0.14))}"/>
      </g>
      <rect x="${Math.round(width * -0.03)}" y="${topY}" width="${Math.round(width * 1.06)}" height="${thickness}" rx="${Math.round(thickness / 2)}" fill="#2b4260"/>
      <rect x="${Math.round(width * -0.03)}" y="${topY + thickness}" width="${Math.round(width * 1.06)}" height="${height - topY - thickness}" fill="#1a2b42"/>`;
  }
  if (resolved === "street") {
    const poleX = Math.round(width * 0.07);
    const poleWidth = Math.max(8, Math.round(width * 0.009));
    const lampY = Math.round(floor - characterHeight * 1.25);
    return `<rect x="${poleX}" y="${lampY}" width="${poleWidth}" height="${height - lampY}" fill="#1b2c44"/>
      <rect x="${poleX - Math.round(poleWidth * 2.2)}" y="${lampY}" width="${Math.round(poleWidth * 5.4)}" height="${Math.round(poleWidth * 2.2)}" rx="${poleWidth}" fill="#263c5c"/>
      <ellipse cx="${poleX + Math.round(poleWidth / 2)}" cy="${lampY + Math.round(poleWidth * 2.6)}" rx="${Math.round(poleWidth * 3.4)}" ry="${Math.round(poleWidth * 2.2)}" fill="#f5b944" opacity="0.55"/>`;
  }
  return "";
}

// Полка с корешками книг: дешёвая, но сразу говорит «здесь живут люди».
function shelf({ x, y, w, scale, seed }) {
  const random = seededRandom(seed + 41);
  const bookHeight = Math.round(26 * scale);
  const books = [];
  let cursor = x + Math.round(8 * scale);
  while (cursor < x + w - Math.round(10 * scale)) {
    const bookWidth = Math.round((7 + random() * 9) * scale);
    const height = Math.round(bookHeight * (0.7 + random() * 0.3));
    const color = SHELF_COLORS[Math.floor(random() * SHELF_COLORS.length) % SHELF_COLORS.length];
    books.push(`<rect x="${cursor}" y="${y - height}" width="${bookWidth}" height="${height}" rx="2" fill="${color}" opacity="0.8"/>`);
    cursor += bookWidth + Math.round(3 * scale);
  }
  return `${books.join("")}<rect x="${x}" y="${y}" width="${w}" height="${Math.round(7 * scale)}" rx="3" fill="#24406a"/>`;
}

function dashedRoad({ width, floor, height }) {
  const dashes = [];
  const y = Math.round(floor + (height - floor) * 0.52);
  for (let x = 20; x < width; x += 140) {
    dashes.push(`<rect x="${x}" y="${y}" width="72" height="7" rx="3" fill="#2a3c5c"/>`);
  }
  return dashes.join("");
}

function windowFrame({ x, y, w, h, seed }) {
  const random = seededRandom(seed + 17);
  const stars = [];
  for (let index = 0; index < 8; index += 1) {
    stars.push(
      `<circle cx="${x + Math.round(random() * w)}" cy="${y + Math.round(random() * h)}" r="2" fill="#cfe3ff" opacity="0.7"/>`
    );
  }
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="#0a1830"/>
    ${stars.join("")}
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="none" stroke="#24395c" stroke-width="6"/>
    <line x1="${x + Math.round(w / 2)}" y1="${y}" x2="${x + Math.round(w / 2)}" y2="${y + h}" stroke="#24395c" stroke-width="5"/>`;
}

function posterFrame({ x, y, w, h }) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="#132444" stroke="#26406a" stroke-width="4"/>
    <circle cx="${x + Math.round(w / 2)}" cy="${y + Math.round(h * 0.36)}" r="${Math.round(Math.min(w, h) * 0.18)}" fill="#2dd4bf" opacity="0.7"/>
    <rect x="${x + Math.round(w * 0.18)}" y="${y + Math.round(h * 0.62)}" width="${Math.round(w * 0.64)}" height="8" rx="4" fill="#7c5cff" opacity="0.7"/>`;
}

function plant({ x, baseY, scale }) {
  const s = scale;
  // Горшок — трапеция, сужающаяся книзу. Треугольник вершиной вниз читался
  // как стрелка, а не как кашпо.
  return `<g class="toon-plant">
    <path d="M${x - 26 * s},${baseY - 34 * s} L${x + 26 * s},${baseY - 34 * s} L${x + 19 * s},${baseY} L${x - 19 * s},${baseY} Z" fill="#24406a"/>
    <path d="M${x},${baseY - 34 * s} q-8,-46 -34,-64 q30,4 34,44 q6,-42 34,-52 q-22,26 -26,72 z" fill="#1f8f6d"/>
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
