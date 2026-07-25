#!/usr/bin/env node
// Проверяет, что визуал ролика действительно приехал.
//
// Пайплайн деградирует молча: если провайдер картинок или стокового видео
// ответил ошибкой, сцена собирается голым композером, в манифест падает
// warning — и рендер всё равно считается успешным. Снаружи это выглядит как
// «продукт выдал слайд-шоу», причём без единого сигнала о том, что что-то
// пошло не так. Этот скрипт превращает деградацию в падение.
//
//   node scripts/check-visual-coverage.mjs <manifest.json> [--min-live 0.8] [--min-footage 0]
//
// Титульная сцена в знаменатель не входит: пайплайн намеренно не подставляет
// под неё фон (src/media/render-project.js пропускает sceneIndex === 0).

import { readFileSync } from "node:fs";

const LIVE_ASSET_TYPES = new Set(["stock-footage", "generated-image"]);

function parseArgs(argv) {
  const [manifestPath, ...rest] = argv;
  if (!manifestPath) {
    throw new Error("usage: check-visual-coverage.mjs <manifest.json> [--min-live N] [--min-footage N]");
  }
  const options = { manifestPath, minLive: 0.8, minFootage: 0 };
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = Number(rest[index + 1]);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`${flag} expects a ratio within 0..1`);
    }
    if (flag === "--min-live") options.minLive = value;
    else if (flag === "--min-footage") options.minFootage = value;
    else throw new Error(`unknown flag: ${flag}`);
  }
  return options;
}

export function summarizeCoverage(manifest) {
  const scenes = Array.isArray(manifest?.scenes) ? manifest.scenes.length : 0;
  const footage = Array.isArray(manifest?.footage) ? manifest.footage : [];
  const eligible = Math.max(scenes - 1, 0);

  const byType = new Map();
  let live = 0;
  let stockFootage = 0;
  for (const asset of footage) {
    if (asset?.sceneIndex === 0) continue;
    const assetType = String(asset?.assetType || "unknown");
    byType.set(assetType, (byType.get(assetType) || 0) + 1);
    if (LIVE_ASSET_TYPES.has(assetType)) live += 1;
    if (assetType === "stock-footage") stockFootage += 1;
  }

  return {
    scenes,
    eligible,
    live,
    stockFootage,
    liveRatio: eligible ? live / eligible : 0,
    footageRatio: eligible ? stockFootage / eligible : 0,
    byType: Object.fromEntries(byType),
    warnings: Array.isArray(manifest?.warnings) ? manifest.warnings : []
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(readFileSync(options.manifestPath, "utf8"));
  const summary = summarizeCoverage(manifest);
  const percent = value => `${(value * 100).toFixed(0)}%`;

  const lines = [
    "### Visual coverage",
    "",
    "| field | value |",
    "|---|---|",
    `| scenes | ${summary.scenes} (${summary.eligible} can carry a background) |`,
    `| live visuals | ${summary.live} — **${percent(summary.liveRatio)}** (min ${percent(options.minLive)}) |`,
    `| stock footage | ${summary.stockFootage} — ${percent(summary.footageRatio)} (min ${percent(options.minFootage)}) |`,
    `| asset types | \`${JSON.stringify(summary.byType)}\` |`
  ];
  if (summary.warnings.length) {
    lines.push("", "Provider warnings:", "");
    for (const warning of summary.warnings) lines.push(`- ${warning}`);
  }
  const report = lines.join("\n");
  console.log(report);

  const failures = [];
  if (summary.liveRatio < options.minLive) {
    failures.push(`only ${percent(summary.liveRatio)} of scenes got a real visual, needed ${percent(options.minLive)}`);
  }
  if (summary.footageRatio < options.minFootage) {
    failures.push(`only ${percent(summary.footageRatio)} of scenes got stock footage, needed ${percent(options.minFootage)}`);
  }
  if (failures.length) {
    for (const failure of failures) console.error(`::error::${failure}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
