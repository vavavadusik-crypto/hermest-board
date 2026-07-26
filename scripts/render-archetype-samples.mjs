#!/usr/bin/env node
// Рендерит по одному кадру каждого архетипа сцены в 16:9 и 9:16 через тот же
// композер, что и продакшен-рендер (buildSceneMarkup + headless Chrome по CDP).
//
//   node scripts/render-archetype-samples.mjs [--out <dir>] [--at <ms>]
//
// Никаких ключей и сети: разметка самодостаточна, картинка собирается офлайн.

import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { getPlatformRecipe } from "../src/domain/platform-recipes.js";
import { openSceneBrowser } from "../src/media/chrome-cdp.js";
import { SCENE_ARCHETYPES } from "../src/media/scene-content.js";
import { buildSceneMarkup } from "../src/media/scene-markup.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const DEFAULT_OUT = path.join(REPO_ROOT, "tmp", "archetype-samples");
const DEFAULT_FRAME_MS = 2600;
const SEED = 20260725;

const BRIEF = Object.freeze({ topic: "Как Hermest Board собирает ролик", language: "ru" });

// Карточки подобраны так, чтобы каждая была правдоподобным входом продукта:
// заголовок + закадровый текст, и (где это осмысленно) явные поля sceneData.
const SAMPLES = Object.freeze([
  {
    archetype: "statement",
    role: "opening",
    scene: {
      title: "Видео из доски за один проход",
      narration: "Видео из доски за один проход. Карточки становятся сценами, сцены — кадрами, кадры — готовым роликом."
    }
  },
  {
    archetype: "device-mockup",
    scene: {
      title: "Всё собирается в браузере",
      narration: "Всё собирается в браузере. Доска, раскадровка и предпросмотр живут в одном интерфейсе.",
      sceneData: {
        device: { kind: "laptop", title: "hermest board", lines: ["Доска", "Раскадровка", "Рендер"] }
      }
    }
  },
  {
    archetype: "board-columns",
    scene: {
      title: "Карточка проходит три состояния",
      narration: "Карточка проходит три состояния.",
      sceneData: {
        columns: [
          { title: "Идея", cards: ["Тезис", "Источник"] },
          { title: "В работе", cards: ["Озвучка"] },
          { title: "Готово", cards: ["Мастер 16:9", "Shorts"] }
        ]
      }
    }
  },
  {
    archetype: "format-trio",
    scene: {
      title: "Один мастер, три формата",
      narration: "Один мастер, три формата. Горизонталь, вертикаль и квадрат считаются из одной раскадровки."
    }
  },
  {
    archetype: "checklist",
    scene: {
      title: "Что проверяется перед публикацией",
      narration: "Длительность под платформу; громкость по LUFS; субтитры отдельным файлом; safe zones; манифест сборки."
    }
  },
  {
    archetype: "comparison",
    scene: {
      title: "Стоимость одного ролика",
      narration: "Было: смена монтажёра и стоковая подписка. Стало: один проход рендера на ноутбуке."
    }
  },
  {
    archetype: "stat-highlight",
    scene: {
      title: "Столько занимает сборка",
      narration: "Полный проход раскадровки, озвучки и склейки укладывается в 94 секунды на ноутбуке без видеокарты."
    }
  },
  {
    archetype: "flow-steps",
    scene: {
      title: "Как устроен проход",
      narration: "Сначала доска; затем раскадровка; потом озвучка; далее кадры; наконец склейка."
    }
  },
  {
    archetype: "metric-grid",
    scene: {
      title: "Что получается на выходе",
      narration: "3 формата; 48 кГц звук; 30 кадров в секунду; 2 дорожки субтитров."
    }
  },
  {
    archetype: "quote",
    scene: {
      title: "Обратная связь",
      narration: "«Это не выглядит как слайд-шоу — под каждый тезис нарисован свой кадр» — владелец студии."
    }
  },
  {
    archetype: "classic",
    scene: {
      title: "Обзор конвейера",
      narration: "Обзор конвейера. Схема связей остаётся откатом, когда у карточки нет своей структуры."
    }
  },
  {
    archetype: "statement",
    role: "closing",
    label: "statement-closing",
    scene: {
      title: "Соберите свой первый ролик",
      narration: "Соберите свой первый ролик. Доска уже есть — остальное сделает конвейер.",
      sceneData: { cta: "hermest board" }
    }
  }
]);

const SCENE_TITLES = SAMPLES.map(sample => sample.scene.title);

function parseArgs(argv) {
  const options = { out: DEFAULT_OUT, at: DEFAULT_FRAME_MS };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--out" && value) options.out = path.resolve(value);
    else if (flag === "--at" && value) {
      const at = Number(value);
      if (!Number.isSafeInteger(at) || at < 0 || at > 60000) throw new Error("--at expects 0..60000 ms");
      options.at = at;
    } else throw new Error(`unknown flag: ${flag}`);
  }
  return options;
}

async function renderVariant({ recipeId, suffix, outDir, frameTimeMs }) {
  const recipe = getPlatformRecipe(recipeId);
  const profileDir = path.join(outDir, `chrome-profile-${suffix}`);
  await mkdir(profileDir, { recursive: true });
  const browser = await openSceneBrowser({
    profileDir,
    width: recipe.width,
    height: recipe.height
  });
  const written = [];
  try {
    for (const [sceneIndex, sample] of SAMPLES.entries()) {
      const markup = buildSceneMarkup({
        scene: sample.scene,
        sceneIndex,
        sceneTitles: SCENE_TITLES,
        brief: BRIEF,
        width: recipe.width,
        height: recipe.height,
        seed: SEED,
        safeZones: recipe.safeZones,
        archetype: sample.archetype,
        role: sample.role
      });
      const name = sample.label || sample.archetype;
      const htmlFile = path.join(outDir, `${name}-${suffix}.html`);
      const pngFile = path.join(outDir, `${name}-${suffix}.png`);
      await writeFile(htmlFile, markup, "utf8");
      await browser.openScene({ htmlFile, transparent: false });
      const bytes = await browser.captureFrame(frameTimeMs, 0);
      await writeFile(pngFile, bytes);
      written.push(pngFile);
      process.stdout.write(`${pngFile} (${bytes.length} bytes)\n`);
    }
  } finally {
    await browser.close();
  }
  await rm(profileDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  return written;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await mkdir(options.out, { recursive: true });
  const covered = new Set(SAMPLES.map(sample => sample.archetype));
  const missing = SCENE_ARCHETYPES.filter(archetype => !covered.has(archetype));
  if (missing.length) throw new Error(`samples missing for: ${missing.join(", ")}`);

  const written = [
    ...await renderVariant({ recipeId: "youtube_video", suffix: "16x9", outDir: options.out, frameTimeMs: options.at }),
    ...await renderVariant({ recipeId: "youtube_shorts", suffix: "9x16", outDir: options.out, frameTimeMs: options.at }),
    ...await renderVariant({ recipeId: "instagram_feed", suffix: "1x1", outDir: options.out, frameTimeMs: options.at })
  ];
  process.stdout.write(`\n${written.length} frames written to ${options.out}\n`);
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
