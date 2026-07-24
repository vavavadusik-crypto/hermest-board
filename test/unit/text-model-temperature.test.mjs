import assert from "node:assert/strict";
import test from "node:test";

import { createOpenAiTextModel } from "../../src/media/openai-text-model.js";

function captureFetch(record) {
  const payload = JSON.stringify({ choices: [{ message: { content: "ok" } }] });
  return async (url, options) => {
    record.push({ url, body: JSON.parse(options.body) });
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => Buffer.from(payload, "utf8")
    };
  };
}

test("openai text model keeps the 0.4 default temperature", async () => {
  const record = [];
  const model = createOpenAiTextModel({
    baseUrl: "https://api.example.com/v1",
    apiKey: "k",
    model: "gpt-test",
    fetchImpl: captureFetch(record)
  });
  await model.complete({ prompt: "hi" });
  assert.equal(record[0].body.temperature, 0.4);
});

test("openai text model honors an explicit temperature (0 for deterministic translation)", async () => {
  const record = [];
  const model = createOpenAiTextModel({
    baseUrl: "https://api.example.com/v1",
    apiKey: "k",
    model: "gpt-test",
    fetchImpl: captureFetch(record)
  });
  await model.complete({ prompt: "hi", temperature: 0 });
  assert.equal(record[0].body.temperature, 0);
});

test("openai text model rejects an out-of-range temperature", async () => {
  const model = createOpenAiTextModel({
    baseUrl: "https://api.example.com/v1",
    apiKey: "k",
    model: "gpt-test",
    fetchImpl: captureFetch([])
  });
  await assert.rejects(() => model.complete({ prompt: "hi", temperature: 5 }), /temperature/i);
});
