// Геометрия выжигаемых субтитров — один источник правды для двух потребителей:
// `ffmpeg-args.js` (что передать в `force_style`) и `scene-design.js` (сколько
// места сцена обязана оставить снизу). Пока они считали это порознь, сцена
// резервировала полосу «на глаз», а ffmpeg рисовал субтитр совсем не там.
//
// Замер (ffmpeg 8.0.1, libass, `-f lavfi -i color=black` + тот же фильтр, что в
// продакшене; верхняя строка чернил найдена по сырому gray-кадру):
//
//   1920x1080, MarginV=54  → строка стоит в 204px от низа, полоса 314px (29.1%)
//   1920x1080, MarginV=15  → строка стоит в  57px от низа, полоса 168px (15.6%)
//   1080x1920, MarginV=300 → субтитра в кадре нет вообще
//   1080x1920, MarginV=45  → строка стоит в 300px от низа, полоса 362px (18.9%)
//
// Причина: ffmpeg конвертирует SRT в ASS на виртуальном холсте 384x288
// (`ffmpeg -i cue.srt out.ass` → PlayResX 384 / PlayResY 288), а libass
// масштабирует каждую ASS-единицу в `height / 288` пикселей кадра. Значит и
// MarginV, и Fontsize задаются в единицах холста, а не в пикселях: положенные
// туда «пиксели» промахиваются в 3.75 раза на 1080p и в 6.67 раза на 1920p —
// в 9:16 субтитр уезжает за нижнюю кромку кадра целиком.

export const ASS_PLAY_RES_Y = 288;

// Кегль по умолчанию (Fontsize 16 на холсте 288) даёт ровно 60px на кадре
// 1080p — это исторический размер выжигаемых субтитров 16:9, и он же опорная
// точка. На других кадрах кегль считается от ШИРИНЫ: бюджет строки в
// `subtitles.js` — 55 знаков на 1920px, и только пропорциональный ширине кегль
// в него укладывается. Кегль от высоты раздувал 9:16 до ~107px, и двухстрочная
// реплика переносилась в четыре строки.
export const SUBTITLE_FONT_PX_AT_1920 = 60;
export const SUBTITLE_REFERENCE_WIDTH = 1920;
export const SUBTITLE_MAX_LINES = 2;

function positiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError(`Subtitle band requires a positive integer ${field}`);
  }
  return number;
}

/**
 * Геометрия полосы субтитров для кадра `width`x`height`.
 *
 * @param {object} input
 * @param {number} input.width       ширина кадра, px
 * @param {number} input.height      высота кадра, px
 * @param {number} input.marginBottom желаемый отступ строки от нижней кромки, px
 * @param {number} [input.maxLines]  сколько строк обещает рецепт
 * @returns {{fontPx: number, fontSizeAss: number, marginAss: number,
 *            marginPx: number, textHeight: number, bandHeight: number}}
 *   `bandHeight` — верхняя оценка: сколько кадра снизу занято субтитром.
 *   Замеры выше укладываются в неё с запасом 6-8px.
 */
export function resolveSubtitleBand({ width, height, marginBottom, maxLines = SUBTITLE_MAX_LINES } = {}) {
  const frameWidth = positiveInteger(width, "width");
  const frameHeight = positiveInteger(height, "height");
  const lines = positiveInteger(maxLines, "maxLines");
  const margin = Number(marginBottom);
  if (!Number.isFinite(margin) || margin < 0) {
    throw new TypeError("Subtitle band requires a non-negative marginBottom");
  }

  const assUnitPx = frameHeight / ASS_PLAY_RES_Y;
  const fontPx = Math.max(1, Math.round((SUBTITLE_FONT_PX_AT_1920 * frameWidth) / SUBTITLE_REFERENCE_WIDTH));
  const fontSizeAss = Math.max(1, Math.round(fontPx / assUnitPx));
  // Округление вверх: строка не должна оказаться ближе к кромке, чем safe zone.
  const marginAss = Math.max(1, Math.ceil(margin / assUnitPx));
  const marginPx = Math.round(marginAss * assUnitPx);
  const textHeight = lines * fontPx;
  return {
    fontPx,
    fontSizeAss,
    marginAss,
    marginPx,
    textHeight,
    bandHeight: Math.min(frameHeight, marginPx + textHeight)
  };
}

/** Кусок `force_style` для фильтра `subtitles` — ровно та же геометрия. */
export function subtitleForceStyle({ width, height, marginBottom, maxLines } = {}) {
  const band = resolveSubtitleBand({ width, height, marginBottom, maxLines });
  return `FontName=DejaVu Sans,Alignment=2,MarginV=${band.marginAss},Fontsize=${band.fontSizeAss}`;
}
