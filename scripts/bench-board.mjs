#!/usr/bin/env node

import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FRAME_COUNT = 120;
const DEFAULT_CARD_COUNTS = [10, 40, 80, 150];
const CARD_COUNTS = process.env.BENCH_COUNTS
  ? process.env.BENCH_COUNTS.split(",").map(Number).filter(Number.isSafeInteger)
  : DEFAULT_CARD_COUNTS;
const DEBUG = process.env.BENCH_DEBUG === "1";
const DISABLE_EFFECTS = process.env.BENCH_DISABLE_EFFECTS === "1";
const BOARD_WILL_CHANGE = process.env.BENCH_BOARD_WILL_CHANGE === "1";
const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
  [".woff2", "font/woff2"]
]);

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function removeChromeProfile(profileDir) {
  await rm(profileDir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100
  }).catch(error => {
    // Do not mask the benchmark error if Chrome is still releasing a cache file.
    console.error(`Could not remove temporary Chrome profile ${profileDir}: ${error.message}`);
  });
}

function progress(message) {
  if (DEBUG) console.error(`[bench-board] ${message}`);
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] || 0;
}

function summarize(frames) {
  const sampled = frames.slice(-FRAME_COUNT);
  if (sampled.length !== FRAME_COUNT) {
    throw new Error(`expected ${FRAME_COUNT} animation-frame samples, received ${sampled.length}`);
  }
  return {
    avg: sampled.reduce((total, value) => total + value, 0) / sampled.length,
    p95: percentile(sampled, 0.95),
    overBudget: sampled.filter(value => value > 16.7).length / sampled.length * 100
  };
}

function formatMetric(metric) {
  return `${metric.toFixed(2)} ms`;
}

function formatPercent(metric) {
  return `${metric.toFixed(1)}%`;
}

function metricMap(metrics) {
  return new Map(metrics.map(({ name, value }) => [name, value]));
}

function taskDurationDelta(before, after) {
  return ((after.get("TaskDuration") || 0) - (before.get("TaskDuration") || 0)) * 1000;
}

async function startStaticServer() {
  const server = createServer(async (request, response) => {
    try {
      const requestedPath = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
      const relativePath = requestedPath === "/" ? "index.html" : requestedPath.replace(/^\/+/, "");
      const filePath = path.resolve(ROOT, relativePath);
      if (!filePath.startsWith(`${ROOT}${path.sep}`)) {
        response.writeHead(403).end("forbidden");
        return;
      }
      const details = await stat(filePath);
      if (!details.isFile()) {
        response.writeHead(404).end("not found");
        return;
      }
      const body = await readFile(filePath);
      response.writeHead(200, {
        "content-type": MIME_TYPES.get(path.extname(filePath)) || "application/octet-stream",
        "cache-control": "no-store"
      });
      response.end(body);
    } catch {
      response.writeHead(404).end("not found");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("static server did not expose a TCP port");
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise(resolve => server.close(resolve))
  };
}

class CdpClient {
  #socket;
  #nextId = 1;
  #pending = new Map();
  #events = new Set();

  static async connect(endpoint) {
    const client = new CdpClient();
    await client.#connect(endpoint);
    return client;
  }

  async #connect(endpoint) {
    this.#socket = new WebSocket(endpoint);
    await new Promise((resolve, reject) => {
      this.#socket.addEventListener("open", resolve, { once: true });
      this.#socket.addEventListener("error", () => reject(new Error("Chrome CDP connection failed")), { once: true });
    });
    this.#socket.addEventListener("message", event => this.#receive(event.data));
    this.#socket.addEventListener("close", () => this.#failAll(new Error("Chrome CDP connection closed")));
  }

  #receive(raw) {
    const message = JSON.parse(typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8"));
    if (message.id !== undefined) {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(`CDP ${message.error.code}: ${message.error.message}`));
      else pending.resolve(message.result || {});
      return;
    }
    for (const waiter of this.#events) {
      if (waiter.method !== message.method) continue;
      this.#events.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.resolve(message.params || {});
    }
  }

  #failAll(error) {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
    for (const waiter of this.#events) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.#events.clear();
  }

  send(method, params = {}) {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`CDP ${method} timed out`));
      }, 30_000);
      this.#pending.set(id, { resolve, reject, timer });
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }

  waitFor(method) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#events.delete(waiter);
        reject(new Error(`CDP event ${method} timed out`));
      }, 30_000);
      const waiter = { method, resolve, reject, timer };
      this.#events.add(waiter);
    });
  }

  async evaluate(expression, awaitPromise = false) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Runtime.evaluate failed");
    }
    return result.result?.value;
  }

  close() {
    this.#socket?.close();
  }
}

async function readDevToolsEndpoint(profileDir) {
  const portFile = path.join(profileDir, "DevToolsActivePort");
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const [port, browserPath] = (await readFile(portFile, "utf8")).trim().split("\n");
      if (port && browserPath) return `ws://127.0.0.1:${port}${browserPath}`;
    } catch {
      // Chrome has not written DevToolsActivePort yet.
    }
    await wait(25);
  }
  throw new Error("Chrome did not publish a CDP endpoint");
}

async function launchChrome() {
  const profileDir = await mkdtemp(path.join(os.tmpdir(), "hermest-board-bench-"));
  const child = spawn("google-chrome", [
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDir}`,
    "--window-size=1440,900",
    "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", chunk => { stderr = `${stderr}${chunk}`.slice(-4000); });
  try {
    const browserEndpoint = await readDevToolsEndpoint(profileDir);
    const debugPort = new URL(browserEndpoint).port;
    const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    const pageEndpoint = targets.find(target => target.type === "page")?.webSocketDebuggerUrl;
    if (!pageEndpoint) throw new Error("Chrome did not expose a page CDP endpoint");
    return { child, client: await CdpClient.connect(pageEndpoint), profileDir };
  } catch (error) {
    child.kill("SIGTERM");
    await removeChromeProfile(profileDir);
    throw new Error(`${error.message}${stderr ? `\n${stderr}` : ""}`);
  }
}

async function nextFrame(client) {
  // Headless Chrome throttles rAF for an unfocused tab. The benchmark replaces
  // it below with one deterministic callback per dispatched move, then forces
  // style/layout before recording that logical frame's elapsed time.
  await client.evaluate(
    'Promise.resolve().then(() => document.getElementById("wire").getBoundingClientRect().width)',
    true
  );
}

async function navigate(client, url) {
  const loaded = client.waitFor("Page.loadEventFired");
  await client.send("Page.navigate", { url });
  await loaded;
  await client.evaluate("document.readyState", false);
  await nextFrame(client);
}

async function resetBoard(client, url) {
  await navigate(client, url);
  await client.evaluate("localStorage.clear()", false);
  // Register Page.loadEventFired before navigating. Waiting after
  // location.reload() can miss a fast local reload and turn into a 30s race.
  await navigate(client, url);
  await client.evaluate('document.getElementById("welcomeSkip")?.click()');
  // Let app startup's native rAF flush before installing the deterministic
  // frame shim. Otherwise its late callback can race the first seeded links.
  await client.evaluate("new Promise(resolve => requestAnimationFrame(() => resolve(true)))", true);
  if (DISABLE_EFFECTS) {
    await client.evaluate(`(() => {
      const style = document.createElement("style");
      style.id = "bench-disable-expensive-effects";
      style.textContent = "*, *::before, *::after { backdrop-filter: none !important; box-shadow: none !important; filter: none !important; }";
      document.head.append(style);
    })()`);
  }
  if (BOARD_WILL_CHANGE) {
    await client.evaluate('document.getElementById("board").style.willChange = "transform"');
  }
  await client.evaluate(`(() => {
    window.__hermestBoardBenchNativeRaf ||= window.requestAnimationFrame;
    let nextFrameId = 1;
    window.requestAnimationFrame = callback => {
      const frameId = nextFrameId++;
      queueMicrotask(() => callback(performance.now()));
      return frameId;
    };
    window.cancelAnimationFrame = () => {};
  })()`);
  await nextFrame(client);
}

async function seedBoard(client, count) {
  while (await client.evaluate('document.querySelectorAll("#board .card").length')) {
    await client.evaluate('document.getElementById("deleteCard").click()');
  }
  for (let index = 0; index < count; index += 1) {
    await client.evaluate('document.getElementById("addCard").click()');
    // The production handler uses Date.now() for ids. Waiting outside the page
    // avoids headless-tab timer throttling while preserving that real handler.
    await wait(2);
  }
  const seeded = await client.evaluate(`(() => {
    const cards = [...document.querySelectorAll("#board .card")];
    return {
      cards: cards.length,
      uniqueIds: new Set(cards.map(card => card.dataset.id)).size,
      links: Math.floor(cards.length / 2)
    };
  })()`);
  if (seeded.uniqueIds !== count) {
    throw new Error(`seed created duplicate card ids: ${JSON.stringify(seeded)}`);
  }
  await client.evaluate('document.getElementById("connectMode").click()');
  for (let index = 0; index < seeded.links; index += 1) {
    await client.evaluate(`document.querySelectorAll("#board .card")[${index * 2}].click()`);
    await client.evaluate(`document.querySelectorAll("#board .card")[${index * 2 + 1}].click()`);
  }
  await nextFrame(client);
  await nextFrame(client);
  seeded.lines = await client.evaluate('document.querySelectorAll("#wire line").length');
  if (seeded.cards !== count || seeded.links !== seeded.lines) {
    throw new Error(`seed failed: ${JSON.stringify(seeded)}`);
  }
}

async function dispatchMoves(client, start, delta) {
  await client.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: start.x,
    y: start.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
    pointerType: "mouse"
  });
  const frameTimes = [];
  for (let frame = 1; frame <= FRAME_COUNT; frame += 1) {
    const startedAt = performance.now();
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: start.x + delta.x * frame / FRAME_COUNT,
      y: start.y + delta.y * frame / FRAME_COUNT,
      button: "none",
      buttons: 1,
      pointerType: "mouse"
    });
    await nextFrame(client);
    frameTimes.push(performance.now() - startedAt);
  }
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: start.x + delta.x,
    y: start.y + delta.y,
    button: "left",
    buttons: 0,
    clickCount: 1,
    pointerType: "mouse"
  });
  await nextFrame(client);
  return frameTimes;
}

async function runScenario(client, scenario) {
  const start = await client.evaluate(scenario === "drag"
    ? `(() => {
        const rect = document.querySelector("#board .card .card-head")?.getBoundingClientRect();
        return rect ? { x: rect.left + rect.width / 2, y: rect.top + Math.min(20, rect.height / 2) } : null;
      })()`
    : `(() => {
        const board = document.getElementById("board");
        const boardWrap = document.getElementById("boardWrap");
        for (let y = 180; y < innerHeight - 80; y += 20) {
          for (let x = 120; x < innerWidth - 420; x += 20) {
            const target = document.elementFromPoint(x, y);
            if (target === board || target === boardWrap) return { x, y };
          }
        }
        return null;
      })()`);
  if (!start) throw new Error(`could not find a ${scenario} start point`);
  const before = metricMap((await client.send("Performance.getMetrics")).metrics || []);
  const frames = await dispatchMoves(client, start, scenario === "drag" ? { x: 180, y: -90 } : { x: 180, y: 90 });
  const after = metricMap((await client.send("Performance.getMetrics")).metrics || []);
  return { ...summarize(frames), taskDuration: taskDurationDelta(before, after) };
}

function printTable(label, rows) {
  console.log(`\n${label} (${FRAME_COUNT} CDP mouse-move / forced layout frames)`);
  console.log("N | avg ms | p95 ms | % frames > 16.7 ms");
  console.log("--|--------|--------|--------------------");
  for (const row of rows) {
    console.log(`${row.count} | ${formatMetric(row.metrics.avg)} | ${formatMetric(row.metrics.p95)} | ${formatPercent(row.metrics.overBudget)}`);
  }
  console.log(`Performance.getMetrics TaskDuration delta: ${rows.map(row => `${row.count}=${row.metrics.taskDuration.toFixed(1)} ms`).join(", ")}`);
}

async function main() {
  const server = await startStaticServer();
  const chrome = await launchChrome();
  try {
    await chrome.client.send("Page.enable");
    await chrome.client.send("Runtime.enable");
    await chrome.client.send("Performance.enable");
    const dragRows = [];
    const panRows = [];
    for (const count of CARD_COUNTS) {
      progress(`reset ${count}`);
      await resetBoard(chrome.client, server.url);
      progress(`seed ${count}`);
      await seedBoard(chrome.client, count);
      progress(`drag ${count}`);
      dragRows.push({ count, metrics: await runScenario(chrome.client, "drag") });
      progress(`pan ${count}`);
      panRows.push({ count, metrics: await runScenario(chrome.client, "pan") });
    }
  console.log("Hermest Board CDP benchmark");
  if (DISABLE_EFFECTS) console.log("Benchmark-only diagnostic: backdrop-filter, filter, and box-shadow disabled.");
  if (BOARD_WILL_CHANGE) console.log("Benchmark-only diagnostic: #board has will-change: transform.");
    printTable("Drag", dragRows);
    printTable("Pan", panRows);
  } finally {
    chrome.client.close();
    if (chrome.child.exitCode === null && chrome.child.signalCode === null) {
      const exited = new Promise(resolve => chrome.child.once("exit", resolve));
      chrome.child.kill("SIGTERM");
      await exited;
    }
    await removeChromeProfile(chrome.profileDir);
    await server.close();
  }
}

await main();
