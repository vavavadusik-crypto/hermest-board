/**
 * Platform publishing status for frontend consumption.
 *
 * Returns availability, mode, auth requirements, and honest blocker reasons
 * for each publishing platform.
 */

const PLATFORMS = Object.freeze([
  {
    platform: "webhook_export",
    available: true,
    mode: "draft",
    requiresAuth: false,
    statusReason: "ready",
    capabilities: {
      acceptsManifest: true,
      acceptsPublishPack: true,
      maxRetries: 3,
      supportsIdempotency: true,
      supportsCancellation: true
    }
  },
  {
    platform: "youtube_video",
    available: false,
    mode: "unavailable",
    requiresAuth: true,
    statusReason: getYouTubeStatusReason(),
    capabilities: {
      maxDuration: 43200, // 12 hours
      aspectRatios: ["16:9"],
      formats: ["mp4"],
      maxSize: 137438953472, // 128 GB
      privacyModes: ["public", "unlisted", "private"]
    }
  },
  {
    platform: "youtube_shorts",
    available: false,
    mode: "unavailable",
    requiresAuth: true,
    statusReason: getYouTubeStatusReason(),
    capabilities: {
      maxDuration: 60,
      aspectRatios: ["9:16"],
      formats: ["mp4"],
      maxSize: 137438953472,
      privacyModes: ["public", "unlisted", "private"]
    }
  },
  {
    platform: "tiktok",
    available: false,
    mode: "unavailable",
    requiresAuth: true,
    statusReason: getTikTokStatusReason(),
    capabilities: {
      maxDuration: 600, // 10 minutes
      aspectRatios: ["9:16"],
      formats: ["mp4"],
      maxSize: 287762808, // 274 MB
      privacyModes: ["public", "friends", "private"]
    }
  },
  {
    platform: "instagram_reels",
    available: false,
    mode: "unavailable",
    requiresAuth: true,
    statusReason: getInstagramStatusReason(),
    capabilities: {
      maxDuration: 90,
      aspectRatios: ["9:16"],
      formats: ["mp4"],
      maxSize: 104857600, // 100 MB
      privacyModes: ["public", "private"]
    }
  },
  {
    platform: "instagram_feed",
    available: false,
    mode: "unavailable",
    requiresAuth: true,
    statusReason: getInstagramStatusReason(),
    capabilities: {
      // Значения не сверялись с действующей политикой площадки — рецепт несёт
      // об этом blocker `platform_policy_unverified`, и здесь та же оговорка.
      maxDuration: 900,
      aspectRatios: ["1:1"],
      formats: ["mp4"],
      maxSize: 104857600, // 100 MB
      privacyModes: ["public", "private"]
    }
  }
]);

/**
 * Gets platform publishing status for all platforms.
 *
 * @returns {object} Status response
 */
export function getPlatformPublishingStatus() {
  return {
    ok: true,
    schema: "hermest.platform.publishing-status.v1",
    platforms: PLATFORMS.map(platform => ({
      ...platform,
      // Re-evaluate statusReason dynamically (env may change)
      statusReason: platform.platform === "webhook_export"
        ? platform.statusReason
        : platform.platform === "youtube_video" || platform.platform === "youtube_shorts"
        ? getYouTubeStatusReason()
        : platform.platform === "tiktok"
        ? getTikTokStatusReason()
        : getInstagramStatusReason()
    })),
    note: "Draft mode is default. Live publishing requires explicit confirm flag per publish call."
  };
}

/**
 * Gets status for a specific platform.
 *
 * @param {string} platformId - Platform ID
 * @returns {object | null} Platform status or null if not found
 */
export function getPlatformStatus(platformId) {
  const status = getPlatformPublishingStatus();
  return status.platforms.find(p => p.platform === platformId) || null;
}

function getYouTubeStatusReason() {
  const hasClientId = Boolean(process.env.YOUTUBE_CLIENT_ID);
  const hasClientSecret = Boolean(process.env.YOUTUBE_CLIENT_SECRET);
  const hasRedirectUri = Boolean(process.env.YOUTUBE_REDIRECT_URI);

  if (!hasClientId || !hasClientSecret || !hasRedirectUri) {
    return "needs_oauth_app — Client ID and Secret not configured. Register OAuth app at https://console.cloud.google.com/";
  }

  return "adapter_not_implemented — OAuth credentials configured, but publish adapter not yet implemented.";
}

function getTikTokStatusReason() {
  const hasClientId = Boolean(process.env.TIKTOK_CLIENT_ID);
  const hasClientSecret = Boolean(process.env.TIKTOK_CLIENT_SECRET);
  const hasRedirectUri = Boolean(process.env.TIKTOK_REDIRECT_URI);

  if (!hasClientId || !hasClientSecret || !hasRedirectUri) {
    return "needs_oauth_app — Client ID and Secret not configured. Register app at https://developers.tiktok.com/";
  }

  return "adapter_not_implemented — OAuth credentials configured, but publish adapter not yet implemented.";
}

function getInstagramStatusReason() {
  const hasAppId = Boolean(process.env.META_APP_ID);
  const hasAppSecret = Boolean(process.env.META_APP_SECRET);
  const hasRedirectUri = Boolean(process.env.META_REDIRECT_URI);

  if (!hasAppId || !hasAppSecret || !hasRedirectUri) {
    return "needs_oauth_app — Meta App ID and Secret not configured. Register app at https://developers.facebook.com/";
  }

  return "adapter_not_implemented — OAuth credentials configured, but publish adapter not yet implemented.";
}
