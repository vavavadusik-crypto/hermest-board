import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createPollinationsImageAdapter,
  IMAGE_RETRY_DELAYS_MS,
  TRANSIENT_IMAGE_ERROR_CODE,
  withTransientRetry
} from "../../src/media/image-source.js";

const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 3)
]);

function binaryResponse(bytes, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => {
      throw new Error("binary response has no text body");
    },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  };
}

function failure(status) {
  return {
    ok: false,
    status,
    text: async () => "",
    arrayBuffer: async () => new ArrayBuffer(0)
  };
}

function retryingPollinations(responses) {
  const attempts = [];
  const warnings = [];
  const slept = [];
  const fetchImpl = async url => {
    attempts.push(String(url));
    const next = responses.shift();
    if (!next) throw new Error("unexpected extra fetch call");
    if (next instanceof Error) throw next;
    return next;
  };
  const adapter = withTransientRetry(createPollinationsImageAdapter({ fetchImpl }), {
    onWarning: message => warnings.push(message),
    sleep: async delayMs => {
      slept.push(delayMs);
    }
  });
  return { adapter, attempts, warnings, slept };
}

async function withOutputPath(run) {
  const outputDir = await mkdtemp(path.join(tmpdir(), "image-retry-"));
  try {
    return await run(path.join(outputDir, "scene-001.png"));
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
}

const REQUEST = { prompt: "нейросеть рисует город", width: 1024, height: 576 };

test("a transient provider failure is retried and the second attempt is kept", async () => {
  await withOutputPath(async outputPath => {
    const { adapter, attempts, warnings, slept } = retryingPollinations([
      failure(503),
      binaryResponse(PNG_BYTES)
    ]);

    const image = await adapter.generateImage({ ...REQUEST, outputPath });

    assert.equal(attempts.length, 2, "провайдер должен быть опрошен второй раз");
    assert.deepEqual(slept, [IMAGE_RETRY_DELAYS_MS[0]], "пауза берётся из таблицы задержек");
    assert.equal(image.bytes, PNG_BYTES.length);
    assert.equal(image.provenance.provider, "pollinations");
    assert.match(warnings[0], /transient failure/);
    assert.match(warnings[0], /retry 1 of 2/);
  });
});

test("rate limiting counts as transient, a rejected request does not", async () => {
  await withOutputPath(async outputPath => {
    const limited = retryingPollinations([failure(429), binaryResponse(PNG_BYTES)]);
    await limited.adapter.generateImage({ ...REQUEST, outputPath });
    assert.equal(limited.attempts.length, 2, "429 просит подождать, а не сдаться");
  });

  await withOutputPath(async outputPath => {
    const rejected = retryingPollinations([failure(400)]);
    await assert.rejects(
      () => rejected.adapter.generateImage({ ...REQUEST, outputPath }),
      /Pollinations generation failed with status 400/
    );
    assert.equal(rejected.attempts.length, 1, "неверный запрос не станет верным со второй попытки");
    assert.deepEqual(rejected.warnings, []);
  });
});

test("a network break is transient, cancellation by the operator is not", async () => {
  await withOutputPath(async outputPath => {
    const broken = retryingPollinations([new TypeError("fetch failed"), binaryResponse(PNG_BYTES)]);
    const image = await broken.adapter.generateImage({ ...REQUEST, outputPath });
    assert.equal(broken.attempts.length, 2);
    assert.equal(image.width, 1024);
  });

  await withOutputPath(async outputPath => {
    const controller = new AbortController();
    controller.abort();
    const cancelled = retryingPollinations([new Error("aborted")]);
    await assert.rejects(() => cancelled.adapter.generateImage({
      ...REQUEST,
      outputPath,
      signal: controller.signal
    }));
    assert.equal(cancelled.attempts.length, 1, "отмена человеком обязана быть мгновенной");
    assert.deepEqual(cancelled.slept, [], "после отмены не ждём");
  });
});

test("attempts are bounded and the last provider error survives", async () => {
  await withOutputPath(async outputPath => {
    const { adapter, attempts, slept, warnings } = retryingPollinations([
      failure(502),
      failure(502),
      failure(500)
    ]);

    await assert.rejects(
      () => adapter.generateImage({ ...REQUEST, outputPath }),
      error => {
        assert.equal(error.code, TRANSIENT_IMAGE_ERROR_CODE);
        assert.match(error.message, /status 500/, "наверх уходит последняя, а не первая ошибка");
        return true;
      }
    );

    assert.equal(attempts.length, IMAGE_RETRY_DELAYS_MS.length + 1, "попыток ровно столько, сколько задержек плюс одна");
    assert.deepEqual(slept, [...IMAGE_RETRY_DELAYS_MS]);
    assert.equal(warnings.length, IMAGE_RETRY_DELAYS_MS.length);
  });
});

test("the render path itself retries: the provider registry wraps its image adapters", async () => {
  const { createBrollProviderRegistry } = await import("../../src/media/broll-providers.js");
  await withOutputPath(async outputPath => {
    const responses = [failure(503), binaryResponse(PNG_BYTES)];
    const attempts = [];
    const warnings = [];
    const registry = createBrollProviderRegistry({
      env: {},
      fetchImpl: async url => {
        attempts.push(String(url));
        const next = responses.shift();
        if (!next) throw new Error("unexpected extra fetch call");
        return next;
      },
      onWarning: message => warnings.push(message)
    });

    const pollinations = registry.getProvider("pollinations-image");
    const result = await pollinations.fetchMedia({ ...REQUEST, outputPath });

    assert.equal(attempts.length, 2, "рендер обязан получить повтор, а не только прямой каскад");
    assert.equal(result.assetType, "generated-image");
    assert.match(warnings.join("\n"), /transient failure/);
  });
});

test("the wrapper keeps the adapter identity and can be disabled", async () => {
  await withOutputPath(async outputPath => {
    const base = createPollinationsImageAdapter({ fetchImpl: async () => failure(503) });
    const wrapped = withTransientRetry(base, { delaysMs: [] });
    assert.equal(wrapped.provider, base.provider);
    assert.equal(wrapped.model, base.model);

    await assert.rejects(() => wrapped.generateImage({ ...REQUEST, outputPath }), /status 503/);
  });
});
