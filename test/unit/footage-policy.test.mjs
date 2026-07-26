import assert from "node:assert/strict";
import test from "node:test";

import { resolveFootageMode } from "../../src/domain/footage-policy.js";

test("a clean project renders offline: mode auto alone is not permission to hit the network", () => {
  const policy = resolveFootageMode({ brollMode: "auto" });

  assert.equal(policy.mode, "deterministic");
  assert.equal(policy.wantsExternalFootage, false);
  assert.match(policy.warning, /external footage skipped/);
  assert.match(policy.warning, /brief\.generateVisuals/);
});

test("each explicit intent on its own opens the network", () => {
  const byToggle = resolveFootageMode({ brollMode: "auto", generateVisuals: true });
  assert.equal(byToggle.mode, "auto");
  assert.equal(byToggle.wantsExternalFootage, true);
  assert.equal(byToggle.warning, null);

  // Ключ провайдера настроен — намерение очевидно, тумблер не обязателен.
  const byKey = resolveFootageMode({ brollMode: "free", hasKeyedProvider: true });
  assert.equal(byKey.mode, "free");
  assert.equal(byKey.wantsExternalFootage, true);

  // Оператор форсировал режим через env — это его осознанное решение.
  const byOverride = resolveFootageMode({ brollMode: "premium", hasModeOverride: true });
  assert.equal(byOverride.mode, "premium");
  assert.equal(byOverride.wantsExternalFootage, true);
});

test("the deterministic mode stays deterministic and says nothing", () => {
  for (const intent of [
    {},
    { generateVisuals: true },
    { hasKeyedProvider: true },
    { hasModeOverride: true }
  ]) {
    const policy = resolveFootageMode({ brollMode: "deterministic", ...intent });
    assert.equal(policy.mode, "deterministic");
    assert.equal(policy.warning, null, "выбранный режим и поведение совпадают — предупреждать не о чем");
  }
});

test("the warning names the mode the project asked for, not the one it got", () => {
  for (const brollMode of ["auto", "free", "premium"]) {
    const policy = resolveFootageMode({ brollMode });
    assert.equal(policy.mode, "deterministic");
    assert.match(policy.warning, new RegExp(`"${brollMode}"`));
  }
});

test("a missing or unusable mode is treated as auto, never as permission", () => {
  for (const brollMode of [undefined, "", null, 0]) {
    const policy = resolveFootageMode({ brollMode });
    assert.equal(policy.mode, "deterministic");
    assert.equal(policy.wantsExternalFootage, false);
    assert.match(policy.warning, /"auto"/);
  }
  assert.equal(resolveFootageMode().mode, "deterministic");
});

test("only a strict true counts as intent", () => {
  for (const value of ["true", 1, "yes", {}, []]) {
    const policy = resolveFootageMode({ brollMode: "auto", generateVisuals: value });
    assert.equal(policy.wantsExternalFootage, false, `generateVisuals ${JSON.stringify(value)} не должен открывать сеть`);
  }
});
