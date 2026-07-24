// Deterministic narration translator over the EXISTING text model (OpenAI-compatible
// or browser bridge). The text model is injected so unit tests mock it with no
// network. Translation runs at temperature 0 with a strict translate-only prompt.

import { normalizeLanguageCode } from "./edition.js";

const MAX_TRANSLATION_CHARS = 100000;
const DEFAULT_TEMPERATURE = 0;

const LANGUAGE_NAMES = Object.freeze({
  ru: "Russian",
  en: "English",
  es: "Spanish",
  de: "German",
  fr: "French",
  pt: "Portuguese",
  it: "Italian",
  ja: "Japanese",
  zh: "Chinese",
  uk: "Ukrainian",
  pl: "Polish",
  nl: "Dutch",
  tr: "Turkish",
  ar: "Arabic",
  hi: "Hindi"
});

export function createEditionTranslator({ textModel, temperature = DEFAULT_TEMPERATURE } = {}) {
  if (!textModel || typeof textModel.complete !== "function") {
    throw new TypeError("createEditionTranslator requires a text model with a complete() method");
  }
  return {
    modelId: typeof textModel.model === "string" ? textModel.model : null,
    provider: typeof textModel.provider === "string" ? textModel.provider : null,
    async translate({ text, targetLanguage, signal } = {}) {
      const source = String(text ?? "").trim();
      if (!source) throw new RangeError("translation text is required");
      if (source.length > MAX_TRANSLATION_CHARS) {
        throw new RangeError(`translation text limit is ${MAX_TRANSLATION_CHARS} characters`);
      }
      const language = normalizeLanguageCode(targetLanguage);
      const languageName = LANGUAGE_NAMES[language.slice(0, 2)] || language;
      const system =
        `You are a professional subtitle/voiceover translator. Translate the user's text into ` +
        `${languageName} (${language}). Return ONLY the translation as plain text — no quotes, ` +
        `no preface, no explanation, no notes. Preserve meaning, tone and sentence order. ` +
        `Keep proper nouns and numbers intact.`;
      const raw = await textModel.complete({ system, prompt: source, temperature, signal });
      return sanitizeTranslation(raw);
    }
  };
}

function sanitizeTranslation(value) {
  let text = String(value ?? "").trim();
  // Models often wrap output in matching quotes despite instructions.
  const quotePairs = [['"', '"'], ["'", "'"], ["«", "»"], ["“", "”"], ["‘", "’"]];
  for (const [open, close] of quotePairs) {
    if (text.length >= 2 && text.startsWith(open) && text.endsWith(close)) {
      text = text.slice(open.length, text.length - close.length).trim();
      break;
    }
  }
  if (!text) throw new RangeError("translator returned an empty translation");
  if (text.length > MAX_TRANSLATION_CHARS) {
    throw new RangeError(`translation exceeds the ${MAX_TRANSLATION_CHARS} character limit`);
  }
  return text;
}
