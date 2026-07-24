import assert from "node:assert/strict";
import test from "node:test";

import {
  friendlyErrorMessage,
  resolveErrorCode,
  httpStatusMessage,
  looksLikeMachineCode,
  humanizeDetail
} from "../../src/ui/user-messages.js";

test("known machine codes map to friendly Russian text (no raw code leaks)", () => {
  assert.equal(
    friendlyErrorMessage(new Error("draft_poll_timeout"), "draft"),
    "Сборка черновика заняла слишком долго. Попробуй ещё раз или выбери более быструю модель."
  );
  assert.equal(
    friendlyErrorMessage(new Error("local_render_poll_timeout"), "render"),
    "Рендер занял слишком долго. Попробуй ещё раз."
  );
  assert.equal(friendlyErrorMessage(new Error("api_key_required")), "Нужен API-ключ выбранного провайдера.");
});

test("payload.code wins over error.message when both present", () => {
  const error = new Error("http_409");
  error.payload = { code: "draft_job_not_cancellable" };
  assert.equal(resolveErrorCode(error), "draft_job_not_cancellable");
  assert.equal(friendlyErrorMessage(error, "draft"), "Задачу уже нельзя отменить — она завершается.");
});

test("bare strings and payload.status resolve to a code", () => {
  assert.equal(resolveErrorCode("draft_poll_timeout"), "draft_poll_timeout");
  const error = new Error("");
  error.payload = { status: 503 };
  assert.equal(resolveErrorCode(error), "http_503");
});

test("http_/catalog_ status tokens map by class, never surface the number", () => {
  assert.equal(httpStatusMessage("http_500"), "Сервис временно недоступен. Попробуй ещё раз позже.");
  assert.equal(httpStatusMessage("catalog_403"), "Нет доступа: проверь API-ключ или права.");
  assert.equal(httpStatusMessage("http_404"), "Ничего не найдено.");
  assert.equal(httpStatusMessage("http_429"), "Слишком много запросов или таймаут. Подожди и попробуй ещё раз.");
  assert.equal(httpStatusMessage("http_418"), "Запрос отклонён. Проверь введённые данные.");
  assert.equal(httpStatusMessage("not_a_status"), "");
});

test("unknown codes fall back to per-context friendly text and never echo the code", () => {
  for (const context of ["draft", "render", "provider", "account", "research", "generic"]) {
    const message = friendlyErrorMessage(new Error("weird_internal_token_v7"), context);
    assert.doesNotMatch(message, /weird_internal_token/);
    assert.match(message, /[Ѐ-ӿ]/); // is Russian text
  }
});

test("null/empty errors never throw and yield a friendly generic message", () => {
  assert.equal(friendlyErrorMessage(null), "Что-то пошло не так. Попробуй ещё раз.");
  assert.equal(friendlyErrorMessage(undefined, "draft"), "Не удалось собрать черновик. Попробуй ещё раз.");
  assert.equal(resolveErrorCode(null), "");
});

test("looksLikeMachineCode distinguishes tokens from human phrases", () => {
  assert.equal(looksLikeMachineCode("draft_poll_timeout"), true);
  assert.equal(looksLikeMachineCode("http_500"), true);
  assert.equal(looksLikeMachineCode("openai-text-v1"), true);
  assert.equal(looksLikeMachineCode('{"error":"x"}'), true);
  assert.equal(looksLikeMachineCode("Сцена 3: нет ассета"), false);
  assert.equal(looksLikeMachineCode("render failed early"), false);
});

test("humanizeDetail keeps real Russian detail but scrubs bare tokens/JSON", () => {
  assert.equal(humanizeDetail("Сцена 3: нет фонового ассета"), "Сцена 3: нет фонового ассета");
  assert.equal(humanizeDetail("draft_poll_timeout"), "Сборка черновика заняла слишком долго. Попробуй ещё раз или выбери более быструю модель.");
  assert.equal(humanizeDetail("some_internal_code", "render"), "Не удалось выполнить рендер. Попробуй ещё раз.");
  assert.equal(humanizeDetail(""), "");
  assert.equal(humanizeDetail('{"stack":"..."}', "render"), "Не удалось выполнить рендер. Попробуй ещё раз.");
});
