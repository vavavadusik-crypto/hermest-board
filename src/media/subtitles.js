// Ширина строки субтитра в символах на кадр шириной 1920: замерено по готовому
// рендеру (152 символа легли в три строки). Используется только чтобы решить,
// резать ли слишком длинное предложение, — точную вёрстку делает libass.
const CHARS_PER_LINE_AT_1920 = 55;
const DEFAULT_MAX_LINES = 2;

export function buildSubtitleCues(storyboard, { width, subtitleLayout } = {}) {
  const scenes = Array.isArray(storyboard?.scenes) ? storyboard.scenes : [];
  const maxChars = maxCharsPerCue({ width, subtitleLayout });
  const cues = [];
  let cursorMs = 0;

  for (const [index, scene] of scenes.entries()) {
    const durationMs = Number(scene?.durationMs);
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      throw new TypeError(`Scene ${scene?.id || index + 1} requires a positive duration`);
    }
    const narrationMs = Number(scene?.narrationDurationMs);
    const speechMs = Number.isFinite(narrationMs) && narrationMs > 0
      ? Math.min(Math.round(narrationMs), Math.round(durationMs))
      : Math.round(durationMs);
    const sceneId = String(scene?.id || `scene-${index + 1}`);
    const chunks = splitNarration(cleanText(scene?.narration), maxChars);

    // Реплика держится на экране столько, сколько её произносят: время сцены
    // делится пропорционально длине текста — темп синтеза внутри сцены ровный.
    const totalChars = chunks.reduce((sum, chunk) => sum + chunk.length, 0) || 1;
    let spentMs = 0;
    chunks.forEach((chunk, chunkIndex) => {
      const isLast = chunkIndex === chunks.length - 1;
      const chunkMs = isLast
        ? speechMs - spentMs
        : Math.round((speechMs * chunk.length) / totalChars);
      cues.push({
        index: cues.length + 1,
        sceneId,
        startMs: cursorMs + spentMs,
        endMs: cursorMs + spentMs + chunkMs,
        text: chunk
      });
      spentMs += chunkMs;
    });

    cursorMs += Math.round(durationMs);
  }

  return cues;
}

export function formatSrt(cues) {
  const blocks = cues.map(cue => [
    cue.index,
    `${formatTimestamp(cue.startMs)} --> ${formatTimestamp(cue.endMs)}`,
    cleanText(cue.text)
  ].join("\n"));
  return blocks.length ? `${blocks.join("\n\n")}\n` : "";
}

function maxCharsPerCue({ width, subtitleLayout }) {
  const frameWidth = Number(width);
  const charsPerLine = Number.isFinite(frameWidth) && frameWidth > 0
    ? Math.max(20, Math.round((frameWidth / 1920) * CHARS_PER_LINE_AT_1920))
    : CHARS_PER_LINE_AT_1920;
  const maxLines = Number(subtitleLayout?.maxLines);
  const lines = Number.isSafeInteger(maxLines) && maxLines > 0 ? maxLines : DEFAULT_MAX_LINES;
  return charsPerLine * lines;
}

function splitNarration(narration, maxChars) {
  const sentences = String(narration || "")
    .split(/(?<=[.!?…])\s+/u)
    .map(sentence => sentence.trim())
    .filter(Boolean);
  if (!sentences.length) return [""];
  return sentences.flatMap(sentence => wrapSentence(sentence, maxChars));
}

// Предложение длиннее пары строк режется по границам слов: рвать слово
// посередине хуже, чем показать чуть более длинную строку.
function wrapSentence(sentence, maxChars) {
  if (sentence.length <= maxChars) return [sentence];
  const parts = [];
  let current = "";
  for (const word of sentence.split(" ")) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      parts.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function formatTimestamp(value) {
  const milliseconds = Math.max(0, Math.round(Number(value) || 0));
  const hours = Math.floor(milliseconds / 3600000);
  const minutes = Math.floor((milliseconds % 3600000) / 60000);
  const seconds = Math.floor((milliseconds % 60000) / 1000);
  const remainder = milliseconds % 1000;
  return [hours, minutes, seconds].map(part => String(part).padStart(2, "0")).join(":") +
    `,${String(remainder).padStart(3, "0")}`;
}

function cleanText(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/gu, " ") : "";
}
