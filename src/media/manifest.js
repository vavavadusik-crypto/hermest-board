import { createHash } from "node:crypto";
import path from "node:path";

import { VOICE_POLISH_FILTER, audioEncoderArgs, videoEncoderArgs } from "./ffmpeg-args.js";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const TOOL_TEXT_KEYS = ["ffmpeg", "ffprobe", "renderer", "sceneComposer", "chrome"];
const TTS_KEYS = [
  "provider",
  "model",
  "voice",
  "language",
  "durationSeconds",
  "sampleRate",
  "channels",
  "codec",
  "scriptSha256"
];
const SENSITIVE_FLAG = /^(?:--?(?:api[-_]?key|token|secret|password|authorization|cookie|credential)|authorization)$/i;
const SENSITIVE_ASSIGNMENT = /^(.*(?:api[-_]?key|token|secret|password|authorization|cookie|credential)[^=]*=).*/i;
const HEADER_FLAG = /^(?:--?headers?|--cookie)(?:=|$)/i;
const SENSITIVE_HEADER_CARRIER = /(?:^|[=\r\n])\s*(?:authorization|proxy-authorization|cookie|set-cookie)\s*:/i;
const CREDENTIAL_URL = /[a-z][a-z0-9+.-]*:\/\/[^/\s"'<>]*(?:@|%40)/i;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const ALLOWED_COMMAND_TOOLS = Object.freeze({
  tts: Object.freeze(["ffmpeg", "piper"]),
  "narration-canonicalize": Object.freeze(["ffmpeg"]),
  render: Object.freeze(["ffmpeg"]),
  "render-composed": Object.freeze(["ffmpeg"]),
  "scene-browser": Object.freeze(["chrome"]),
  "cover-frame": Object.freeze(["ffmpeg"]),
  "loudness-measure": Object.freeze(["ffmpeg"])
});
const LOUDNESS_KEYS = Object.freeze([
  "integratedLufs",
  "truePeakDbtp",
  "loudnessRangeLu",
  "thresholdLufs",
  "targetIntegratedLufs",
  "targetTruePeakDbtp",
  "targetLoudnessRangeLu"
]);
const MAX_COMMAND_ARGUMENTS = 512;
const MAX_COMMAND_ARGUMENT_BYTES = 16384;

export function hashJson(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function buildRenderManifest({
  project,
  storyboard,
  recipe,
  tools,
  commands = [],
  qc = {},
  blockers = [],
  warnings = [],
  lineage = {},
  footage = [],
  music = null,
  artifacts
}) {
  const normalizedRecipe = sortValue(structuredClone(recipe || {}));
  const verifiedArtifacts = (Array.isArray(artifacts) ? artifacts : []).map(normalizeArtifact);
  const normalizedFootage = normalizeFootage(footage);
  const scenes = buildSceneManifest(storyboard, normalizedFootage);
  return {
    schemaVersion: 1,
    renderer: "hermest-board-media-r1",
    inputs: {
      projectSha256: hashJson(project),
      storyboardSha256: hashJson(storyboard)
    },
    recipe: normalizedRecipe,
    recipeSha256: hashJson(normalizedRecipe),
    tools: normalizeTools(tools),
    commands: normalizeCommands(commands),
    qc: normalizeQc(qc),
    blockers: uniqueText(blockers),
    warnings: uniqueText(warnings),
    lineage: normalizeLineage(lineage),
    footage: normalizedFootage,
    scenes,
    music: normalizeMusic(music),
    artifacts: verifiedArtifacts
  };
}

function normalizeMusic(music) {
  if (music === null || music === undefined) return null;
  if (typeof music !== "object" || Array.isArray(music)) {
    throw new TypeError("Invalid music record");
  }
  const license = safeText(music.license);
  if (!license) throw new TypeError("Music bed without a license record");
  const sha256 = String(music.sha256 || "");
  if (!SHA256_PATTERN.test(sha256)) throw new TypeError("Music bed without a verified sha256");
  return {
    id: safeText(music.id) || "unknown",
    title: safeText(music.title),
    mood: safeText(music.mood),
    license,
    sha256,
    source: safeText(music.source) || "library"
  };
}

const VALID_ASSET_TYPES = Object.freeze([
  "generative-clip",
  "stock-footage",
  "generated-image",
  "stock-photo",
  "deterministic"
]);

function normalizeFootage(footage) {
  if (!Array.isArray(footage)) return [];
  return footage.map((clip, clipIndex) => {
    if (!clip || typeof clip !== "object" || Array.isArray(clip)) {
      throw new TypeError(`Invalid footage record at index ${clipIndex}`);
    }
    const sceneIndex = Number(clip.sceneIndex);
    const assetType = safeText(clip.assetType);
    const license = safeText(clip.license);
    const sha256 = String(clip.sha256 || "");
    if (!Number.isSafeInteger(sceneIndex) || sceneIndex < 0) {
      throw new TypeError(`Invalid footage scene index at ${clipIndex}`);
    }
    if (!assetType) throw new TypeError(`Footage without assetType at index ${clipIndex}`);
    if (!VALID_ASSET_TYPES.includes(assetType)) {
      throw new TypeError(`Invalid assetType "${assetType}" at index ${clipIndex}`);
    }
    if (!license) throw new TypeError(`Footage without a license record at index ${clipIndex}`);
    if (!SHA256_PATTERN.test(sha256)) throw new TypeError(`Footage without a verified sha256 at index ${clipIndex}`);
    const provenance = clip.provenance && typeof clip.provenance === "object" && !Array.isArray(clip.provenance)
      ? clip.provenance
      : {};
    const promptSha256 = String(provenance.promptSha256 || "");
    return {
      sceneIndex,
      assetType,
      license,
      sha256,
      source: safeText(provenance.source) || "unknown",
      provider: safeText(provenance.provider) || "unknown",
      author: safeText(provenance.author),
      url: sanitizeFootageUrl(provenance.url),
      model: safeText(provenance.model),
      promptSha256: SHA256_PATTERN.test(promptSha256) ? promptSha256 : ""
    };
  });
}

function sanitizeFootageUrl(value) {
  const url = safeText(value);
  if (!url) return "";
  if (!/^https:\/\/[^\s"'<>@]+$/.test(url)) return "";
  return url;
}

function buildSceneManifest(storyboard, normalizedFootage) {
  const storyboardScenes = storyboard?.scenes;
  if (!Array.isArray(storyboardScenes)) return [];
  const footageByScene = new Map(normalizedFootage.map(f => [f.sceneIndex, f.assetType]));
  return storyboardScenes.map((scene, sceneIndex) => ({
    sceneIndex,
    title: safeText(scene?.title) || `Scene ${sceneIndex}`,
    assetType: footageByScene.get(sceneIndex) || "deterministic"
  }));
}

function normalizeArtifact(artifact) {
  const bytes = Number(artifact?.bytes);
  const sha256 = String(artifact?.sha256 || "");
  if (!Number.isFinite(bytes) || bytes <= 0 || !SHA256_PATTERN.test(sha256)) {
    throw new TypeError("Render artifacts require verified bytes and sha256");
  }
  return {
    name: safeText(artifact?.name),
    type: safeText(artifact?.type) || "application/octet-stream",
    bytes,
    sha256,
    probe: sortValue(structuredClone(artifact?.probe || {}))
  };
}

function normalizeTools(tools) {
  const source = tools && typeof tools === "object" && !Array.isArray(tools) ? tools : {};
  const normalized = {};
  for (const key of TOOL_TEXT_KEYS) {
    const value = source[key];
    if (["string", "number", "boolean"].includes(typeof value)) normalized[key] = value;
  }
  if (source.tts && typeof source.tts === "object" && !Array.isArray(source.tts)) {
    const tts = {};
    for (const key of TTS_KEYS) {
      const value = source.tts[key];
      if (["string", "number", "boolean"].includes(typeof value)) tts[key] = value;
    }
    if (Object.keys(tts).length > 0) normalized.tts = tts;
  }
  return normalized;
}

function normalizeCommands(commands) {
  if (!Array.isArray(commands)) return [];
  return commands.map((command, commandIndex) => {
    if (!command || typeof command !== "object" || Array.isArray(command)) {
      throw new TypeError(`Invalid command evidence at index ${commandIndex}`);
    }
    const id = safeText(command.id);
    const tool = safeText(command.tool);
    if (!id || !ALLOWED_COMMAND_TOOLS[id]?.includes(tool)) {
      throw new TypeError(`Unsupported command evidence at index ${commandIndex}`);
    }
    if (!Array.isArray(command.argv) || command.argv.length === 0 || command.argv.length > MAX_COMMAND_ARGUMENTS) {
      throw new TypeError(`Unsafe command argument list at index ${commandIndex}`);
    }
    const argv = command.argv.map((value, argumentIndex) => {
      if (typeof value !== "string" && typeof value !== "number") {
        throw new TypeError(`Unsafe command argument at ${commandIndex}:${argumentIndex}`);
      }
      const argument = String(value);
      if (isSensitiveCommandArgument(argument)) {
        throw new TypeError(`Sensitive command argument at ${commandIndex}:${argumentIndex}`);
      }
      if (
        CONTROL_CHARACTER.test(argument) ||
        Buffer.byteLength(argument, "utf8") > MAX_COMMAND_ARGUMENT_BYTES
      ) {
        throw new TypeError(`Unsafe command argument at ${commandIndex}:${argumentIndex}`);
      }
      return argument;
    });
    validateCommandArgv(id, tool, argv, commandIndex);
    let redactNext = false;
    const sanitized = argv.map(argument => {
      if (redactNext) {
        redactNext = false;
        return "<redacted>";
      }
      if (HEADER_FLAG.test(argument) || SENSITIVE_FLAG.test(argument)) {
        redactNext = true;
        return argument;
      }
      if (SENSITIVE_HEADER_CARRIER.test(argument)) return "<redacted>";
      if (CREDENTIAL_URL.test(argument)) return "<redacted-url>";
      if (SENSITIVE_ASSIGNMENT.test(argument)) return argument.replace(SENSITIVE_ASSIGNMENT, "$1<redacted>");
      return redactRunPath(argument);
    });
    return { id, tool, argv: sanitized };
  });
}

function isSensitiveCommandArgument(argument) {
  const normalized = String(argument).trimStart();
  if (normalized.startsWith("-H")) return true;
  return HEADER_FLAG.test(normalized)
    || SENSITIVE_FLAG.test(normalized)
    || SENSITIVE_HEADER_CARRIER.test(normalized)
    || CREDENTIAL_URL.test(normalized)
    || SENSITIVE_ASSIGNMENT.test(normalized);
}

function validateCommandArgv(id, tool, argv, commandIndex) {
  try {
    if (id === "tts" && tool === "piper") validatePiperTtsArgv(argv);
    else if (id === "tts") validateTtsArgv(argv);
    else if (id === "narration-canonicalize" && tool === "ffmpeg") validateNarrationCanonicalizeArgv(argv);
    else if (id === "loudness-measure" && tool === "ffmpeg") validateLoudnessMeasureArgv(argv);
    else if (id === "cover-frame" && tool === "ffmpeg") validateCoverFrameArgv(argv);
    else if (id === "render") validateRenderArgv(argv);
    else if (id === "render-composed" && tool === "ffmpeg") validateComposedRenderArgv(argv);
    else if (id === "scene-browser" && tool === "chrome") validateSceneBrowserArgv(argv);
    else throw new TypeError("unsupported schema");
  } catch {
    throw new TypeError(`Command argv schema mismatch at index ${commandIndex}`);
  }
}

function validatePiperTtsArgv(argv) {
  const decimal = /^\d+(?:\.\d{1,3})?$/;
  const cursor = argvCursor(argv);
  cursor.expect("--model");
  const model = cursor.take();
  if (!model.endsWith(".onnx") || !isSafeGeneratedPath(model)) throw new TypeError("invalid piper model");
  cursor.expect("--output_file");
  if (!isSafeGeneratedPath(cursor.take())) throw new TypeError("invalid piper output");
  cursor.expect("--noise_scale");
  if (!decimal.test(cursor.take())) throw new TypeError("invalid piper noise scale");
  cursor.expect("--noise_w");
  if (!decimal.test(cursor.take())) throw new TypeError("invalid piper noise width");
  cursor.expect("--sentence_silence");
  if (!decimal.test(cursor.take())) throw new TypeError("invalid piper silence");
  // Темп речи опционален: он появляется в argv только когда задана целевая
  // длительность. Коридор здесь тот же, что в домене — манифест не должен
  // принимать темп, который конвейер сам никогда не выбрал бы.
  if (argv.length > cursor.position()) {
    cursor.expect("--length_scale");
    const lengthScale = cursor.take();
    if (!decimal.test(lengthScale)) throw new TypeError("invalid piper length scale");
    const scale = Number(lengthScale);
    if (!(scale >= 0.85 && scale <= 1.15)) throw new TypeError("piper length scale out of range");
  }
  cursor.finish();
}

function validateTtsArgv(argv) {
  const cursor = argvCursor(argv);
  cursor.expect("-hide_banner", "-loglevel", "error", "-n", "-f", "lavfi", "-i");
  const source = cursor.take();
  const match = source.match(/^flite=textfile=(\/[A-Za-z0-9_./-]+):voice=(slt|awb|kal|kal16|rms)$/);
  if (!match || !isSafeGeneratedPath(match[1])) throw new TypeError("invalid flite source");
  cursor.expect("-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le");
  if (!isSafeGeneratedPath(cursor.take())) throw new TypeError("invalid TTS output");
  cursor.finish();
}

function validateLoudnessMeasureArgv(argv) {
  const cursor = argvCursor(argv);
  cursor.expect("-hide_banner", "-nostats", "-i");
  if (!isSafeGeneratedPath(cursor.take())) throw new TypeError("invalid loudness input");
  cursor.expect("-map", "0:a:0", "-af");
  if (!/^loudnorm=I=-?\d+(?:\.\d+)?:TP=-?\d+(?:\.\d+)?:LRA=\d+(?:\.\d+)?:print_format=json$/.test(cursor.take())) {
    throw new TypeError("invalid loudness filter");
  }
  cursor.expect("-f", "null", "-");
  cursor.finish();
}

// Обложка — единственный кадр из уже проверенного мастера. Схема пришпиливает
// быстрый seek (`-ss` до `-i`), ровно один кадр и PNG-выход: манифест обязан
// доказывать, что обложка снята с ролика, а не собрана каким-то другим путём.
function validateCoverFrameArgv(argv) {
  const cursor = argvCursor(argv);
  cursor.expect("-hide_banner", "-loglevel", "error", "-n", "-ss");
  if (!/^\d+\.\d{3}$/.test(cursor.take())) throw new TypeError("invalid cover frame seek");
  cursor.expect("-i");
  const inputPath = cursor.take();
  if (!inputPath.endsWith(".mp4") || !isSafeGeneratedPath(inputPath)) {
    throw new TypeError("invalid cover frame input");
  }
  cursor.expect("-frames:v", "1", "-update", "1", "-vf");
  if (!/^scale=\d{1,5}:\d{1,5}$/.test(cursor.take())) throw new TypeError("invalid cover frame scale");
  cursor.expect("-c:v", "png");
  const outputPath = cursor.take();
  if (!outputPath.endsWith(".png") || !isSafeGeneratedPath(outputPath)) {
    throw new TypeError("invalid cover frame output");
  }
  cursor.finish();
}

function validateNarrationCanonicalizeArgv(argv) {
  const cursor = argvCursor(argv);
  cursor.expect("-hide_banner", "-loglevel", "error", "-n", "-i");
  if (!isSafeGeneratedPath(cursor.take())) throw new TypeError("invalid canonicalize input");
  // Полировка голоса опциональна — её получает только локальный синтез. Но если
  // она в argv есть, цепочка обязана совпасть с эталонной целиком: манифест
  // аудирует то, что реально было выполнено, а не то, что «похоже на правду».
  if (argv[cursor.position()] === "-af") {
    cursor.expect("-af");
    if (cursor.take() !== VOICE_POLISH_FILTER) throw new TypeError("invalid voice polish chain");
  }
  cursor.expect("-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le");
  if (!isSafeGeneratedPath(cursor.take())) throw new TypeError("invalid canonicalize output");
  cursor.finish();
}

// Профиль кодирования проверяется по тому же построителю, которым он и собран,
// поэтому манифест не может разъехаться с реальной командой. Частота кадров —
// не произвольное число из argv, а один из объявленных режимов выдачи.
const ALLOWED_OUTPUT_FPS = Object.freeze(["60", "30"]);

function expectEncoderProfile(cursor, { audioChannels }) {
  const fps = ALLOWED_OUTPUT_FPS.find(candidate => matchesEncoderProfile(cursor, candidate, audioChannels));
  if (!fps) throw new TypeError("invalid encoder profile");
  cursor.expect(...encoderProfileArgs(fps, audioChannels));
}

function matchesEncoderProfile(cursor, fps, audioChannels) {
  const expected = encoderProfileArgs(fps, audioChannels);
  const start = cursor.position();
  return expected.every((value, index) => cursor.at(start + index) === value);
}

function encoderProfileArgs(fps, audioChannels) {
  return [
    ...videoEncoderArgs({ videoCodec: "libx264", pixelFormat: "yuv420p", fps: Number(fps) }),
    ...audioEncoderArgs({ audioCodec: "aac", sampleRate: "48000", audioChannels })
  ];
}

function validateRenderArgv(argv) {
  const cursor = argvCursor(argv);
  cursor.expect("-hide_banner", "-loglevel", "error", "-n", "-f", "lavfi", "-i");
  if (!/^color=c=0x[0-9a-f]{6}:s=\d+x\d+:r=\d+:d=\d+\.\d{3}$/i.test(cursor.take())) {
    throw new TypeError("invalid color source");
  }
  cursor.expect("-i");
  if (!isSafeGeneratedPath(cursor.take())) throw new TypeError("invalid narration input");
  cursor.expect("-map", "0:v:0", "-map", "1:a:0", "-vf");
  const videoFilter = cursor.take();
  if (
    !/^(?:drawtext=|subtitles=)/.test(videoFilter) ||
    !/subtitles=filename=\/[A-Za-z0-9_./-]+:force_style=/.test(videoFilter) ||
    /(?:[a-z][a-z0-9+.-]*:\/\/|authorization|cookie|--header)/i.test(videoFilter)
  ) {
    throw new TypeError("invalid video filter");
  }
  expectEncoderProfile(cursor, { audioChannels: "2" });
  cursor.expect("-af");
  if (!/^loudnorm=I=-?\d+(?:\.\d+)?:TP=-1\.5:LRA=11$/.test(cursor.take())) {
    throw new TypeError("invalid audio filter");
  }
  cursor.expect("-shortest", "-movflags", "+faststart");
  if (!isSafeGeneratedPath(cursor.take())) throw new TypeError("invalid render output");
  cursor.finish();
}

// Кадры больше не снимаются процессом на кадр: браузер поднимается один раз, а
// сцены и кадры адресуются по CDP. Поэтому доказательством запуска служит argv
// самого браузера, а не argv скриншота. Порт обязан быть эфемерным (0), а адрес
// отладки — строго loopback: это инвариант безопасности, и манифест его пришпиливает.
function validateSceneBrowserArgv(argv) {
  const cursor = argvCursor(argv);
  cursor.expect(
    "--headless=new",
    "--disable-gpu",
    "--disable-extensions",
    "--hide-scrollbars",
    "--force-device-scale-factor=1"
  );
  const profile = cursor.take();
  if (!/^--user-data-dir=\/[A-Za-z0-9_./-]+$/.test(profile) || !isSafeGeneratedPath(profile.slice("--user-data-dir=".length))) {
    throw new TypeError("invalid chrome profile dir");
  }
  if (!/^--window-size=\d{2,5},\d{2,5}$/.test(cursor.take())) throw new TypeError("invalid chrome window size");
  cursor.expect(
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=0",
    "about:blank"
  );
  cursor.finish();
}

function validateComposedRenderArgv(argv) {
  const cursor = argvCursor(argv);
  cursor.expect("-hide_banner", "-loglevel", "error", "-n");
  const decimal = /^\d+(?:\.\d{1,3})?$/;
  let sceneCount = 0;
  for (;;) {
    const marker = argv[cursorIndex(cursor)];
    if (marker === "-stream_loop") {
      cursor.expect("-stream_loop", "-1", "-t");
      if (!decimal.test(cursor.take())) throw new TypeError("invalid broll duration");
      cursor.expect("-i");
      const brollPath = cursor.take();
      if (!brollPath.endsWith(".mp4") || !isSafeGeneratedPath(brollPath)) throw new TypeError("invalid broll input");
      expectFrameOrSequenceInput(cursor, argv, decimal);
    } else if (marker === "-framerate") {
      expectSequenceInput(cursor);
    } else if (marker === "-loop") {
      cursor.expect("-loop", "1", "-t");
      if (!decimal.test(cursor.take())) throw new TypeError("invalid frame duration");
      cursor.expect("-framerate");
      if (!/^\d{1,3}$/.test(cursor.take())) throw new TypeError("invalid frame rate");
      cursor.expect("-i");
      const framePath = cursor.take();
      if (!framePath.endsWith(".png") || !isSafeGeneratedPath(framePath)) throw new TypeError("invalid frame input");
    } else {
      break;
    }
    sceneCount += 1;
    if (sceneCount > 64) throw new TypeError("too many frame inputs");
  }
  if (sceneCount === 0) throw new TypeError("missing frame inputs");
  cursor.expect("-i");
  if (!isSafeGeneratedPath(cursor.take())) throw new TypeError("invalid narration input");
  let hasMusic = false;
  if (argv[cursorIndex(cursor)] === "-stream_loop") {
    cursor.expect("-stream_loop", "-1", "-t");
    if (!decimal.test(cursor.take())) throw new TypeError("invalid music duration");
    cursor.expect("-i");
    const musicPath = cursor.take();
    if (!/\.(?:m4a|mp3|wav|ogg|flac)$/.test(musicPath) || !isSafeGeneratedPath(musicPath)) {
      throw new TypeError("invalid music input");
    }
    hasMusic = true;
  }
  cursor.expect("-filter_complex");
  validateComposedFilterGraph(cursor.take(), { hasMusic });
  cursor.expect("-map", "[vout]", "-map");
  const audioMap = cursor.take();
  if (hasMusic) {
    if (audioMap !== "[aout]") throw new TypeError("invalid audio map");
  } else if (!/^\d{1,2}:a:0$/.test(audioMap)) {
    throw new TypeError("invalid audio map");
  }
  expectEncoderProfile(cursor, { audioChannels: "2" });
  if (!hasMusic) {
    cursor.expect("-af");
    if (!/^loudnorm=I=-?\d+(?:\.\d+)?:TP=-1\.5:LRA=11$/.test(cursor.take())) {
      throw new TypeError("invalid audio filter");
    }
  }
  cursor.expect("-shortest", "-movflags", "+faststart");
  if (!isSafeGeneratedPath(cursor.take())) throw new TypeError("invalid render output");
  cursor.finish();
}

function cursorIndex(cursor) {
  return cursor.position();
}

function expectFrameOrSequenceInput(cursor, argv, decimal) {
  if (argv[cursorIndex(cursor)] === "-framerate") {
    expectSequenceInput(cursor);
    return;
  }
  cursor.expect("-loop", "1", "-t");
  if (!decimal.test(cursor.take())) throw new TypeError("invalid frame duration");
  cursor.expect("-framerate");
  if (!/^\d{1,3}$/.test(cursor.take())) throw new TypeError("invalid frame rate");
  cursor.expect("-i");
  const framePath = cursor.take();
  if (!framePath.endsWith(".png") || !isSafeGeneratedPath(framePath)) throw new TypeError("invalid frame input");
}

function expectSequenceInput(cursor) {
  cursor.expect("-framerate");
  if (!/^\d{1,3}$/.test(cursor.take())) throw new TypeError("invalid sequence frame rate");
  cursor.expect("-start_number", "0", "-i");
  const pattern = cursor.take();
  if (!/^\/[A-Za-z0-9_./-]+-f%04d\.png$/.test(pattern) || !isSafeGeneratedPath(pattern.replace("%04d", "0000"))) {
    throw new TypeError("invalid sequence input");
  }
}

const KEN_BURNS_ZOOM_EXPRESSION =
  "(?:1\\+0\\.080\\*on\\/\\d+|1\\.080-0\\.080\\*on\\/\\d+|1\\.080)";
const KEN_BURNS_X_EXPRESSION =
  "(?:\\(iw-iw\\/zoom\\)\\/2|\\(iw-iw\\/zoom\\)\\*on\\/\\d+|\\(iw-iw\\/zoom\\)\\*\\(1-on\\/\\d+\\))";
const FILTER_SEGMENT_PATTERNS = Object.freeze([
  /^\[\d+:v\]scale=\d+:\d+,setsar=1,format=yuv420p\[v\d+\]$/,
  /^\[\d+:v\]scale=\d+:\d+:force_original_aspect_ratio=increase,crop=\d+:\d+,fps=\d+,eq=brightness=-?\d+(?:\.\d+)?:saturation=\d+(?:\.\d+)?,setsar=1\[b\d+\]$/,
  /^\[\d+:v\]setsar=1\[f\d+\]$/,
  /^\[b\d+\]\[f\d+\]overlay=0:0,format=yuv420p\[v\d+\]$/,
  /^(?:\[v\d+\])+concat=n=\d+:v=1:a=0\[vc\]$/,
  /^\[vc\]subtitles=filename=\/[A-Za-z0-9_./-]+:force_style='[A-Za-z0-9 =,]+'\[vout\]$/,
  new RegExp(
    "^\\[\\d+:v\\]scale=\\d+:\\d+:force_original_aspect_ratio=increase,crop=\\d+:\\d+," +
    `zoompan=z='${KEN_BURNS_ZOOM_EXPRESSION}':x='${KEN_BURNS_X_EXPRESSION}':y='\\(ih-ih\\/zoom\\)\\/2'` +
    ":d=1:s=\\d+x\\d+:fps=\\d+," +
    "eq=brightness=-?\\d+(?:\\.\\d+)?:saturation=\\d+(?:\\.\\d+)?,setsar=1\\[b\\d+\\]$"
  ),
  // Секвенция сцены: удержание последнего кадра и всё. Камера переехала в
  // разметку, поэтому zoompan здесь больше не разрешён.
  /^\[\d+:v\]fps=\d+,tpad=stop_mode=clone:stop_duration=\d+(?:\.\d{1,3})?,trim=duration=\d+(?:\.\d{1,3})?,setsar=1,format=yuv420p\[v\d+\]$/,
  /^\[\d+:v\]fps=\d+,tpad=stop_mode=clone:stop_duration=\d+(?:\.\d{1,3})?,trim=duration=\d+(?:\.\d{1,3})?,setsar=1\[f\d+\]$/
]);
const SCENE_SEGMENT_PATTERN_INDICES = Object.freeze([0, 1, 2, 3, 6, 7, 8]);

const MUSIC_SEGMENT_PATTERNS = Object.freeze([
  /^\[\d+:a\]aformat=sample_rates=\d+:channel_layouts=stereo,asetnsamples=n=1024:p=0,asplit=2\[nv\]\[nsc\]$/,
  /^\[\d+:a\]aformat=sample_rates=\d+:channel_layouts=stereo,volume=-?\d+(?:\.\d+)?dB,asetnsamples=n=1024:p=0\[mg\]$/,
  /^\[mg\]\[nsc\]sidechaincompress=threshold=0\.\d{1,4}:ratio=\d{1,2}:attack=\d{1,4}:release=\d{1,4}\[duck\]$/,
  /^\[nv\]\[duck\]amix=inputs=2:duration=first:dropout_transition=0:normalize=0\[mix\]$/,
  /^\[mix\]asetnsamples=n=1024:p=0,loudnorm=I=-?\d+(?:\.\d+)?:TP=-1\.5:LRA=11\[aout\]$/
]);

function validateComposedFilterGraph(filterComplex, { hasMusic = false } = {}) {
  if (/(?:[a-z][a-z0-9+.-]*:\/\/|authorization|cookie|--header)/i.test(filterComplex)) {
    throw new TypeError("invalid composed filter graph");
  }
  let segments = String(filterComplex).split(";");
  if (hasMusic) {
    if (segments.length < 3 + MUSIC_SEGMENT_PATTERNS.length) {
      throw new TypeError("invalid composed filter graph");
    }
    const musicSegments = segments.slice(-MUSIC_SEGMENT_PATTERNS.length);
    for (const [index, pattern] of MUSIC_SEGMENT_PATTERNS.entries()) {
      if (!pattern.test(musicSegments[index])) throw new TypeError("invalid music mix segment");
    }
    segments = segments.slice(0, -MUSIC_SEGMENT_PATTERNS.length);
  }
  if (segments.length < 3) throw new TypeError("invalid composed filter graph");
  const finalSegment = segments[segments.length - 1];
  const concatSegment = segments[segments.length - 2];
  if (!FILTER_SEGMENT_PATTERNS[5].test(finalSegment)) throw new TypeError("invalid subtitles segment");
  if (!FILTER_SEGMENT_PATTERNS[4].test(concatSegment)) throw new TypeError("invalid concat segment");
  for (const segment of segments.slice(0, -2)) {
    const matches = SCENE_SEGMENT_PATTERN_INDICES.some(
      patternIndex => FILTER_SEGMENT_PATTERNS[patternIndex].test(segment)
    );
    if (!matches) throw new TypeError("invalid scene filter segment");
  }
}

function argvCursor(argv) {
  let index = 0;
  return {
    expect(...expected) {
      for (const value of expected) {
        if (argv[index] !== value) throw new TypeError("unexpected argument");
        index += 1;
      }
    },
    take() {
      if (index >= argv.length) throw new TypeError("missing argument");
      const value = argv[index];
      index += 1;
      return value;
    },
    finish() {
      if (index !== argv.length) throw new TypeError("unexpected trailing argument");
    },
    position() {
      return index;
    },
    // Заглянуть вперёд, не сдвигая курсор: нужно, чтобы выбрать один из
    // объявленных профилей выдачи до того, как проверять его целиком.
    at(offset) {
      return argv[offset];
    }
  };
}

function isSafeGeneratedPath(value) {
  return /^\/[A-Za-z0-9_./-]+$/.test(value) && path.posix.normalize(value) === value;
}

function redactRunPath(argument) {
  if (argument.startsWith("file:///")) {
    return `file://<run>/${path.posix.basename(argument.slice("file://".length))}`;
  }
  if (argument.startsWith("/")) return `<run>/${path.posix.basename(argument)}`;
  return argument.replace(/(=)(\/[A-Za-z0-9_./-]+)/g, (_match, prefix, absolutePath) => (
    `${prefix}<run>/${path.posix.basename(absolutePath)}`
  ));
}

function normalizeQc(qc) {
  const source = qc && typeof qc === "object" && !Array.isArray(qc) ? qc : {};
  const normalized = {
    passed: source.passed === true,
    checks: uniqueText(source.checks)
  };
  if (source.loudness !== undefined) {
    normalized.loudness = normalizeLoudness(source.loudness);
  }
  return normalized;
}

function normalizeLoudness(loudness) {
  if (!loudness || typeof loudness !== "object" || Array.isArray(loudness)) {
    throw new TypeError("QC loudness report must be an object");
  }
  const normalized = {};
  for (const key of LOUDNESS_KEYS) {
    const value = Number(loudness[key]);
    if (!Number.isFinite(value)) {
      throw new TypeError(`QC loudness field ${key} must be a finite number`);
    }
    normalized[key] = value;
  }
  return normalized;
}

function normalizeLineage(lineage) {
  const source = lineage && typeof lineage === "object" && !Array.isArray(lineage) ? lineage : {};
  return {
    parents: uniqueText(source.parents),
    children: uniqueText(source.children)
  };
}

function uniqueText(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(safeText).filter(Boolean))];
}

function safeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function stableStringify(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, sortValue(value[key])])
  );
}
