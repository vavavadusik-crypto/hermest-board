import { planConnectorCapability } from "./connector-capabilities.js";

export function buildAgentPlan(pack = {}, options = {}) {
  const platforms = boundedStrings(pack.platforms, 16);
  const tools = boundedStrings(pack.tools, 32);
  const languages = boundedStrings(pack.languages, 32);
  const context = {
    env: options.env || process.env,
    runtime: options.runtime || "server",
    configuredProviderIds: boundedStrings(pack.configuredProviderIds, 64)
  };
  const connectorRoutes = selectedCapabilityIds(platforms, tools)
    .map(capabilityId => planConnectorCapability(capabilityId, context));
  const routeById = new Map(connectorRoutes.map(route => [route.id, route]));
  const publishRoute = routeById.get("publish.draft");
  const mediaReady = mediaPreparationReady(tools, routeById);
  const steps = [
    step("parse_board", tools.includes("parser"), "Разобрать карточки, план, roadmap и research query."),
    step("research_sources", tools.includes("parser") && routeReady(routeById, "research.search"), "Собрать публичные источники через research API и сохранить ссылки."),
    step("rights_check", tools.includes("rights_check"), "Проверить лицензии и права на внешние материалы."),
    step("translate", tools.includes("translator") && languages.length > 0, "Подготовить локализации сценария, описаний, хэштегов и субтитров."),
    step("prepare_media", mediaReady, "Подобрать или сгенерировать b-roll, обложки, вертикальные и горизонтальные ассеты."),
    step("render_versions", true, "Собрать 9:16 версии для Shorts/Reels/TikTok и 16:9 версию для YouTube."),
    step("approval_gate", true, "Связать immutable candidate и запросить точное решение человека."),
    step("publish_drafts", Boolean(publishRoute?.executable), "Создать черновики только через реализованные OAuth adapters после точного approval."),
    step("audit_report", true, "Сохранить ссылки, ошибки, метрики и следующий action plan.")
  ];
  const blockers = [];

  if (!platforms.length) blockers.push("platforms_not_selected");
  for (const platform of platforms) {
    const provider = providerForPlatform(platform);
    if (provider) blockers.push(`${provider}_oauth_token_exchange_not_implemented`);
  }
  if (tools.includes("generated_media")) {
    const imageRoute = routeById.get("image.generate");
    const videoRoute = routeById.get("video.generate");
    if (!imageRoute?.executable) blockers.push("image_generate_adapter_not_implemented");
    if (!videoRoute?.executable) blockers.push("video_generate_adapter_not_implemented");
  }
  if (!routeReady(routeById, "speech.synthesize")) blockers.push("quality_tts_adapter_not_ready");
  if (!routeReady(routeById, "storage.put")) blockers.push("durable_object_storage_adapter_not_implemented");
  blockers.push(...(publishRoute?.blockers || []).map(blocker => `publish_${blocker}`));

  return {
    ok: true,
    status: blockers.length ? "blocked_until_connectors_and_storage" : "ready_for_human_approval",
    canAutopublish: false,
    blockers: unique(blockers),
    connectors: publishConnectorExecutionStatus(publishRoute),
    connectorRoutes,
    steps,
    note: "Autopublish remains disabled. Configuration is not execution readiness; OAuth exchange, durable candidates, implemented adapters and exact human approval are required."
  };
}

function selectedCapabilityIds(platforms, tools) {
  const ids = ["research.search", "speech.synthesize", "storage.put"];
  if (tools.includes("web_media")) ids.push("media.search");
  if (tools.includes("generated_media")) ids.push("image.generate", "video.generate");
  if (tools.includes("translator") || tools.includes("ai_text")) ids.push("text.generate");
  if (platforms.length) ids.push("publish.draft", "analytics.read");
  return unique(ids);
}

function mediaPreparationReady(tools, routeById) {
  if (tools.includes("web_media") && routeReady(routeById, "media.search")) return true;
  if (tools.includes("generated_media")) {
    return routeReady(routeById, "image.generate") || routeReady(routeById, "video.generate");
  }
  return false;
}

function routeReady(routeById, id) {
  return Boolean(routeById.get(id)?.executable);
}

function step(id, ready, description) {
  return {
    id,
    status: ready ? "ready" : "blocked",
    description
  };
}

function publishConnectorExecutionStatus(route) {
  const providerIds = ["youtube", "tiktok", "instagram"];
  return Object.fromEntries(providerIds.map(providerId => {
    const provider = route?.providers.find(item => item.id === providerId);
    return [providerId, {
      configured: Boolean(provider?.configured),
      state: provider?.state || "blocked",
      executable: false
    }];
  }));
}

function providerForPlatform(platform) {
  if (platform === "youtube_video" || platform === "youtube_shorts") return "youtube";
  if (platform === "instagram_reels" || platform === "instagram_feed") return "instagram";
  if (platform === "tiktok") return "tiktok";
  return "";
}

function boundedStrings(value, limit) {
  return (Array.isArray(value) ? value : [])
    .map(item => String(item || "").trim())
    .filter(Boolean)
    .slice(0, limit);
}

function unique(values) {
  return [...new Set(values)];
}
