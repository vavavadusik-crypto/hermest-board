import path from "node:path";

import { subtitleForceStyle } from "./subtitle-band.js";

const FLITE_VOICES = new Set(["slt", "awb", "kal", "kal16", "rms"]);
const VIDEO_CODECS = new Set(["libx264"]);
const AUDIO_CODECS = new Set(["aac"]);
const MUSIC_BED_DEFAULT_GAIN_DB = -13;

export function buildFliteAudioArgs({ textFile, outputFile, voice = "slt" }) {
  const safeTextFile = assertSafeGeneratedPath(textFile);
  const safeOutputFile = assertSafeGeneratedPath(outputFile);
  if (!FLITE_VOICES.has(voice)) throw new RangeError(`Unsupported flite voice: ${voice}`);
  return [
    "-hide_banner", "-loglevel", "error", "-n",
    "-f", "lavfi",
    "-i", `flite=textfile=${safeTextFile}:voice=${voice}`,
    "-ar", "48000",
    "-ac", "1",
    "-c:a", "pcm_s16le",
    safeOutputFile
  ];
}

// Локальный синтез отдаёт голос сырым: плоский по тембру, с шипящими и с
// клиппингом на пиках (замер до обработки: −17.7 LUFS, LRA 4.6, пик 0.0 dBFS).
// Порядок фильтров не косметический: деэссер работает до подъёма присутствия,
// иначе он давит уже усиленные шипящие; экситер — после компрессора, иначе
// компрессор съедает добавленные гармоники; лимитер — перед loudnorm, чтобы
// нормализация считала пики уже укрощённого сигнала.
// Замер после обработки: −16.2 LUFS, LRA 3.0, пик −1.5 dBFS.
export const VOICE_POLISH_FILTER = [
  "highpass=f=85",
  "deesser=i=0.35:m=0.5:f=0.45",
  "firequalizer=gain_entry='entry(110,2);entry(260,1.5);entry(3000,3);entry(6800,-2.5)'",
  "acompressor=threshold=-20dB:ratio=3:attack=8:release=120:makeup=3",
  "aexciter=amount=1.1:drive=3.5:freq=7500:blend=0.2",
  "aecho=0.85:0.6:24:0.16",
  "alimiter=limit=0.95",
  "loudnorm=I=-16:TP=-1.5:LRA=11"
].join(",");

// Every narration provider may emit its native sample rate (Piper: 22050 Hz);
// the pipeline contract for the narration artifact is fixed 48 kHz mono PCM.
//
// `polish` включается только для локального синтеза. Внешний TTS отдаёт уже
// обработанный голос, и второй проход компрессора с экситером его портит.
export function buildNarrationCanonicalizeArgs({ inputFile, outputFile, polish = false }) {
  const safeInputFile = assertSafeGeneratedPath(inputFile);
  const safeOutputFile = assertSafeGeneratedPath(outputFile);
  return [
    "-hide_banner", "-loglevel", "error", "-n",
    "-i", safeInputFile,
    ...(polish === true ? ["-af", VOICE_POLISH_FILTER] : []),
    "-ar", "48000",
    "-ac", "1",
    "-c:a", "pcm_s16le",
    safeOutputFile
  ];
}

// Обложка снимается из уже готового мастера, а не собирается повторно: кадр
// обязан быть тем же, что видит зритель. `-ss` стоит ДО `-i` — так ffmpeg
// перематывает по индексу контейнера и не декодирует весь ролик до нужной точки.
export function buildCoverFrameArgs({ inputFile, outputFile, atSeconds, width, height }) {
  const safeInputFile = assertSafeGeneratedPath(inputFile);
  const safeOutputFile = assertSafeGeneratedPath(outputFile);
  const frameWidth = positiveInteger(width, "width");
  const frameHeight = positiveInteger(height, "height");
  const seekSeconds = Number(atSeconds);
  if (!Number.isFinite(seekSeconds) || seekSeconds < 0 || seekSeconds > 21600) {
    throw new RangeError("atSeconds must be within 0..21600");
  }
  return [
    "-hide_banner", "-loglevel", "error", "-n",
    "-ss", seekSeconds.toFixed(3),
    "-i", safeInputFile,
    "-frames:v", "1",
    "-update", "1",
    "-vf", `scale=${frameWidth}:${frameHeight}`,
    "-c:v", "png",
    safeOutputFile
  ];
}

export function buildVideoRenderArgs({
  audioFile,
  subtitleFile,
  outputFile,
  durationSeconds,
  sceneTitleFiles = [],
  recipe
}) {
  const safeAudioFile = assertSafeGeneratedPath(audioFile);
  const safeSubtitleFile = assertSafeGeneratedPath(subtitleFile);
  const safeOutputFile = assertSafeGeneratedPath(outputFile);
  const width = positiveInteger(recipe?.width, "width");
  const height = positiveInteger(recipe?.height, "height");
  const fps = positiveInteger(recipe?.fps, "fps");
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 21600) {
    throw new RangeError("durationSeconds must be within 0..21600");
  }
  if (!VIDEO_CODECS.has(recipe?.videoCodec)) {
    throw new RangeError(`Unsupported video codec: ${recipe?.videoCodec}`);
  }
  if (!AUDIO_CODECS.has(recipe?.audioCodec)) {
    throw new RangeError(`Unsupported audio codec: ${recipe?.audioCodec}`);
  }
  if (recipe?.pixelFormat !== "yuv420p") {
    throw new RangeError(`Unsupported pixel format: ${recipe?.pixelFormat}`);
  }
  const sampleRate = positiveInteger(recipe?.audioSampleRate, "audioSampleRate");
  const audioChannels = positiveInteger(recipe?.audioChannels, "audioChannels");
  const subtitleMargin = positiveInteger(recipe?.safeZones?.bottom, "safeZones.bottom");
  // MarginV/Fontsize задаются в единицах ASS-холста 384x288, а не в пикселях
  // кадра — см. src/media/subtitle-band.js. Раньше сюда клался пиксельный
  // отступ рецепта, и субтитр промахивался: в 16:9 вставал в 204px от низа
  // вместо 54px, в 9:16 уезжал за кромку кадра целиком.
  const subtitleStyle = subtitleForceStyle({
    width,
    height,
    marginBottom: subtitleMargin,
    maxLines: recipe?.subtitleLayout?.maxLines
  });
  const loudnessTarget = Number(recipe?.loudnessTargetLufs);
  if (!Number.isFinite(loudnessTarget) || loudnessTarget < -70 || loudnessTarget > -5) {
    throw new RangeError("loudnessTargetLufs must be within -70..-5");
  }
  const recipeMaxDuration = Number(recipe?.maxDurationSeconds || 21600);
  if (duration > recipeMaxDuration) {
    throw new RangeError(`durationSeconds exceeds recipe maximum ${recipeMaxDuration}`);
  }
  const colorSource = `color=c=0x111827:s=${width}x${height}:r=${fps}:d=${duration.toFixed(3)}`;
  const subtitleFilter = `subtitles=filename=${safeSubtitleFile}:force_style='${subtitleStyle}'`;
  const titleFilters = sceneTitleFiles.map((scene, index) => {
    const titlePath = assertSafeGeneratedPath(scene?.path);
    const start = Number(scene?.startSeconds);
    const end = Number(scene?.endSeconds);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > duration + 0.001) {
      throw new RangeError(`Invalid scene title timing at index ${index}`);
    }
    const fontSize = Math.max(36, Math.round(height / 18));
    return [
      `drawtext=textfile=${titlePath}`,
      "font='DejaVu Sans'",
      "fontcolor=white",
      `fontsize=${fontSize}`,
      "x=(w-text_w)/2",
      "y=(h-text_h)/2",
      "box=1",
      "boxcolor=black@0.45",
      "boxborderw=40",
      "expansion=none",
      `enable='between(t,${start.toFixed(3)},${end.toFixed(3)})'`
    ].join(":");
  });
  const videoFilter = [...titleFilters, subtitleFilter].join(",");
  return [
    "-hide_banner", "-loglevel", "error", "-n",
    "-f", "lavfi", "-i", colorSource,
    "-i", safeAudioFile,
    "-map", "0:v:0", "-map", "1:a:0",
    "-vf", videoFilter,
    "-c:v", recipe.videoCodec,
    "-preset", "veryfast",
    "-crf", "21",
    "-pix_fmt", recipe.pixelFormat,
    "-r", String(fps),
    "-c:a", recipe.audioCodec,
    "-b:a", "192k",
    "-ar", String(sampleRate),
    "-ac", String(audioChannels),
    "-af", `loudnorm=I=${loudnessTarget}:TP=-1.5:LRA=11`,
    "-shortest",
    "-movflags", "+faststart",
    safeOutputFile
  ];
}

const KEN_BURNS_ZOOM_SPAN = "0.080";
const KEN_BURNS_MAX_ZOOM = "1.080";
const CAMERA_PUSH_IN_SPAN = "0.040";

export function assertSafeSequencePattern(value) {
  const candidate = typeof value === "string" ? value : "";
  if (!/^\/[A-Za-z0-9_./-]+-f%04d\.png$/.test(candidate)) {
    throw new TypeError("Expected a safe frame sequence pattern");
  }
  assertSafeGeneratedPath(candidate.replace("%04d", "0000"));
  return candidate;
}

function sequenceInput(frame) {
  const pattern = assertSafeSequencePattern(frame.sequencePattern);
  const frameCount = positiveInteger(frame.sequenceFrameCount, "sequenceFrameCount");
  const sequenceFps = positiveInteger(frame.sequenceFps, "sequenceFps");
  return {
    args: ["-framerate", String(sequenceFps), "-start_number", "0", "-i", pattern],
    frameCount,
    sequenceFps
  };
}

// Секвенция кадров build-in играет целиком, затем финальный кадр клонируется
// (tpad) до точной длительности сцены; trim держит таймлайн сетккалендарно.
function sequenceHoldChain({ frameCount, sequenceFps, durationSeconds, durationArg, fps }) {
  const playedSeconds = frameCount / sequenceFps;
  const padSeconds = Math.max(0, durationSeconds - playedSeconds);
  return `fps=${fps},tpad=stop_mode=clone:stop_duration=${padSeconds.toFixed(3)},trim=duration=${durationArg}`;
}

// Детерминированный Ken Burns: 4 фиксированных пресета дрейфа, выбираемые
// индексом сцены — одинаковый вход всегда даёт одинаковый filter graph.
function kenBurnsDrift({ sceneIndex, durationSeconds, fps }) {
  const lastFrame = Math.max(Math.round(durationSeconds * fps) - 1, 1);
  const centerX = "(iw-iw/zoom)/2";
  const centerY = "(ih-ih/zoom)/2";
  switch (sceneIndex % 4) {
    case 0:
      return { z: `1+${KEN_BURNS_ZOOM_SPAN}*on/${lastFrame}`, x: centerX, y: centerY };
    case 1:
      return { z: KEN_BURNS_MAX_ZOOM, x: `(iw-iw/zoom)*on/${lastFrame}`, y: centerY };
    case 2:
      return { z: `${KEN_BURNS_MAX_ZOOM}-${KEN_BURNS_ZOOM_SPAN}*on/${lastFrame}`, x: centerX, y: centerY };
    default:
      return { z: KEN_BURNS_MAX_ZOOM, x: `(iw-iw/zoom)*(1-on/${lastFrame})`, y: centerY };
  }
}

export function buildComposedVideoRenderArgs({
  sceneFrames,
  audioFile,
  subtitleFile,
  outputFile,
  durationSeconds,
  recipe,
  music
}) {
  if (!Array.isArray(sceneFrames) || sceneFrames.length === 0 || sceneFrames.length > 64) {
    throw new RangeError("Composed render requires 1..64 scene frames");
  }
  const safeAudioFile = assertSafeGeneratedPath(audioFile);
  const safeSubtitleFile = assertSafeGeneratedPath(subtitleFile);
  const safeOutputFile = assertSafeGeneratedPath(outputFile);
  const width = positiveInteger(recipe?.width, "width");
  const height = positiveInteger(recipe?.height, "height");
  const fps = positiveInteger(recipe?.fps, "fps");
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 21600) {
    throw new RangeError("durationSeconds must be within 0..21600");
  }
  if (!VIDEO_CODECS.has(recipe?.videoCodec)) {
    throw new RangeError(`Unsupported video codec: ${recipe?.videoCodec}`);
  }
  if (!AUDIO_CODECS.has(recipe?.audioCodec)) {
    throw new RangeError(`Unsupported audio codec: ${recipe?.audioCodec}`);
  }
  if (recipe?.pixelFormat !== "yuv420p") {
    throw new RangeError(`Unsupported pixel format: ${recipe?.pixelFormat}`);
  }
  const sampleRate = positiveInteger(recipe?.audioSampleRate, "audioSampleRate");
  const audioChannels = positiveInteger(recipe?.audioChannels, "audioChannels");
  const subtitleMargin = positiveInteger(recipe?.safeZones?.bottom, "safeZones.bottom");
  // MarginV/Fontsize задаются в единицах ASS-холста 384x288, а не в пикселях
  // кадра — см. src/media/subtitle-band.js. Раньше сюда клался пиксельный
  // отступ рецепта, и субтитр промахивался: в 16:9 вставал в 204px от низа
  // вместо 54px, в 9:16 уезжал за кромку кадра целиком.
  const subtitleStyle = subtitleForceStyle({
    width,
    height,
    marginBottom: subtitleMargin,
    maxLines: recipe?.subtitleLayout?.maxLines
  });
  const loudnessTarget = Number(recipe?.loudnessTargetLufs);
  if (!Number.isFinite(loudnessTarget) || loudnessTarget < -70 || loudnessTarget > -5) {
    throw new RangeError("loudnessTargetLufs must be within -70..-5");
  }
  const frameInputs = [];
  const filterSegments = [];
  let inputIndex = 0;
  for (const [index, frame] of sceneFrames.entries()) {
    const framePath = assertSafeGeneratedPath(frame?.path);
    const frameDuration = Number(frame?.durationSeconds);
    if (!Number.isFinite(frameDuration) || frameDuration <= 0 || frameDuration > 3600) {
      throw new RangeError(`Invalid scene frame duration at index ${index}`);
    }
    const durationArg = frameDuration.toFixed(3);
    const hasSequence = frame?.sequencePattern !== undefined;
    const overlayInputArgs = hasSequence
      ? null
      : ["-loop", "1", "-t", durationArg, "-framerate", String(fps), "-i", framePath];
    if (frame?.brollPath !== undefined) {
      const brollPath = assertSafeGeneratedPath(frame.brollPath);
      const brollInput = inputIndex;
      const overlayInput = inputIndex + 1;
      frameInputs.push("-stream_loop", "-1", "-t", durationArg, "-i", brollPath);
      let overlayChain = "setsar=1";
      if (hasSequence) {
        const sequence = sequenceInput(frame);
        frameInputs.push(...sequence.args);
        overlayChain = `${sequenceHoldChain({
          frameCount: sequence.frameCount,
          sequenceFps: sequence.sequenceFps,
          durationSeconds: frameDuration,
          durationArg,
          fps
        })},setsar=1`;
      } else {
        frameInputs.push(...overlayInputArgs);
      }
      filterSegments.push(
        `[${brollInput}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${fps},eq=brightness=-0.22:saturation=0.7,setsar=1[b${index}]`,
        `[${overlayInput}:v]${overlayChain}[f${index}]`,
        `[b${index}][f${index}]overlay=0:0,format=yuv420p[v${index}]`
      );
      inputIndex += 2;
    } else if (frame?.backgroundImagePath !== undefined) {
      const backgroundPath = assertSafeGeneratedPath(frame.backgroundImagePath);
      const backgroundInput = inputIndex;
      const overlayInput = inputIndex + 1;
      frameInputs.push(
        "-loop", "1",
        "-t", durationArg,
        "-framerate", String(fps),
        "-i", backgroundPath
      );
      let overlayChain = "setsar=1";
      if (hasSequence) {
        const sequence = sequenceInput(frame);
        frameInputs.push(...sequence.args);
        overlayChain = `${sequenceHoldChain({
          frameCount: sequence.frameCount,
          sequenceFps: sequence.sequenceFps,
          durationSeconds: frameDuration,
          durationArg,
          fps
        })},setsar=1`;
      } else {
        frameInputs.push(...overlayInputArgs);
      }
      const drift = kenBurnsDrift({ sceneIndex: index, durationSeconds: frameDuration, fps });
      filterSegments.push(
        `[${backgroundInput}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},zoompan=z='${drift.z}':x='${drift.x}':y='${drift.y}':d=1:s=${width}x${height}:fps=${fps},eq=brightness=-0.18:saturation=0.85,setsar=1[b${index}]`,
        `[${overlayInput}:v]${overlayChain}[f${index}]`,
        `[b${index}][f${index}]overlay=0:0,format=yuv420p[v${index}]`
      );
      inputIndex += 2;
    } else if (hasSequence) {
      const sequence = sequenceInput(frame);
      frameInputs.push(...sequence.args);
      const holdChain = sequenceHoldChain({
        frameCount: sequence.frameCount,
        sequenceFps: sequence.sequenceFps,
        durationSeconds: frameDuration,
        durationArg,
        fps
      });
      const lastFrame = Math.max(Math.round(frameDuration * fps) - 1, 1);
      filterSegments.push(
        `[${inputIndex}:v]${holdChain},zoompan=z='1+${CAMERA_PUSH_IN_SPAN}*on/${lastFrame}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=1:s=${width}x${height}:fps=${fps},setsar=1,format=yuv420p[v${index}]`
      );
      inputIndex += 1;
    } else {
      frameInputs.push(...overlayInputArgs);
      filterSegments.push(
        `[${inputIndex}:v]scale=${width}:${height},setsar=1,format=yuv420p[v${index}]`
      );
      inputIndex += 1;
    }
  }
  const concatLabels = sceneFrames.map((_frame, index) => `[v${index}]`).join("");
  const subtitleFilter = `subtitles=filename=${safeSubtitleFile}:force_style='${subtitleStyle}'`;
  const narrationInput = inputIndex;
  const musicArgs = [];
  const audioFilterSegments = [];
  let audioMap = `${narrationInput}:a:0`;
  if (music !== undefined && music !== null) {
    const safeMusicFile = assertSafeGeneratedPath(music?.path);
    const musicGainDb = Number(music?.gainDb ?? MUSIC_BED_DEFAULT_GAIN_DB);
    if (!Number.isFinite(musicGainDb) || musicGainDb < -60 || musicGainDb > 0) {
      throw new RangeError("music.gainDb must be within -60..0");
    }
    const musicInput = narrationInput + 1;
    musicArgs.push("-stream_loop", "-1", "-t", duration.toFixed(3), "-i", safeMusicFile);
    // asetnsamples фиксирует границы аудио-фреймов: threaded-скедулер ffmpeg подаёт
    // чанки переменного размера, и sidechaincompress/loudnorm дают недетерминированный
    // хвост (±1 LSB) — ломается инвариант «одинаковый вход → одинаковые хеши».
    audioFilterSegments.push(
      `[${narrationInput}:a]aformat=sample_rates=${sampleRate}:channel_layouts=stereo,asetnsamples=n=1024:p=0,asplit=2[nv][nsc]`,
      `[${musicInput}:a]aformat=sample_rates=${sampleRate}:channel_layouts=stereo,volume=${musicGainDb}dB,asetnsamples=n=1024:p=0[mg]`,
      "[mg][nsc]sidechaincompress=threshold=0.015:ratio=8:attack=20:release=350[duck]",
      "[nv][duck]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mix]",
      `[mix]asetnsamples=n=1024:p=0,loudnorm=I=${loudnessTarget}:TP=-1.5:LRA=11[aout]`
    );
    audioMap = "[aout]";
  }
  const filterComplex = [
    ...filterSegments,
    `${concatLabels}concat=n=${sceneFrames.length}:v=1:a=0[vc]`,
    `[vc]${subtitleFilter}[vout]`,
    ...audioFilterSegments
  ].join(";");
  return [
    "-hide_banner", "-loglevel", "error", "-n",
    ...frameInputs,
    "-i", safeAudioFile,
    ...musicArgs,
    "-filter_complex", filterComplex,
    "-map", "[vout]",
    "-map", audioMap,
    "-c:v", recipe.videoCodec,
    "-preset", "veryfast",
    "-crf", "21",
    "-pix_fmt", recipe.pixelFormat,
    "-r", String(fps),
    "-c:a", recipe.audioCodec,
    "-b:a", "192k",
    "-ar", String(sampleRate),
    "-ac", String(audioChannels),
    ...(audioMap === "[aout]" ? [] : ["-af", `loudnorm=I=${loudnessTarget}:TP=-1.5:LRA=11`]),
    "-shortest",
    "-movflags", "+faststart",
    safeOutputFile
  ];
}

export function assertSafeGeneratedPath(value) {
  const candidate = typeof value === "string" ? value : "";
  if (!/^\/[A-Za-z0-9_./-]+$/.test(candidate) || path.posix.normalize(candidate) !== candidate) {
    throw new TypeError(`Expected a safe generated path, received: ${candidate ? "invalid" : "empty"}`);
  }
  return candidate;
}

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return number;
}
