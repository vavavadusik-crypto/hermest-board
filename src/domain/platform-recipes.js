const RECIPES = Object.freeze([
  recipe({
    id: "youtube-16x9-1080p",
    platformId: "youtube_video",
    label: "YouTube 16:9 master",
    width: 1920,
    height: 1080,
    adaptationMode: "master",
    segmentationStrategy: "master",
    maxDurationSeconds: 21600,
    safeZones: { top: 54, right: 96, bottom: 54, left: 96 },
    readinessBlockers: []
  }),
  recipe({
    id: "shorts-9x16-1080p",
    platformId: "youtube_shorts",
    label: "YouTube Shorts 9:16",
    width: 1080,
    height: 1920,
    adaptationMode: "aspect_only_r1",
    segmentationStrategy: "aspect_only_r1",
    maxDurationSeconds: 180,
    safeZones: { top: 200, right: 96, bottom: 300, left: 96 },
    readinessBlockers: ["semantic_edit_not_implemented"]
  }),
  recipe({
    id: "tiktok-9x16-1080p",
    platformId: "tiktok",
    label: "TikTok 9:16",
    width: 1080,
    height: 1920,
    adaptationMode: "aspect_only_r1",
    segmentationStrategy: "aspect_only_r1",
    maxDurationSeconds: 180,
    safeZones: { top: 200, right: 160, bottom: 320, left: 80 },
    readinessBlockers: ["semantic_edit_not_implemented"]
  }),
  recipe({
    id: "instagram-1x1-1080p",
    platformId: "instagram_feed",
    label: "Instagram feed 1:1",
    width: 1080,
    height: 1080,
    adaptationMode: "aspect_only_r1",
    segmentationStrategy: "aspect_only_r1",
    // Осознанно консервативно: лимит ленты не проверялся против действующей
    // политики площадки, поэтому рецепт несёт об этом явный blocker. Слишком
    // короткий предел даст честную ошибку валидации, слишком длинный — отказ
    // на загрузке, когда коннектор появится.
    maxDurationSeconds: 900,
    policyObservedAt: "2026-07-26",
    // Интерфейс площадки в ленте лежит вне самого кадра, поэтому защитные зоны
    // скромнее, чем у 9:16; низ шире остальных сторон — под выжигаемый субтитр.
    safeZones: { top: 72, right: 72, bottom: 120, left: 72 },
    readinessBlockers: ["semantic_edit_not_implemented", "platform_policy_unverified"]
  }),
  recipe({
    id: "reels-9x16-1080p",
    platformId: "instagram_reels",
    label: "Instagram Reels 9:16",
    width: 1080,
    height: 1920,
    adaptationMode: "aspect_only_r1",
    segmentationStrategy: "aspect_only_r1",
    maxDurationSeconds: 180,
    safeZones: { top: 220, right: 96, bottom: 320, left: 96 },
    readinessBlockers: ["semantic_edit_not_implemented"]
  })
]);

export function getPlatformRecipe(id) {
  const found = RECIPES.find(entry => entry.platformId === id || entry.id === id);
  if (!found) throw new RangeError(`Unsupported platform recipe: ${id}`);
  return structuredClone(found);
}

export function listPlatformRecipes() {
  return RECIPES.map(entry => structuredClone(entry));
}

function recipe({
  id,
  platformId,
  label,
  width,
  height,
  adaptationMode,
  segmentationStrategy,
  maxDurationSeconds,
  safeZones,
  readinessBlockers,
  policyObservedAt = "2026-07-13"
}) {
  return Object.freeze({
    schemaVersion: 1,
    version: "1.0.0",
    policyObservedAt,
    id,
    platformId,
    label,
    width,
    height,
    fps: 30,
    pixelFormat: "yuv420p",
    videoCodec: "libx264",
    audioCodec: "aac",
    audioSampleRate: 48000,
    audioChannels: 2,
    loudnessTargetLufs: -16,
    subtitleMode: "burn_and_sidecar",
    subtitleLayout: Object.freeze({
      mode: "burn_and_sidecar",
      maxLines: 2,
      horizontalAlign: "center",
      verticalAnchor: "bottom_safe_zone"
    }),
    transitionPolicy: "cut_r1",
    safeZones: Object.freeze({ ...safeZones }),
    adaptationMode,
    segmentationStrategy,
    maxDurationSeconds,
    durationPolicy: "versioned_platform_policy",
    readinessBlockers: Object.freeze([...readinessBlockers])
  });
}
