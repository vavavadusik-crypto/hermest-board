// Кот для мультслоя Hermest Board: структура рига и суставы, без движения.

export const CAT_VIEWBOX_WIDTH = 280;
export const CAT_VIEWBOX_HEIGHT = 260;

const OUTLINE = "#0a1120";

// Готовые внешности используют ту же тёмную обводку и семью акцентов, что и каст Board.
export const CAT_LOOKS = Object.freeze({
  ginger: Object.freeze({ fur: "#ef8354", belly: "#f6cfae", eyes: "#2dd4bf", innerEar: "#ffb3a6" }),
  smoke: Object.freeze({ fur: "#8c8f9b", belly: "#dce6f7", eyes: "#f5b944", innerEar: "#d7a9c5" }),
  midnight: Object.freeze({ fur: "#2f3a4d", belly: "#8998b8", eyes: "#7c5cff", innerEar: "#b796cf" })
});

function validLook(value) {
  return value && typeof value === "object" && Object.values(CAT_LOOKS).includes(value) ? value : CAT_LOOKS.ginger;
}

function styleFor(transforms, part) {
  const value = transforms?.[part];
  return value ? ` style="transform:${value}"` : "";
}

/**
 * SVG-марионетка кота. `transforms` — необязательный служебный вход для
 * статичной приёмки: значение становится инлайновым transform на части рига.
 */
export function renderCat({ look = CAT_LOOKS.ginger, facing = "right", transforms = null } = {}) {
  const colors = validLook(look);
  const faceClass = facing === "left" ? "ac-face ac-face-left" : "ac-face";
  const style = part => styleFor(transforms, part);
  const tailStroke = (d, width = 18) => `<path d="${d}" fill="none" stroke="${OUTLINE}" stroke-width="${width + 7}" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${colors.fur}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;

  return `<g class="${faceClass}"><g class="ac">
    <g class="ac-tail-1"${style("tail-1")}>
      ${tailStroke("M90,160 Q70,163 55,171")}
      <g class="ac-tail-2"${style("tail-2")}>
        ${tailStroke("M55,171 Q42,184 36,202")}
        <g class="ac-tail-3"${style("tail-3")}>
          ${tailStroke("M36,202 Q35,220 49,232", 16)}
        </g>
      </g>
    </g>
    <g class="ac-body"${style("body")}>
      <g class="ac-leg-bl"${style("leg-bl")}>
        <path d="M106,174 Q102,200 108,220 Q116,228 128,221" fill="none" stroke="${OUTLINE}" stroke-width="28" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M106,174 Q102,200 108,220 Q116,228 128,221" fill="none" stroke="${colors.belly}" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/>
      </g>
      <g class="ac-leg-br"${style("leg-br")}>
        <path d="M128,176 Q126,202 132,220 Q141,228 153,221" fill="none" stroke="${OUTLINE}" stroke-width="28" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M128,176 Q126,202 132,220 Q141,228 153,221" fill="none" stroke="${colors.belly}" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/>
      </g>
      <g class="ac-leg-fl"${style("leg-fl")}>
        <path d="M158,175 Q156,201 162,222 Q171,230 184,222" fill="none" stroke="${OUTLINE}" stroke-width="28" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M158,175 Q156,201 162,222 Q171,230 184,222" fill="none" stroke="${colors.belly}" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/>
      </g>
      <g class="ac-leg-fr"${style("leg-fr")}>
        <path d="M181,172 Q181,199 187,221 Q197,229 210,221" fill="none" stroke="${OUTLINE}" stroke-width="28" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M181,172 Q181,199 187,221 Q197,229 210,221" fill="none" stroke="${colors.belly}" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/>
      </g>
      <path d="M79,161 Q80,127 116,123 Q158,116 194,137 Q213,151 204,181 Q194,198 153,197 Q109,199 88,184 Q79,177 79,161 Z" fill="${colors.fur}" stroke="${OUTLINE}" stroke-width="5" stroke-linejoin="round"/>
      <path d="M116,183 Q140,193 170,185" fill="none" stroke="${colors.belly}" stroke-width="14" stroke-linecap="round" opacity=".82"/>
    </g>
    <g class="ac-head"${style("head")}>
      <g class="ac-ear-left"${style("ear-left")}>
        <path d="M128,61 L119,20 Q145,32 154,65 Z" fill="${colors.fur}" stroke="${OUTLINE}" stroke-width="5" stroke-linejoin="round"/>
        <path d="M130,54 L125,32 Q140,40 146,58 Z" fill="${colors.innerEar}"/>
      </g>
      <g class="ac-ear-right"${style("ear-right")}>
        <path d="M181,60 L196,20 Q212,42 205,76 Z" fill="${colors.fur}" stroke="${OUTLINE}" stroke-width="5" stroke-linejoin="round"/>
        <path d="M191,55 L198,33 Q206,47 201,65 Z" fill="${colors.innerEar}"/>
      </g>
      <path d="M112,105 Q111,55 151,41 Q197,30 218,73 Q234,103 213,131 Q196,148 164,143 Q133,147 116,126 Q111,117 112,105 Z" fill="${colors.fur}" stroke="${OUTLINE}" stroke-width="5" stroke-linejoin="round"/>
      <g class="ac-eye-left"${style("eye-left")}>
        <ellipse cx="151" cy="91" rx="13" ry="15" fill="#f4f7ff" stroke="${OUTLINE}" stroke-width="3"/>
        <ellipse cx="154" cy="93" rx="5" ry="9" fill="${colors.eyes}"/>
        <circle cx="154" cy="94" r="3.6" fill="${OUTLINE}"/>
      </g>
      <g class="ac-eye-right"${style("eye-right")}>
        <ellipse cx="193" cy="91" rx="13" ry="15" fill="#f4f7ff" stroke="${OUTLINE}" stroke-width="3"/>
        <ellipse cx="196" cy="93" rx="5" ry="9" fill="${colors.eyes}"/>
        <circle cx="196" cy="94" r="3.6" fill="${OUTLINE}"/>
      </g>
      <g class="ac-muzzle"${style("muzzle")}>
        <ellipse cx="175" cy="116" rx="28" ry="20" fill="${colors.belly}" stroke="${OUTLINE}" stroke-width="3"/>
        <path d="M169,108 L181,108 L175,116 Z" fill="#ff5d73" stroke="${OUTLINE}" stroke-width="2.5" stroke-linejoin="round"/>
        <path d="M175,116 Q168,126 160,120 M175,116 Q182,126 190,120" fill="none" stroke="${OUTLINE}" stroke-width="2.8" stroke-linecap="round"/>
        <path d="M157,116 L125,108 M158,121 L122,124 M193,116 L226,108 M192,121 L229,125" fill="none" stroke="${OUTLINE}" stroke-width="2.6" stroke-linecap="round"/>
      </g>
    </g>
  </g></g>`;
}

/** Точки суставов в абсолютных координатах viewBox; общие правила принимают углы переменных. */
export function animalCastCss() {
  return `
  .ac { --body-x: 1; --body-y: 1; --head-angle: 0deg; --ear-left-angle: 0deg; --ear-right-angle: 0deg; --eye-left-y: 1; --eye-right-y: 1; --tail-1-angle: 0deg; --tail-2-angle: 0deg; --tail-3-angle: 0deg; --leg-fl-angle: 0deg; --leg-fr-angle: 0deg; --leg-bl-angle: 0deg; --leg-br-angle: 0deg; }
  .ac-face, .ac, .ac-body, .ac-head, .ac-ear-left, .ac-ear-right, .ac-eye-left, .ac-eye-right, .ac-muzzle, .ac-tail-1, .ac-tail-2, .ac-tail-3, .ac-leg-fl, .ac-leg-fr, .ac-leg-bl, .ac-leg-br { transform-box: view-box; }
  .ac-face-left { transform: scaleX(-1); transform-origin: 140px 130px; }
  .ac-body { transform: scale(var(--body-x), var(--body-y)); transform-origin: 142px 178px; }
  .ac-head { transform: rotate(var(--head-angle)); transform-origin: 164px 137px; }
  .ac-ear-left { transform: rotate(var(--ear-left-angle)); transform-origin: 128px 61px; }
  .ac-ear-right { transform: rotate(var(--ear-right-angle)); transform-origin: 181px 60px; }
  .ac-eye-left { transform: scaleY(var(--eye-left-y)); transform-origin: 151px 91px; }
  .ac-eye-right { transform: scaleY(var(--eye-right-y)); transform-origin: 193px 91px; }
  .ac-muzzle { transform-origin: 175px 116px; }
  .ac-tail-1 { transform: rotate(var(--tail-1-angle)); transform-origin: 90px 160px; }
  .ac-tail-2 { transform: rotate(var(--tail-2-angle)); transform-origin: 55px 171px; }
  .ac-tail-3 { transform: rotate(var(--tail-3-angle)); transform-origin: 36px 202px; }
  .ac-leg-fl { transform: rotate(var(--leg-fl-angle)); transform-origin: 158px 175px; }
  .ac-leg-fr { transform: rotate(var(--leg-fr-angle)); transform-origin: 181px 172px; }
  .ac-leg-bl { transform: rotate(var(--leg-bl-angle)); transform-origin: 106px 174px; }
  .ac-leg-br { transform: rotate(var(--leg-br-angle)); transform-origin: 128px 176px; }`;
}
