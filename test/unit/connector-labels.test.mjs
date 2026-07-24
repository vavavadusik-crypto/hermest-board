import assert from "node:assert/strict";
import test from "node:test";

import {
  capabilityName,
  capabilityStatusLabel,
  blockerLabel,
  capabilityReason,
  providerStateLabel,
  accessBadge
} from "../../src/ui/connector-labels.js";

test("capability ids map to friendly Russian names", () => {
  assert.equal(capabilityName("text.generate"), "Сценарий (генерация текста)");
  assert.equal(capabilityName("speech.synthesize"), "Озвучка");
  assert.equal(capabilityName("unknown.capability"), "unknown.capability");
});

test("capability status: executable is Готово regardless of raw state", () => {
  assert.deepEqual(capabilityStatusLabel({ executable: true, state: "blocked" }), { label: "Готово", tone: "ok" });
});

test("capability status maps each non-executable state with a tone", () => {
  assert.deepEqual(capabilityStatusLabel({ state: "configured_but_adapter_missing" }), { label: "Настроено, коннектор не готов", tone: "warn" });
  assert.deepEqual(capabilityStatusLabel({ state: "oauth_skeleton" }), { label: "Нужно OAuth-подключение", tone: "muted" });
  assert.deepEqual(capabilityStatusLabel({ state: "approval_required" }), { label: "Только через ручное одобрение", tone: "warn" });
  assert.deepEqual(capabilityStatusLabel({ state: "blocked" }), { label: "Недоступно", tone: "muted" });
  assert.deepEqual(capabilityStatusLabel({}), { label: "Недоступно", tone: "muted" });
});

test("blocker codes map to human reasons; unknown → empty string", () => {
  assert.equal(blockerLabel("provider_credentials_missing"), "Не хватает ключа или доступа провайдера.");
  assert.equal(blockerLabel("oauth_token_exchange_not_implemented"), "Обмен OAuth-токена ещё не реализован.");
  assert.equal(blockerLabel("totally_unknown_code"), "");
});

test("capabilityReason returns first known reason and skips unknown codes", () => {
  assert.equal(
    capabilityReason({ blockers: ["totally_unknown_code", "adapter_not_implemented"] }),
    "Коннектор ещё не реализован."
  );
  assert.equal(capabilityReason({ blockers: [] }), "");
  assert.equal(capabilityReason({}), "");
});

test("provider state maps to installed/configured/healthy/unavailable labels", () => {
  assert.deepEqual(providerStateLabel({ state: "configured_adapter" }), { label: "настроен", tone: "ok" });
  assert.deepEqual(providerStateLabel({ state: "blocked" }), { label: "недоступен", tone: "muted" });
  assert.deepEqual(providerStateLabel("working_adapter"), { label: "готов", tone: "ok" });
  assert.deepEqual(providerStateLabel({}), { label: "недоступен", tone: "muted" });
});

test("access badge distinguishes free / paid / no-key / oauth / byok", () => {
  assert.deepEqual(accessBadge({ auth: "none" }), { label: "Без ключа", tone: "free" });
  assert.deepEqual(accessBadge({ auth: "oauth" }), { label: "OAuth-аккаунт", tone: "oauth" });
  assert.deepEqual(accessBadge({ auth: "api_key", freeMode: "paid_or_trial" }), { label: "Платный / триал", tone: "paid" });
  assert.deepEqual(accessBadge({ auth: "api_key", freeMode: "free_tier" }), { label: "Бесплатный тариф", tone: "free" });
  assert.deepEqual(accessBadge({ auth: "api_key", freeMode: "unknown" }), { label: "Свой ключ", tone: "byok" });
  assert.deepEqual(accessBadge({}), { label: "Свой ключ", tone: "byok" });
});
