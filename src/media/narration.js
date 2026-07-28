import { createFliteNarrationAdapter } from "./tts.js";
import { createPiperNarrationAdapter, describePiperAvailability } from "./piper-tts.js";
import { createElevenLabsNarrationAdapter, describeElevenLabsAvailability } from "./elevenlabs-tts.js";

const FLITE_PROVIDER = "ffmpeg-flite";
const PIPER_PROVIDER = "piper";
const ELEVENLABS_PROVIDER = "elevenlabs";

const NARRATION_PROVIDERS = new Set([FLITE_PROVIDER, PIPER_PROVIDER, ELEVENLABS_PROVIDER]);
// Идентификатор голоса ElevenLabs — непрозрачная строка из букв и цифр;
// у Piper это имя файла модели вида `ru_RU-dmitri-medium`.
const ELEVENLABS_VOICE_ID = /^[A-Za-z0-9]{8,64}$/u;
const PIPER_VOICE_ID = /^[A-Za-z0-9_-]{3,64}$/u;

/**
 * Переозвучить готовый проект другим голосом, не редактируя сам проект.
 *
 * Отдельная функция, а не пара присваиваний в CLI, из-за одной ловушки: смена
 * провайдера без смены голоса тиха и разрушительна. Голос Piper (`ru_RU-...`)
 * для ElevenLabs не значит ничего, адаптер молча берёт витринный английский
 * голос по умолчанию — и ролик выходит озвученным не тем и не на том языке.
 * Поэтому переход на ElevenLabs без явного id — ошибка, а не «разумный
 * дефолт».
 */
export function applyNarrationOverrides(project, { provider, voice } = {}) {
  if (provider === undefined && voice === undefined) return project;
  const brief = project?.brief ?? {};
  const nextProvider = provider ?? brief.narrationProvider ?? "";
  if (provider !== undefined && !NARRATION_PROVIDERS.has(provider)) {
    throw new RangeError(
      `Unknown narration provider: ${String(provider)} (known: ${[...NARRATION_PROVIDERS].join(", ")})`
    );
  }
  const nextVoice = voice ?? brief.voice;
  if (nextProvider === ELEVENLABS_PROVIDER) {
    if (voice === undefined && provider !== undefined) {
      throw new RangeError(
        "Switching to ElevenLabs requires --voice: a Piper voice name silently falls back to a default English voice"
      );
    }
    if (typeof nextVoice !== "string" || !ELEVENLABS_VOICE_ID.test(nextVoice)) {
      throw new RangeError(`Not an ElevenLabs voice id: ${String(nextVoice)}`);
    }
  } else if (voice !== undefined && (typeof voice !== "string" || !PIPER_VOICE_ID.test(voice))) {
    throw new RangeError(`Not a voice name: ${String(voice)}`);
  }
  return {
    ...project,
    brief: {
      ...brief,
      ...(provider === undefined ? {} : { narrationProvider: provider }),
      ...(voice === undefined ? {} : { voice })
    }
  };
}

export async function selectNarrationAdapter({ language, voice, provider, dependencies = {} } = {}) {
  if (provider !== undefined && provider !== null && provider !== "") {
    if (provider === FLITE_PROVIDER) return createFliteNarrationAdapter(dependencies);
    if (provider === ELEVENLABS_PROVIDER) {
      const availability = describeElevenLabsAvailability({ env: dependencies.env });
      if (availability.status !== "executable") {
        throw new RangeError(`ElevenLabs narration is not executable: ${availability.status}`);
      }
      return createElevenLabsNarrationAdapter(dependencies);
    }
    if (provider !== PIPER_PROVIDER) throw new RangeError(`Unknown narration provider: ${String(provider)}`);
  }
  const availability = await describePiperAvailability({
    language,
    voice,
    env: dependencies.env,
    homeDirectory: dependencies.homeDirectory,
    fileExists: dependencies.fileExists
  });
  if (availability.status === "executable") return createPiperNarrationAdapter(dependencies);
  if (provider === PIPER_PROVIDER) {
    throw new RangeError(`Piper narration is not executable: ${availability.status}`);
  }
  return createFliteNarrationAdapter(dependencies);
}
