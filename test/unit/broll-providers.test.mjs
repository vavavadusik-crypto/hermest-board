import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createBrollProviderRegistry,
  PROVIDER_KINDS,
  COST_CLASSES,
  STILL_IMAGE_PROVIDER_KINDS
} from "../../src/media/broll-providers.js";

describe("broll-providers — unified provider contract", () => {
  it("registry describes all built-in providers with required fields", () => {
    const registry = createBrollProviderRegistry();
    const providers = registry.listProviders();
    assert.ok(Array.isArray(providers), "listProviders returns array");
    assert.ok(providers.length > 0, "at least one provider registered");

    for (const descriptor of providers) {
      assert.ok(typeof descriptor.id === "string", "provider id is string");
      assert.ok(descriptor.id.length > 0, "provider id is non-empty");
      assert.ok(PROVIDER_KINDS.includes(descriptor.kind), `provider kind ${descriptor.kind} is valid`);
      assert.ok(COST_CLASSES.includes(descriptor.costClass), `cost class ${descriptor.costClass} is valid`);
      assert.ok(typeof descriptor.describeAvailability === "function", "describeAvailability is function");
      assert.ok(typeof descriptor.timeoutMs === "number", "timeoutMs is number");
      assert.ok(descriptor.timeoutMs > 0, "timeoutMs is positive");
      assert.ok(typeof descriptor.contentType === "string", "contentType is string");
    }
  });

  it("describeAvailability returns status and reason", () => {
    const registry = createBrollProviderRegistry({ env: {} });
    const providers = registry.listProviders();
    for (const descriptor of providers) {
      const availability = descriptor.describeAvailability();
      assert.ok(typeof availability === "object", "describeAvailability returns object");
      assert.ok(["missing", "executable", "limited"].includes(availability.status), `status ${availability.status} is valid`);
      if (availability.status !== "executable") {
        assert.ok(typeof availability.reason === "string", "non-executable status has reason");
      }
    }
  });

  it("registry.getProvider returns descriptor by id", () => {
    const registry = createBrollProviderRegistry();
    const providers = registry.listProviders();
    const firstId = providers[0].id;
    const descriptor = registry.getProvider(firstId);
    assert.ok(descriptor !== undefined, "getProvider returns descriptor");
    assert.strictEqual(descriptor.id, firstId, "returned descriptor has correct id");
  });

  it("registry.getProvider returns undefined for unknown id", () => {
    const registry = createBrollProviderRegistry();
    const descriptor = registry.getProvider("unknown-provider-xyz");
    assert.strictEqual(descriptor, undefined, "unknown provider returns undefined");
  });

  it("pexels-stock-video provider requires key", () => {
    const registryWithoutKey = createBrollProviderRegistry({ env: {} });
    const pexels = registryWithoutKey.getProvider("pexels-stock-video");
    assert.ok(pexels !== undefined, "pexels-stock-video registered");
    assert.strictEqual(pexels.kind, "stock-footage", "pexels is stock-footage");
    assert.strictEqual(pexels.costClass, "byok", "pexels is byok");
    const availability = pexels.describeAvailability();
    assert.strictEqual(availability.status, "missing", "pexels without key is missing");
    assert.ok(availability.reason.includes("key"), "reason mentions key");
  });

  it("pexels-stock-video provider executable when key present", () => {
    const registryWithKey = createBrollProviderRegistry({
      env: { HERMEST_PEXELS_API_KEY: "test-key-abc123" }
    });
    const pexels = registryWithKey.getProvider("pexels-stock-video");
    const availability = pexels.describeAvailability();
    assert.strictEqual(availability.status, "executable", "pexels with key is executable");
  });

  it("pollinations-image provider always available", () => {
    const registry = createBrollProviderRegistry({ env: {} });
    const pollinations = registry.getProvider("pollinations-image");
    assert.ok(pollinations !== undefined, "pollinations-image registered");
    assert.strictEqual(pollinations.kind, "generated-image", "pollinations is generated-image");
    assert.strictEqual(pollinations.costClass, "free", "pollinations is free");
    const availability = pollinations.describeAvailability();
    assert.strictEqual(availability.status, "executable", "pollinations always executable");
  });

  it("pexels photos are stock, not generation, and the render still treats them as scene backgrounds", () => {
    const registry = createBrollProviderRegistry({ env: { HERMEST_PEXELS_API_KEY: "test-key" } });
    const photo = registry.getProvider("pexels-photo");
    assert.ok(photo !== undefined, "pexels-photo registered");
    // Снимок сделан человеком и живёт по лицензии Pexels: записать его как
    // generated-image значит соврать и в происхождении, и в правах.
    assert.strictEqual(photo.kind, "stock-photo", "pexels photo is stock, not generated");
    assert.strictEqual(photo.costClass, "byok");
    assert.ok(PROVIDER_KINDS.includes("stock-photo"), "stock-photo is a declared provider kind");

    // Для подбора фона рендеру важен класс «неподвижная картинка», а не
    // происхождение, поэтому обе разновидности обязаны попадать в один фильтр.
    assert.deepEqual([...STILL_IMAGE_PROVIDER_KINDS].sort(), ["generated-image", "stock-photo"]);
    const stillProviders = registry.buildCascade("auto")
      .filter(provider => STILL_IMAGE_PROVIDER_KINDS.includes(provider.kind))
      .map(provider => provider.id);
    assert.ok(stillProviders.includes("pollinations-image"), "генерация остаётся источником фона");
    assert.ok(stillProviders.includes("pexels-photo"), "фотосток остаётся источником фона");
  });

  it("deterministic-fallback provider always available", () => {
    const registry = createBrollProviderRegistry();
    const deterministic = registry.getProvider("deterministic-fallback");
    assert.ok(deterministic !== undefined, "deterministic-fallback registered");
    assert.strictEqual(deterministic.kind, "deterministic", "deterministic is deterministic");
    assert.strictEqual(deterministic.costClass, "free", "deterministic is free");
    const availability = deterministic.describeAvailability();
    assert.strictEqual(availability.status, "executable", "deterministic always executable");
  });

  it("registry.describeModes returns mode metadata", () => {
    const registry = createBrollProviderRegistry({
      env: { HERMEST_PEXELS_API_KEY: "test-key" }
    });
    const modes = registry.describeModes();
    assert.ok(Array.isArray(modes), "describeModes returns array");
    assert.ok(modes.length > 0, "at least one mode available");
    for (const mode of modes) {
      assert.ok(typeof mode.id === "string", "mode id is string");
      assert.ok(typeof mode.label === "string", "mode label is string");
      assert.ok(typeof mode.available === "boolean", "mode available is boolean");
      assert.ok(Array.isArray(mode.providers), "mode providers is array");
      if (!mode.available) {
        assert.ok(typeof mode.reason === "string", "unavailable mode has reason");
      }
    }
  });

  it("free mode available without any keys", () => {
    const registry = createBrollProviderRegistry({ env: {} });
    const modes = registry.describeModes();
    const freeMode = modes.find(m => m.id === "free");
    assert.ok(freeMode !== undefined, "free mode registered");
    assert.strictEqual(freeMode.available, true, "free mode available without keys");
    assert.ok(freeMode.providers.includes("pollinations-image"), "free mode includes pollinations");
    assert.ok(freeMode.providers.includes("deterministic-fallback"), "free mode includes deterministic");
  });

  it("premium mode unavailable without keys", () => {
    const registry = createBrollProviderRegistry({ env: {} });
    const modes = registry.describeModes();
    const premiumMode = modes.find(m => m.id === "premium");
    assert.ok(premiumMode !== undefined, "premium mode registered");
    assert.strictEqual(premiumMode.available, false, "premium mode unavailable without keys");
    assert.ok(premiumMode.reason.includes("key"), "reason mentions key");
  });

  it("buildCascade returns ordered providers for auto mode", () => {
    const registry = createBrollProviderRegistry({
      env: { HERMEST_PEXELS_API_KEY: "test-key" }
    });
    const cascade = registry.buildCascade("auto");
    assert.ok(Array.isArray(cascade), "buildCascade returns array");
    assert.ok(cascade.length > 0, "cascade has at least one provider");
    // Auto mode: prefer stock → images → deterministic (no generative clips yet)
    const ids = cascade.map(p => p.id);
    assert.ok(ids.includes("pexels-stock-video"), "auto includes pexels-stock-video");
    assert.ok(ids.includes("deterministic-fallback"), "auto includes deterministic-fallback");
    // Deterministic must be last
    assert.strictEqual(ids[ids.length - 1], "deterministic-fallback", "deterministic is last fallback");
  });

  it("buildCascade returns only free providers for free mode", () => {
    const registry = createBrollProviderRegistry({
      env: { HERMEST_PEXELS_API_KEY: "test-key" }
    });
    const cascade = registry.buildCascade("free");
    assert.ok(Array.isArray(cascade), "buildCascade returns array");
    for (const descriptor of cascade) {
      assert.strictEqual(descriptor.costClass, "free", `provider ${descriptor.id} is free`);
    }
    const ids = cascade.map(p => p.id);
    assert.ok(ids.includes("pollinations-image"), "free mode includes pollinations-image");
    assert.ok(ids.includes("deterministic-fallback"), "free mode includes deterministic-fallback");
    assert.ok(!ids.includes("pexels-stock-video"), "free mode excludes pexels-stock-video");
  });

  it("buildCascade returns only deterministic for deterministic mode", () => {
    const registry = createBrollProviderRegistry({
      env: { HERMEST_PEXELS_API_KEY: "test-key" }
    });
    const cascade = registry.buildCascade("deterministic");
    assert.strictEqual(cascade.length, 1, "deterministic mode has exactly one provider");
    assert.strictEqual(cascade[0].id, "deterministic-fallback", "deterministic mode uses deterministic-fallback");
  });

  it("buildCascade throws on unknown mode", () => {
    const registry = createBrollProviderRegistry();
    assert.throws(
      () => registry.buildCascade("unknown-mode-xyz"),
      /unknown mode/i,
      "unknown mode throws"
    );
  });
});
