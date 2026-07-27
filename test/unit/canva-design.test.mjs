// Canva Connect adapter. It has never spoken to Canva — no personal tokens exist
// there, so every call needs an integration the self-hoster registered. These
// tests hold it to the documented contract and, more importantly, to the rules
// that must survive whatever the provider actually answers.

import assert from "node:assert/strict";
import test from "node:test";

import {
  createCanvaDesignAdapter,
  describeCanvaAvailability,
  normalizeCanvaDesignId,
  normalizeCanvaExportFormat
} from "../../src/connectors/canva-design.js";

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  const encoded = new TextEncoder().encode(JSON.stringify(body));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: name => {
        const key = name.toLowerCase();
        if (key === "content-length") return String(encoded.byteLength);
        return headers[key] ?? null;
      }
    },
    async arrayBuffer() { return encoded.buffer.slice(0); },
    async json() { return body; },
    async text() { return JSON.stringify(body); },
    body: { cancel() {} }
  };
}

function recordingFetch(...responses) {
  const calls = [];
  const queue = [...responses];
  const impl = async (url, options) => {
    calls.push({ url, options });
    return queue.length > 1 ? queue.shift() : queue[0];
  };
  impl.calls = calls;
  return impl;
}

const TOKEN_ENV = { CANVA_ACCESS_TOKEN: "tok-secret" };
const CLIENT_ENV = { CANVA_CLIENT_ID: "client-1", CANVA_CLIENT_SECRET: "secret-1" };

test("availability separates no integration from an unauthorised one", () => {
  assert.equal(describeCanvaAvailability({ env: {} }).status, "missing_integration");
  assert.equal(describeCanvaAvailability({ env: CLIENT_ENV }).status, "missing_access_token");
  assert.equal(describeCanvaAvailability({ env: TOKEN_ENV }).status, "executable");
});

test("design ids and export formats are validated before they reach a URL", () => {
  assert.equal(normalizeCanvaDesignId("DAF-abc_123"), "DAF-abc_123");
  for (const bad of ["../../etc/passwd", "a b", "id/with/slash", "x", "", null, "id.with.dot"]) {
    assert.throws(() => normalizeCanvaDesignId(bad), /malformed/u, `прошло: ${JSON.stringify(bad)}`);
  }
  assert.equal(normalizeCanvaExportFormat("PNG"), "png");
  for (const bad of ["exe", "", "svg;rm -rf", null]) {
    assert.throws(() => normalizeCanvaExportFormat(bad), /not supported/u);
  }
});

test("listing designs pins the host, carries the bearer token and trims the answer", async () => {
  const fetchImpl = recordingFetch(jsonResponse({
    items: [
      { id: "DAF1", title: "  Кампания   весна ", thumbnail: { url: "https://export.canva.com/t.png" }, updated_at: 1700000000 },
      { id: "bad id", title: "нельзя" },
      { id: "DAF2", title: "Второй", thumbnail: { url: "http://insecure.example/t.png" } }
    ],
    continuation: "next-page"
  }));
  const adapter = createCanvaDesignAdapter({ env: TOKEN_ENV, fetchImpl });
  const result = await adapter.listDesigns({ query: "  весна  " });

  const call = fetchImpl.calls[0];
  assert.match(call.url, /^https:\/\/api\.canva\.com\/rest\/v1\/designs\?/u);
  assert.match(call.url, /query=/u);
  assert.equal(call.options.headers.authorization, "Bearer tok-secret");
  assert.equal(call.options.redirect, "error");

  assert.equal(result.designs.length, 2, "запись с негодным id должна отсеяться");
  assert.equal(result.designs[0].title, "Кампания весна");
  assert.equal(result.designs[0].thumbnailUrl, "https://export.canva.com/t.png");
  // Не-https превью не доезжает до доски: это ссылка, которую никто не проверял.
  assert.equal(result.designs[1].thumbnailUrl, "");
  assert.equal(result.continuation, "next-page");
});

test("without a token nothing is sent at all", async () => {
  const fetchImpl = recordingFetch(jsonResponse({}));
  const adapter = createCanvaDesignAdapter({ env: {}, fetchImpl });
  await assert.rejects(() => adapter.listDesigns({}), /access token is not configured/u);
  assert.equal(fetchImpl.calls.length, 0, "запрос ушёл без токена");
});

test("the code exchange authenticates the integration and demands a PKCE verifier", async () => {
  const fetchImpl = recordingFetch(jsonResponse({
    access_token: "acc", refresh_token: "ref", expires_in: 3600, scope: "design:content:read"
  }));
  const adapter = createCanvaDesignAdapter({ env: CLIENT_ENV, fetchImpl });
  const tokens = await adapter.exchangeCode({ code: "c", codeVerifier: "v", redirectUri: "https://localhost/cb" });

  const call = fetchImpl.calls[0];
  assert.equal(call.url, "https://api.canva.com/rest/v1/oauth/token");
  assert.equal(call.options.method, "POST");
  assert.equal(call.options.headers.authorization, `Basic ${Buffer.from("client-1:secret-1").toString("base64")}`);
  assert.match(call.options.body, /grant_type=authorization_code/u);
  assert.match(call.options.body, /code_verifier=v/u);
  assert.deepEqual(tokens, { accessToken: "acc", refreshToken: "ref", expiresIn: 3600, scope: "design:content:read" });

  await assert.rejects(
    () => adapter.exchangeCode({ code: "c", redirectUri: "https://localhost/cb" }),
    /code verifier is required/u
  );
});

test("an exchange without a registered integration fails before any request", async () => {
  const fetchImpl = recordingFetch(jsonResponse({}));
  const adapter = createCanvaDesignAdapter({ env: {}, fetchImpl });
  await assert.rejects(
    () => adapter.exchangeCode({ code: "c", codeVerifier: "v", redirectUri: "https://localhost/cb" }),
    /integration is not configured/u
  );
  assert.equal(fetchImpl.calls.length, 0);
});

test("an export polls its job and returns the files", async () => {
  const fetchImpl = recordingFetch(
    jsonResponse({ job: { id: "job1", status: "in_progress" } }),
    jsonResponse({ job: { id: "job1", status: "in_progress" } }),
    jsonResponse({ job: { id: "job1", status: "success", urls: ["https://export.canva.com/a.png"] } })
  );
  const adapter = createCanvaDesignAdapter({ env: TOKEN_ENV, fetchImpl, sleep: async () => {} });
  const result = await adapter.exportDesign({ designId: "DAF1", format: "png" });

  assert.deepEqual(result, { jobId: "job1", format: "png", urls: ["https://export.canva.com/a.png"] });
  assert.equal(fetchImpl.calls[0].options.method, "POST");
  assert.match(fetchImpl.calls[1].url, /\/rest\/v1\/exports\/job1$/u);
});

test("a job that never finishes ends as a timeout, not a hang", async () => {
  const fetchImpl = recordingFetch(
    jsonResponse({ job: { id: "job1", status: "in_progress" } })
  );
  const adapter = createCanvaDesignAdapter({ env: TOKEN_ENV, fetchImpl, sleep: async () => {} });
  await assert.rejects(() => adapter.exportDesign({ designId: "DAF1" }), /did not finish in time/u);
});

test("a failed job is reported without forwarding the provider's words", async () => {
  const fetchImpl = recordingFetch(
    jsonResponse({ job: { id: "job1", status: "in_progress" } }),
    jsonResponse({ job: { id: "job1", status: "failed", error: { message: "secret internal detail" } } })
  );
  const adapter = createCanvaDesignAdapter({ env: TOKEN_ENV, fetchImpl, sleep: async () => {} });
  await assert.rejects(
    () => adapter.exportDesign({ designId: "DAF1" }),
    error => error.message === "Canva export job failed"
  );
});

test("429 is retried with a capped Retry-After, then given up on", async () => {
  const delays = [];
  const fetchImpl = recordingFetch(jsonResponse({ error: "rate" }, { status: 429, headers: { "retry-after": "9000" } }));
  const adapter = createCanvaDesignAdapter({ env: TOKEN_ENV, fetchImpl, sleep: async ms => { delays.push(ms); } });

  await assert.rejects(() => adapter.listDesigns({}), error => error.statusCode === 429);
  assert.equal(fetchImpl.calls.length, 3, "две повторных попытки и отказ");
  // Враждебный Retry-After не паркует запрос на часы.
  assert.ok(delays.every(ms => ms <= 10000), `не ограничен: ${delays}`);
});

test("a provider error body never reaches the caller", async () => {
  const fetchImpl = recordingFetch(jsonResponse({ message: "Bearer tok-secret is invalid" }, { status: 400 }));
  const adapter = createCanvaDesignAdapter({ env: TOKEN_ENV, fetchImpl });
  await assert.rejects(() => adapter.listDesigns({}), error => {
    assert.ok(!error.message.includes("tok-secret"), "токен утёк в сообщение об ошибке");
    assert.match(error.message, /status 400/u);
    return true;
  });
});

test("an export job id from the provider is validated like any other id", async () => {
  const fetchImpl = recordingFetch(jsonResponse({ job: { id: "../../evil", status: "in_progress" } }));
  const adapter = createCanvaDesignAdapter({ env: TOKEN_ENV, fetchImpl, sleep: async () => {} });
  await assert.rejects(() => adapter.exportDesign({ designId: "DAF1" }), /job id is malformed/u);
});
