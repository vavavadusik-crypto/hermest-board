import assert from "node:assert/strict";
import test from "node:test";

import {
  createFigmaDesignAdapter,
  describeFigmaAvailability,
  normalizeFigmaFileKey,
  normalizeFigmaNodeIds
} from "../../src/connectors/figma-design.js";

// Fixture credential, assembled at runtime so it never reads as a literal secret.
const FIGMA_FIXTURE_CREDENTIAL = ["figd", "fixture", "sentinel", "8f21b3c4d5e6"].join("-");
const FILE_KEY = "aBcDeF1234567890";

// Every test drives the adapter through a fake fetch and a fake DNS lookup: the
// suite must never touch the network.
const publicLookup = async () => [{ address: "203.0.113.7", family: 4 }];

function jsonResponse(payload, { status = 200, headers = {} } = {}) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: name => headers[String(name).toLowerCase()] ?? null },
    async arrayBuffer() {
      return body;
    }
  };
}

function recordingFetch(responses) {
  const calls = [];
  const queue = Array.isArray(responses) ? [...responses] : [responses];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    return typeof next === "function" ? next(url, init) : next;
  };
  return { fetchImpl, calls };
}

function adapterWith(responses, extra = {}) {
  const { fetchImpl, calls } = recordingFetch(responses);
  const adapter = createFigmaDesignAdapter({
    env: { FIGMA_ACCESS_TOKEN: FIGMA_FIXTURE_CREDENTIAL },
    fetchImpl,
    lookup: publicLookup,
    sleep: async () => {},
    ...extra
  });
  return { adapter, calls };
}

test("importFile calls the documented endpoint with the token header and returns a bounded summary", async () => {
  const { adapter, calls } = adapterWith(jsonResponse({
    name: "Brand System",
    lastModified: "2026-07-20T10:00:00Z",
    version: "123456789",
    editorType: "figma",
    thumbnailUrl: "https://s3-alpha.figma.com/thumb/abc.png",
    document: {
      id: "0:0",
      type: "DOCUMENT",
      children: [
        { id: "0:1", type: "CANVAS", name: "Covers" },
        { id: "0:2", type: "CANVAS", name: "Components" },
        { id: "0:3", type: "FRAME", name: "not a page" }
      ]
    }
  }));

  const summary = await adapter.importFile({ fileKey: FILE_KEY });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://api.figma.com/v1/files/${FILE_KEY}?depth=1`);
  assert.equal(calls[0].init.headers["X-Figma-Token"], FIGMA_FIXTURE_CREDENTIAL);
  assert.equal(calls[0].init.redirect, "manual");
  assert.deepEqual(summary, {
    provider: "figma",
    fileKey: FILE_KEY,
    name: "Brand System",
    lastModified: "2026-07-20T10:00:00Z",
    version: "123456789",
    editorType: "figma",
    thumbnailUrl: "https://s3-alpha.figma.com/thumb/abc.png",
    pages: [
      { id: "0:1", name: "Covers" },
      { id: "0:2", name: "Components" }
    ]
  });
});

test("readBrandAssets maps published styles without leaking the raw payload", async () => {
  const { adapter, calls } = adapterWith(jsonResponse({
    meta: {
      styles: [
        { key: "s1", name: "Brand/Primary", style_type: "FILL", description: "Main brand fill", extra: "ignored" },
        { key: "s2", name: "Heading/XL", style_type: "TEXT", description: "" }
      ]
    }
  }));

  const assets = await adapter.readBrandAssets({ fileKey: FILE_KEY });

  assert.equal(calls[0].url, `https://api.figma.com/v1/files/${FILE_KEY}/styles`);
  assert.deepEqual(assets.styles, [
    { key: "s1", name: "Brand/Primary", styleType: "FILL", description: "Main brand fill" },
    { key: "s2", name: "Heading/XL", styleType: "TEXT", description: "" }
  ]);
  assert.equal(JSON.stringify(assets).includes("ignored"), false);
});

test("renderNodeImages normalizes node ids and separates failed renders", async () => {
  const { adapter, calls } = adapterWith(jsonResponse({
    images: {
      "1:23": "https://s3-alpha.figma.com/img/one.png",
      "4:56": null
    }
  }));

  const rendered = await adapter.renderNodeImages({
    fileKey: FILE_KEY,
    nodeIds: ["1-23", "4:56", "1:23"],
    format: "png",
    scale: 2
  });

  const url = new URL(calls[0].url);
  assert.equal(url.origin, "https://api.figma.com");
  assert.equal(url.pathname, `/v1/images/${FILE_KEY}`);
  assert.equal(url.searchParams.get("ids"), "1:23,4:56");
  assert.equal(url.searchParams.get("format"), "png");
  assert.equal(url.searchParams.get("scale"), "2");
  assert.deepEqual(rendered.images, [{ nodeId: "1:23", url: "https://s3-alpha.figma.com/img/one.png" }]);
  assert.deepEqual(rendered.failed, ["4:56"]);
});

test("render URLs that are not public HTTPS targets are rejected instead of returned", async () => {
  const { adapter } = adapterWith(jsonResponse({
    images: {
      "1:23": "http://169.254.169.254/latest/meta-data/",
      "4:56": "https://127.0.0.1/secret.png"
    }
  }));

  const rendered = await adapter.renderNodeImages({ fileKey: FILE_KEY, nodeIds: ["1:23", "4:56"] });

  assert.deepEqual(rendered.images, []);
  assert.deepEqual(rendered.failed, ["1:23", "4:56"]);
});

test("a missing token fails before any request is made", async () => {
  const { fetchImpl, calls } = recordingFetch(jsonResponse({}));
  const adapter = createFigmaDesignAdapter({ env: {}, fetchImpl, lookup: publicLookup });

  await assert.rejects(
    () => adapter.importFile({ fileKey: FILE_KEY }),
    error => error instanceof RangeError && /FIGMA_ACCESS_TOKEN/.test(error.message)
  );
  assert.equal(calls.length, 0);
  assert.equal(describeFigmaAvailability({ env: {} }).status, "missing_access_token");
  assert.equal(describeFigmaAvailability({ env: { FIGMA_ACCESS_TOKEN: FIGMA_FIXTURE_CREDENTIAL } }).status, "executable");
});

test("malformed file keys and node ids cannot steer the request path", async () => {
  const { adapter, calls } = adapterWith(jsonResponse({}));

  for (const key of ["../../etc/passwd", "abc", "key with space", `${FILE_KEY}/../../v1/me`, "évilkey12345"]) {
    await assert.rejects(() => adapter.importFile({ fileKey: key }), TypeError);
  }
  await assert.rejects(() => adapter.renderNodeImages({ fileKey: FILE_KEY, nodeIds: ["1:2;drop"] }), TypeError);
  await assert.rejects(() => adapter.renderNodeImages({ fileKey: FILE_KEY, nodeIds: [] }), RangeError);
  await assert.rejects(
    () => adapter.renderNodeImages({ fileKey: FILE_KEY, nodeIds: ["1:2"], format: "exe" }),
    TypeError
  );
  await assert.rejects(
    () => adapter.renderNodeImages({ fileKey: FILE_KEY, nodeIds: ["1:2"], scale: 99 }),
    RangeError
  );
  assert.equal(calls.length, 0);
  assert.throws(() => normalizeFigmaFileKey(""), TypeError);
  assert.deepEqual(normalizeFigmaNodeIds("7-8"), ["7:8"]);
});

test("provider failures surface as status facts, never as provider response bodies", async () => {
  const leak = "internal-trace-9f8e7d6c and Bearer supersecrettoken";
  const cases = [
    { status: 401, pattern: /rejected the access token/ },
    { status: 404, pattern: /was not found/ },
    { status: 400, pattern: /failed with status 400/ }
  ];

  for (const { status, pattern } of cases) {
    const { adapter } = adapterWith(jsonResponse({ err: leak, message: leak }, { status }));
    await assert.rejects(() => adapter.importFile({ fileKey: FILE_KEY }), error => {
      assert.ok(error instanceof RangeError);
      assert.match(error.message, pattern);
      assert.equal(error.message.includes(leak), false);
      assert.equal(error.message.includes(FIGMA_FIXTURE_CREDENTIAL), false);
      return true;
    });
  }
});

test("429 is retried once per documented Retry-After and then gives up without a body", async () => {
  const delays = [];
  const { adapter, calls } = adapterWith(
    [
      jsonResponse({ err: "rate limited" }, { status: 429, headers: { "retry-after": "2" } }),
      jsonResponse({ name: "Brand System", document: { children: [] } })
    ],
    { sleep: async ms => { delays.push(ms); } }
  );

  const summary = await adapter.importFile({ fileKey: FILE_KEY });

  assert.deepEqual(delays, [2000]);
  assert.equal(calls.length, 2);
  assert.equal(summary.name, "Brand System");
});

test("an absurd Retry-After is capped and exhausted retries fail closed", async () => {
  const delays = [];
  const { adapter, calls } = adapterWith(
    jsonResponse({}, { status: 429, headers: { "retry-after": "86400" } }),
    { sleep: async ms => { delays.push(ms); } }
  );

  await assert.rejects(() => adapter.importFile({ fileKey: FILE_KEY }), /rate limit reached/);
  assert.deepEqual(delays, [10000, 10000]);
  assert.equal(calls.length, 3);
});

test("oversized provider responses are refused instead of buffered", async () => {
  const { adapter } = adapterWith(jsonResponse({ name: "x".repeat(4096) }), { maxResponseBytes: 128 });

  await assert.rejects(
    () => adapter.importFile({ fileKey: FILE_KEY }),
    error => error instanceof RangeError && /exceeds the allowed size/.test(error.message)
  );
});

test("a hanging provider is aborted by the adapter timeout", async () => {
  const adapter = createFigmaDesignAdapter({
    env: { FIGMA_ACCESS_TOKEN: FIGMA_FIXTURE_CREDENTIAL },
    lookup: publicLookup,
    timeoutMs: 5,
    fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    })
  });

  await assert.rejects(() => adapter.importFile({ fileKey: FILE_KEY }), /Figma request timed out/);
});

test("a caller abort signal wins over the timeout mapping", async () => {
  const controller = new AbortController();
  const adapter = createFigmaDesignAdapter({
    env: { FIGMA_ACCESS_TOKEN: FIGMA_FIXTURE_CREDENTIAL },
    lookup: publicLookup,
    fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
      controller.abort(new Error("caller cancelled"));
    })
  });

  await assert.rejects(
    () => adapter.importFile({ fileKey: FILE_KEY, signal: controller.signal }),
    /caller cancelled/
  );
});

test("a redirect off api.figma.com is not followed", async () => {
  const { adapter, calls } = adapterWith((url) => {
    if (url.includes("api.figma.com")) {
      return {
        status: 302,
        ok: false,
        headers: { get: name => (String(name).toLowerCase() === "location" ? "https://127.0.0.1/internal" : null) }
      };
    }
    return jsonResponse({ name: "should not happen" });
  });

  await assert.rejects(() => adapter.importFile({ fileKey: FILE_KEY }), /SSRF blocked/);
  assert.equal(calls.length, 1);
});
