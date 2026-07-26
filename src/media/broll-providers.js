export const PROVIDER_KINDS = [
  "generative-clip",
  "stock-footage",
  "generated-image",
  "deterministic"
];

export const COST_CLASSES = ["free", "local", "byok"];

const BROLL_MODES = [
  {
    id: "auto",
    label: "Автоматический (smart cascade)",
    description: "Использует все доступные провайдеры в оптимальном порядке"
  },
  {
    id: "free",
    label: "Только бесплатные",
    description: "Только бесплатные провайдеры без API-ключей"
  },
  {
    id: "premium",
    label: "Только платные (BYOK)",
    description: "Только платные провайдеры с вашими API-ключами"
  },
  {
    id: "deterministic",
    label: "Только детерминированная композиция",
    description: "Без внешних запросов, только генерация кадров из текста"
  }
];

export function createBrollProviderRegistry({
  env = process.env,
  fetchImpl = fetch,
  onWarning = () => {}
} = {}) {
  const providers = buildProviderDescriptors({ env, fetchImpl, onWarning });
  const providerMap = new Map(providers.map(p => [p.id, p]));

  return {
    listProviders() {
      return [...providers];
    },

    getProvider(id) {
      return providerMap.get(id);
    },

    describeModes() {
      return BROLL_MODES.map(mode => {
        const cascade = buildModeProvidersInternal(mode.id, providers);
        const available = cascade.some(p => p.describeAvailability().status === "executable");
        const unavailableReasons = cascade
          .map(p => p.describeAvailability())
          .filter(a => a.status !== "executable")
          .map(a => a.reason)
          .filter(Boolean);

        return {
          id: mode.id,
          label: mode.label,
          description: mode.description,
          available,
          providers: cascade.map(p => p.id),
          reason: available ? undefined : unavailableReasons.join("; ")
        };
      });
    },

    buildCascade(modeId) {
      if (!BROLL_MODES.some(m => m.id === modeId)) {
        throw new RangeError(`Unknown mode: ${modeId}`);
      }
      return buildModeProvidersInternal(modeId, providers);
    }
  };
}

function buildProviderDescriptors({ env, fetchImpl, onWarning }) {
  return [
    createPexelsStockVideoDescriptor({ env, fetchImpl }),
    createFalImageDescriptor({ env, fetchImpl, onWarning }),
    createPollinationsImageDescriptor({ fetchImpl, onWarning }),
    createPexelsPhotoDescriptor({ env, fetchImpl, onWarning }),
    createDeterministicFallbackDescriptor()
  ];
}

function buildModeProvidersInternal(modeId, allProviders) {
  switch (modeId) {
    case "auto": {
      // Порядок: stock-footage → generated-image (byok) → generated-image (free) → deterministic
      const order = ["pexels-stock-video", "fal-image", "pollinations-image", "pexels-photo", "deterministic-fallback"];
      return order
        .map(id => allProviders.find(p => p.id === id))
        .filter(Boolean)
        .filter(p => p.describeAvailability().status === "executable");
    }

    case "free": {
      return allProviders.filter(p => p.costClass === "free");
    }

    case "premium": {
      return allProviders.filter(p => p.costClass === "byok");
    }

    case "deterministic": {
      return allProviders.filter(p => p.id === "deterministic-fallback");
    }

    default:
      throw new RangeError(`Unknown mode: ${modeId}`);
  }
}

function createPexelsStockVideoDescriptor({ env, fetchImpl }) {
  return {
    id: "pexels-stock-video",
    kind: "stock-footage",
    costClass: "byok",
    timeoutMs: 150000, // REQUEST_TIMEOUT_MS(30s) + DOWNLOAD_TIMEOUT_MS(120s)
    contentType: "video/mp4",

    describeAvailability() {
      const key = readPexelsKey(env);
      if (!key) {
        return {
          status: "missing",
          reason: "Pexels API key is not configured"
        };
      }
      return { status: "executable" };
    },

    async fetchMedia({ keywords, orientation, minDurationSeconds, outputPath, signal }) {
      const { createPexelsBrollAdapter } = await import("./broll-source.js");
      const adapter = createPexelsBrollAdapter({ env, fetchImpl });
      const result = await adapter.fetchClip({
        keywords,
        orientation,
        minDurationSeconds,
        outputPath,
        signal
      });
      if (!result) return null;
      return {
        ...result,
        assetType: "stock-footage"
      };
    }
  };
}

function createFalImageDescriptor({ env, fetchImpl, onWarning }) {
  return {
    id: "fal-image",
    kind: "generated-image",
    costClass: "byok",
    timeoutMs: 210000, // REQUEST_TIMEOUT_MS(90s) + DOWNLOAD_TIMEOUT_MS(120s)
    contentType: "image/png",

    describeAvailability() {
      const key = readFalKey(env);
      if (!key) {
        return {
          status: "missing",
          reason: "FAL API key is not configured"
        };
      }
      return { status: "executable" };
    },

    async fetchMedia({ prompt, stylePreset, width, height, seed, outputPath, signal }) {
      const { createFalImageAdapter, withTransientRetry } = await import("./image-source.js");
      const adapter = withTransientRetry(createFalImageAdapter({ env, fetchImpl }), { onWarning });
      const result = await adapter.generateImage({
        prompt,
        stylePreset,
        width,
        height,
        seed,
        outputPath,
        signal
      });
      return {
        ...result,
        assetType: "generated-image"
      };
    }
  };
}

function createPollinationsImageDescriptor({ fetchImpl, onWarning }) {
  return {
    id: "pollinations-image",
    kind: "generated-image",
    costClass: "free",
    // Бюджет времени общий на все попытки: быстрый 503 успевает повториться,
    // а зависший запрос не растягивает рендер втрое.
    timeoutMs: 120000, // DOWNLOAD_TIMEOUT_MS
    contentType: "image/png",

    describeAvailability() {
      return { status: "executable" };
    },

    async fetchMedia({ prompt, stylePreset, width, height, seed, outputPath, signal }) {
      const { createPollinationsImageAdapter, withTransientRetry } = await import("./image-source.js");
      const adapter = withTransientRetry(createPollinationsImageAdapter({ fetchImpl }), { onWarning });
      const result = await adapter.generateImage({
        prompt,
        stylePreset,
        width,
        height,
        seed,
        outputPath,
        signal
      });
      return {
        ...result,
        assetType: "generated-image"
      };
    }
  };
}

function createPexelsPhotoDescriptor({ env, fetchImpl, onWarning }) {
  return {
    id: "pexels-photo",
    kind: "generated-image",
    costClass: "byok",
    timeoutMs: 150000, // REQUEST_TIMEOUT_MS(30s) + DOWNLOAD_TIMEOUT_MS(120s)
    contentType: "image/jpeg",

    describeAvailability() {
      const key = readPexelsKey(env);
      if (!key) {
        return {
          status: "missing",
          reason: "Pexels API key is not configured"
        };
      }
      return { status: "executable" };
    },

    async fetchMedia({ prompt, width, height, outputPath, signal }) {
      const { createPexelsImageAdapter, withTransientRetry } = await import("./image-source.js");
      const adapter = withTransientRetry(createPexelsImageAdapter({ env, fetchImpl }), { onWarning });
      const result = await adapter.generateImage({
        prompt,
        width,
        height,
        outputPath,
        signal
      });
      return {
        ...result,
        assetType: "generated-image"
      };
    }
  };
}

function createDeterministicFallbackDescriptor() {
  return {
    id: "deterministic-fallback",
    kind: "deterministic",
    costClass: "free",
    timeoutMs: 1, // Символическое значение (детерминированная композиция не требует таймаута)
    contentType: "application/x-hermest-scene-frame",

    describeAvailability() {
      return { status: "executable" };
    },

    async fetchMedia() {
      // Детерминированная композиция не фетчит медиа — это просто маркер
      // для pipeline, что нужно сгенерировать цветной кадр с текстом.
      return null;
    }
  };
}

function readPexelsKey(env) {
  const key = typeof env.HERMEST_PEXELS_API_KEY === "string" ? env.HERMEST_PEXELS_API_KEY.trim() : "";
  return key;
}

function readFalKey(env) {
  const key = typeof env.HERMEST_FAL_API_KEY === "string" ? env.HERMEST_FAL_API_KEY.trim() : "";
  return key;
}
