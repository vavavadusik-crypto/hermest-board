import path from "node:path";
import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";

import { createHash } from "node:crypto";

import {
  buildNarrationScript,
  buildStoryboard,
  reconcileStoryboardWithSceneDurations
} from "../domain/content-pipeline.js";
import { getPlatformRecipe } from "../domain/platform-recipes.js";
import {
  buildComposedVideoRenderArgs,
  buildNarrationCanonicalizeArgs,
  buildVideoRenderArgs,
  assertSafeGeneratedPath
} from "./ffmpeg-args.js";
import { composeSceneFrames, describeSceneComposerAvailability } from "./scene-frames.js";
import { createPexelsBrollAdapter, describeBrollAvailability } from "./broll-source.js";
import { createDefaultImageSourceCascade, hasKeyedImageProvider } from "./image-source.js";
import { createCachedImageAdapter } from "./asset-cache.js";
import { createBrollProviderRegistry } from "./broll-providers.js";

const DEFAULT_STYLE_PRESET = "cinematic dark tech aesthetic, deep blue and teal palette, volumetric light, high detail, no text, no watermark";
const MAX_GENERATED_BACKGROUNDS = 8;
import { loadMusicLibrary, selectMusicTrack } from "./music-library.js";
import { assertVideoProbe } from "./ffprobe.js";
import { buildRenderManifest, hashJson } from "./manifest.js";
import {
  describeArtifact,
  mediaToolVersion,
  probeMediaFile,
  runMediaTool
} from "./process-runner.js";
import { buildSubtitleCues, formatSrt } from "./subtitles.js";
import { selectNarrationAdapter } from "./narration.js";
import { concatNarrationWavBuffers } from "./wav-concat.js";
import { measureRenderedLoudness } from "./loudness.js";
import { validateJsonStructure } from "./structural-preflight.js";

const MAX_BOARD_INPUT_BYTES = 2 * 1024 * 1024;
const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIRECTORY_MODE = 0o700;

export async function renderProject({
  inputPath,
  project: projectInput,
  outputDir,
  platform = "youtube_video",
  ttsAdapter = null,
  signal,
  onProgress = null
}) {
  // Прогресс — best-effort телеметрия для job-записи (контракт —
  // the progress contract): фазы preflight → scenes → audio →
  // encode → finalize; done проставляет только job-manager на completed.
  const reportProgress = createRenderProgressReporter(onProgress);
  reportProgress({ phase: "preflight", label: "Подготовка проекта" });
  signal?.throwIfAborted();
  const project = projectInput === undefined
    ? await preflightBoardInput(inputPath)
    : validateBoardProject(projectInput);
  // Env-override делает рендер герметичным (для гейта/офлайна): форсирует режим
  // без обращения к сети, не меняя продуктовый дефолт (auto с бесплатным Pollinations).
  const brollModeOverride = typeof process.env.HERMEST_BROLL_MODE === "string" && process.env.HERMEST_BROLL_MODE
    ? process.env.HERMEST_BROLL_MODE
    : undefined;
  const brollMode = validateBrollMode(brollModeOverride ?? project?.brief?.brollMode);
  const estimatedStoryboard = buildStoryboard(project);
  const narration = buildNarrationScript(estimatedStoryboard);
  const recipe = getPlatformRecipe(platform);
  const outputRoot = await resolveOutputRoot(outputDir);
  const runDir = assertSafeGeneratedPath(await mkdtemp(path.join(outputRoot, `${recipe.platformId}-`)));
  await chmod(runDir, PRIVATE_DIRECTORY_MODE);
  let completed = false;

  try {
    const narrationPartial = path.join(runDir, "narration.partial.wav");
    const narrationAudioFile = path.join(runDir, "narration.wav");
    const narrationLanguage = project?.brief?.language || "en";
    const narrationVoice = typeof project?.brief?.voice === "string" && project.brief.voice
      ? project.brief.voice
      : undefined;
    const narrationAdapter = ttsAdapter || await selectNarrationAdapter({
      language: narrationLanguage,
      voice: narrationVoice,
      provider: project?.brief?.narrationProvider
    });

    const narrationCommands = [];
    const sceneNarrations = [];
    let sceneTtsMetadata = null;
    const ttsWarnings = new Set();
    for (const [sceneIndex, scene] of estimatedStoryboard.scenes.entries()) {
      reportProgress({
        phase: "scenes",
        sceneIndex,
        sceneTotal: estimatedStoryboard.scenes.length,
        label: `Сцена ${sceneIndex + 1} из ${estimatedStoryboard.scenes.length}`
      });
      const sceneTag = String(sceneIndex + 1).padStart(3, "0");
      const sceneRawFile = path.join(runDir, `narration-scene-${sceneTag}.raw.wav`);
      const sceneWavFile = path.join(runDir, `narration-scene-${sceneTag}.wav`);
      const sceneTts = await narrationAdapter.synthesize({
        text: scene.narration,
        language: narrationLanguage,
        voice: narrationVoice,
        outputPath: sceneRawFile,
        signal
      });
      sceneTtsMetadata = sceneTtsMetadata || sceneTts;
      for (const warning of sceneTts.warnings || []) ttsWarnings.add(warning);
      if (sceneTts.command) narrationCommands.push(sceneTts.command);
      const canonicalizeCommand = {
        id: "narration-canonicalize",
        tool: "ffmpeg",
        argv: buildNarrationCanonicalizeArgs({
          inputFile: sceneRawFile,
          outputFile: sceneWavFile
        })
      };
      await runMediaTool(canonicalizeCommand.tool, canonicalizeCommand.argv, {
        timeoutMs: 300000,
        signal
      });
      narrationCommands.push(canonicalizeCommand);
      await rm(sceneRawFile, { force: true });
      const sceneProbe = await probeMediaFile(sceneWavFile, { signal });
      if (!sceneProbe.audio) {
        throw new TypeError(`Scene ${scene.id} narration does not contain an audio stream`);
      }
      sceneNarrations.push({
        file: sceneWavFile,
        durationMs: Math.ceil(sceneProbe.durationSeconds * 1000)
      });
    }

    reportProgress({ phase: "audio", label: "Сборка озвучки" });
    const storyboard = reconcileStoryboardWithSceneDurations(
      estimatedStoryboard,
      sceneNarrations.map(sceneNarration => sceneNarration.durationMs)
    );
    const sceneWavBuffers = await Promise.all(
      sceneNarrations.map(sceneNarration => readFile(sceneNarration.file))
    );
    const combinedNarration = concatNarrationWavBuffers(
      sceneWavBuffers,
      storyboard.scenes.map(scene => scene.durationMs)
    );
    await writeFile(narrationPartial, combinedNarration, {
      flag: "wx",
      mode: PRIVATE_FILE_MODE
    });
    await Promise.all(sceneNarrations.map(sceneNarration => rm(sceneNarration.file, { force: true })));
    const narrationProbe = await probeMediaFile(narrationPartial, { signal });
    if (!narrationProbe.audio) throw new TypeError("Narration output does not contain an audio stream");
    await rename(narrationPartial, narrationAudioFile);

    const tts = {
      ...sceneTtsMetadata,
      durationSeconds: Number(narrationProbe.durationSeconds),
      sampleRate: Number(narrationProbe.audio.sampleRate || 0),
      channels: Number(narrationProbe.audio.channels || 0),
      codec: String(narrationProbe.audio.codec || "unknown"),
      scriptSha256: createHash("sha256").update(narration).digest("hex"),
      warnings: [...ttsWarnings],
      command: null
    };
    const storyboardFile = path.join(runDir, "storyboard.json");
    const subtitleFile = path.join(runDir, "narration.srt");
    await atomicWriteFile(storyboardFile, `${JSON.stringify(storyboard, null, 2)}\n`);
    await atomicWriteFile(subtitleFile, formatSrt(buildSubtitleCues(storyboard, {
      width: recipe.width,
      subtitleLayout: recipe.subtitleLayout
    })));

    // «encode» покрывает весь этап сборки видео: подбор футажей/фонов,
    // композицию кадров и сам ffmpeg-рендер — порядок фаз остаётся монотонным.
    reportProgress({ phase: "encode", label: "Кодирование видео" });
    const videoName = `${recipe.id}.mp4`;
    const videoPartial = path.join(runDir, `${recipe.id}.partial.mp4`);
    const videoFile = path.join(runDir, videoName);
    const composerAvailability = await describeSceneComposerAvailability();
    let renderCommand;
    let sceneFrameCommands = [];
    let sceneComposer = null;
    const footage = [];
    const footageWarnings = [];
    let musicTrack = null;
    if (composerAvailability.status === "executable") {
      const brollRegistry = createBrollProviderRegistry({ onWarning: msg => footageWarnings.push(msg) });
      const brollProviders = brollRegistry.buildCascade(brollMode);
      const brollClips = [];
      const brollOrientation = recipe.height > recipe.width ? "portrait" : "landscape";

      // Сток-видео и генераторы изображений ищут по-английски: русский
      // заголовок карточки они фактически игнорируют и возвращают случайный
      // кадр. `visualQuery` — явное описание того, что должно быть в кадре;
      // без него остаётся прежнее поведение.
      const cardsById = new Map((Array.isArray(project?.cards) ? project.cards : []).map(card => [card?.id, card]));
      const visualQueryFor = scene => {
        const raw = cardsById.get(scene?.cardId)?.visualQuery;
        return typeof raw === "string" && raw.trim() ? raw.trim() : null;
      };

      for (const [sceneIndex, scene] of storyboard.scenes.entries()) {
        if (sceneIndex === 0) continue;
        const clipFile = path.join(runDir, `broll-${String(sceneIndex + 1).padStart(3, "0")}.mp4`);
        const result = await runBrollCascade({
          providers: brollProviders.filter(p => p.kind === "stock-footage"),
          request: {
            keywords: visualQueryFor(scene) ? [visualQueryFor(scene)] : [project?.brief?.topic, scene.title].filter(Boolean),
            orientation: brollOrientation,
            minDurationSeconds: scene.durationMs / 1000,
            outputPath: clipFile,
            signal
          },
          onWarning: msg => footageWarnings.push(`scene ${sceneIndex + 1}: ${msg}`)
        });
        if (result) {
          brollClips[sceneIndex] = result;
          footage.push({
            sceneIndex,
            assetType: result.assetType,
            license: result.license,
            sha256: result.sha256,
            provenance: result.provenance
          });
        }
      }
      const backgroundImages = [];
      const scenesWithoutFootage = storyboard.scenes.filter(
        (_scene, sceneIndex) => sceneIndex > 0 && !brollClips[sceneIndex]
      ).length;

      if (scenesWithoutFootage > 0 && brollMode !== "deterministic") {
        const imageProviders = brollProviders.filter(p => p.kind === "generated-image");
        const projectSeed = Number.parseInt(hashJson(project).slice(0, 8), 16);
        const stylePreset = typeof project?.brief?.stylePreset === "string" && project.brief.stylePreset.trim()
          ? project.brief.stylePreset.trim()
          : DEFAULT_STYLE_PRESET;
        let generatedCount = 0;

        for (const [sceneIndex, scene] of storyboard.scenes.entries()) {
          if (sceneIndex === 0 || brollClips[sceneIndex]) continue;
          if (generatedCount >= MAX_GENERATED_BACKGROUNDS) {
            footageWarnings.push(`generated background budget of ${MAX_GENERATED_BACKGROUNDS} reached`);
            break;
          }
          const backgroundFile = path.join(runDir, `bg-${String(sceneIndex + 1).padStart(3, "0")}.png`);
          const result = await runBrollCascade({
            providers: imageProviders,
            request: {
              prompt: visualQueryFor(scene)
                || [project?.brief?.topic, scene.title, scene.narration.split(/(?<=[.!?…])\s+/)[0]]
                  .filter(Boolean).join(". "),
              stylePreset,
              width: recipe.width,
              height: recipe.height,
              seed: projectSeed + sceneIndex,
              outputPath: backgroundFile,
              signal
            },
            onWarning: msg => footageWarnings.push(`scene ${sceneIndex + 1}: ${msg}`)
          });
          if (result) {
            backgroundImages[sceneIndex] = result;
            generatedCount += 1;
            footage.push({
              sceneIndex,
              assetType: result.assetType,
              license: result.license,
              sha256: result.sha256,
              provenance: result.provenance
            });
          }
        }
      }
      const musicPreference = typeof project?.brief?.music === "string" ? project.brief.music.trim() : "";
      if (musicPreference !== "off") {
        try {
          const musicTracks = await loadMusicLibrary();
          musicTrack = selectMusicTrack(musicTracks, { mood: musicPreference || undefined });
          if (!musicTrack) {
            footageWarnings.push("music library has no matching track; rendering without music bed");
          }
        } catch (error) {
          musicTrack = null;
          footageWarnings.push(`music library unavailable: ${error.message}`);
        }
      }
      const composition = await composeSceneFrames({
        storyboard,
        brief: project?.brief,
        recipe,
        runDir,
        seed: Number.parseInt(hashJson(project).slice(0, 8), 16),
        brollClips,
        backgroundImages,
        signal
      });
      sceneFrameCommands = composition.commands;
      sceneComposer = composition.composer;

      // Deterministic fallback: для сцен без footage добавляем synthetic entry
      for (const [sceneIndex] of storyboard.scenes.entries()) {
        const hasFootage = footage.some(f => f.sceneIndex === sceneIndex);
        if (!hasFootage) {
          footage.push({
            sceneIndex,
            assetType: "deterministic",
            license: "n/a",
            sha256: "0".repeat(64),
            provenance: {
              source: "deterministic",
              provider: "hermest-board-scene-composer"
            }
          });
        }
      }
      renderCommand = {
        id: "render-composed",
        tool: "ffmpeg",
        argv: buildComposedVideoRenderArgs({
          sceneFrames: composition.frames,
          audioFile: narrationAudioFile,
          subtitleFile,
          outputFile: videoPartial,
          durationSeconds: narrationProbe.durationSeconds,
          recipe,
          music: musicTrack ? { path: musicTrack.path } : undefined
        })
      };
      try {
        await runMediaTool(renderCommand.tool, renderCommand.argv, {
          timeoutMs: 300000,
          signal
        });
      } finally {
        await Promise.all(composition.frames.map(frame => rm(frame.path, { force: true })));
        await Promise.all(brollClips.filter(Boolean).map(clip => rm(clip.path, { force: true })));
        await Promise.all(backgroundImages.filter(Boolean).map(image => rm(image.path, { force: true })));
      }
    } else {
      let sceneCursorMs = 0;
      const sceneTitleFiles = [];
      for (const [index, scene] of storyboard.scenes.entries()) {
        const titleFile = path.join(runDir, `scene-${String(index + 1).padStart(3, "0")}.txt`);
        await writeFile(titleFile, `${scene.title}\n`, {
          encoding: "utf8",
          flag: "wx",
          mode: PRIVATE_FILE_MODE
        });
        sceneTitleFiles.push({
          path: titleFile,
          startSeconds: sceneCursorMs / 1000,
          endSeconds: (sceneCursorMs + scene.durationMs) / 1000
        });
        sceneCursorMs += scene.durationMs;
      }
      renderCommand = {
        id: "render",
        tool: "ffmpeg",
        argv: buildVideoRenderArgs({
          audioFile: narrationAudioFile,
          subtitleFile,
          outputFile: videoPartial,
          durationSeconds: narrationProbe.durationSeconds,
          sceneTitleFiles,
          recipe
        })
      };
      try {
        await runMediaTool(renderCommand.tool, renderCommand.argv, {
          timeoutMs: 300000,
          signal
        });
      } finally {
        await Promise.all(sceneTitleFiles.map(scene => rm(scene.path, { force: true })));
      }
    }
    reportProgress({ phase: "finalize", label: "Проверка качества и манифест" });
    const videoProbe = assertVideoProbe(
      await probeMediaFile(videoPartial, { signal }),
      recipe,
      { expectedDurationSeconds: narrationProbe.durationSeconds }
    );
    const { command: loudnessCommand, loudness } = await measureRenderedLoudness(videoPartial, { signal });
    await chmod(videoPartial, PRIVATE_FILE_MODE);
    await rename(videoPartial, videoFile);

    const artifacts = await Promise.all([
      describeArtifact(storyboardFile, {
        name: "storyboard.json",
        type: "application/json",
        probe: { schemaVersion: storyboard.schemaVersion, scenes: storyboard.scenes.length }
      }),
      describeArtifact(narrationAudioFile, {
        name: "narration.wav",
        type: "audio/wav",
        probe: narrationProbe
      }),
      describeArtifact(subtitleFile, {
        name: "narration.srt",
        type: "application/x-subrip",
        probe: { durationSeconds: narrationProbe.durationSeconds }
      }),
      describeArtifact(videoFile, {
        name: videoName,
        type: "video/mp4",
        probe: videoProbe
      })
    ]);

    const commands = [...narrationCommands, ...sceneFrameCommands, renderCommand, loudnessCommand];
    const manifestTools = {
      ffmpeg: await mediaToolVersion("ffmpeg", { signal }),
      ffprobe: await mediaToolVersion("ffprobe", { signal }),
      renderer: "hermest-board-media-r1",
      tts
    };
    if (sceneComposer) manifestTools.sceneComposer = sceneComposer;
    const manifest = buildRenderManifest({
      project,
      storyboard,
      recipe,
      tools: manifestTools,
      commands,
      qc: {
        passed: true,
        checks: [
          "input_preflight",
          "storyboard_schema",
          "narration_audio_probe",
          "subtitle_timeline",
          sceneComposer ? "composed_scene_frames" : "legacy_color_scenes",
          ...(footage.length > 0 ? ["broll_footage_provenance"] : []),
          ...(musicTrack ? ["music_bed_ducking"] : []),
          "video_streams_codecs_dimensions_duration",
          "audio_loudness_measured",
          "artifact_hashes"
        ],
        loudness
      },
      blockers: recipe.readinessBlockers,
      footage,
      music: musicTrack
        ? {
            id: musicTrack.id,
            title: musicTrack.title,
            mood: musicTrack.mood,
            license: musicTrack.license,
            source: musicTrack.source,
            sha256: musicTrack.sha256
          }
        : null,
      warnings: sceneComposer
        ? [...tts.warnings, ...footageWarnings]
        : [...tts.warnings, "scene composer unavailable; legacy color scenes used"],
      lineage: {
        parents: [`project:${project.projectId || hashJson(project)}`],
        children: artifacts.map(artifact => `artifact:${artifact.sha256}`)
      },
      artifacts
    });
    const manifestName = `${recipe.id}.manifest.json`;
    const manifestPath = path.join(runDir, manifestName);
    await atomicWriteFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const manifestArtifact = await describeArtifact(manifestPath, {
      name: manifestName,
      type: "application/json",
      probe: { schemaVersion: manifest.schemaVersion }
    });
    const manifestHashPath = path.join(runDir, `${manifestName}.sha256`);
    await atomicWriteFile(
      manifestHashPath,
      `${manifestArtifact.sha256}  ${manifestName}\n`
    );

    completed = true;
    return {
      outputDir: runDir,
      platform: recipe.platformId,
      recipeId: recipe.id,
      manifestPath,
      manifestHashPath,
      manifestArtifact,
      videoFile,
      subtitleFile,
      narrationAudioFile,
      storyboardFile,
      manifest
    };
  } finally {
    if (!completed) await rm(runDir, { recursive: true, force: true });
  }
}

// Сломанный или отсутствующий reporter не имеет права уронить рендер:
// телеметрия строго best-effort.
function createRenderProgressReporter(onProgress) {
  if (typeof onProgress !== "function") return () => {};
  return update => {
    try {
      onProgress(update);
    } catch {
      // Прогресс потерян — рендер продолжается.
    }
  };
}

export async function preflightBoardInput(inputPath) {
  const resolvedInput = path.resolve(inputPath);
  const info = await stat(resolvedInput);
  if (!info.isFile()) throw new TypeError("Board input must be a regular file");
  if (info.size <= 0 || info.size > MAX_BOARD_INPUT_BYTES) {
    throw new RangeError(`Board input file exceeds the ${MAX_BOARD_INPUT_BYTES} byte limit`);
  }
  const raw = await readFile(resolvedInput, "utf8");
  let project;
  try {
    project = JSON.parse(raw);
  } catch {
    throw new TypeError("Board input must contain valid JSON");
  }
  return validateBoardProject(project);
}

export function validateBoardProject(project) {
  validateJsonStructure(project);
  buildStoryboard(project);
  hashJson(project);
  return project;
}

export async function resolveOutputRoot(outputDir) {
  const requested = path.resolve(outputDir);
  const resolved = assertSafeGeneratedPath(await realpath(requested));
  const info = await stat(resolved);
  if (!info.isDirectory()) throw new TypeError("Render output root must be an existing directory");
  const configuredRoots = await resolveAllowedRoots();
  return assertAllowedOutputDirectory(resolved, configuredRoots);
}

async function resolveAllowedRoots() {
  return [await realpath("/tmp")];
}

async function atomicWriteFile(filePath, content) {
  const finalPath = assertSafeGeneratedPath(filePath);
  const partialPath = assertSafeGeneratedPath(`${filePath}.partial`);
  await writeFile(partialPath, content, {
    encoding: "utf8",
    flag: "wx",
    mode: PRIVATE_FILE_MODE
  });
  await rename(partialPath, finalPath);
  return finalPath;
}

export function assertAllowedOutputDirectory(outputDir, allowedRoots) {
  const candidate = assertSafeGeneratedPath(path.resolve(outputDir));
  for (const configuredRoot of allowedRoots) {
    const root = path.resolve(configuredRoot);
    const relative = path.relative(root, candidate);
    if (relative === "") return candidate;
    if (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)) {
      return candidate;
    }
  }
  throw new TypeError("Render output is outside allowed render roots");
}

export async function assertEmptyOutputDirectory(outputDir) {
  const entries = await readdir(outputDir);
  if (entries.length > 0) throw new TypeError("Render output directory must be empty");
  return outputDir;
}

export async function runBrollCascade({ providers, request, onWarning = () => {} }) {
  let lastError = null;
  for (const provider of providers) {
    try {
      const result = await provider.fetchMedia(request);
      if (result === null) {
        onWarning(`${provider.id}: no match for request`);
        continue;
      }
      return {
        ...result,
        assetType: provider.kind
      };
    } catch (error) {
      lastError = error;
      onWarning(`${provider.id} failed: ${error.message}`);
      if (error?.name === "AbortError" || request.signal?.aborted) {
        throw error;
      }
    }
  }
  return null;
}

const VALID_BROLL_MODES = Object.freeze(["auto", "free", "premium", "deterministic"]);

export function validateBrollMode(mode) {
  if (mode === undefined) return "auto";
  if (typeof mode !== "string") {
    throw new TypeError("Invalid brollMode: must be a string");
  }
  if (!VALID_BROLL_MODES.includes(mode)) {
    throw new RangeError(`Invalid brollMode: "${mode}" (allowed: ${VALID_BROLL_MODES.join(", ")})`);
  }
  return mode;
}
