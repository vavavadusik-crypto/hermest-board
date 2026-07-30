import { createServer } from "node:http";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DURATION_MS, FPS, HEIGHT, WIDTH } from "./scene.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.dirname(here);
const out = path.join(here, "out");
const frames = path.join(out, "scene-frames");
const frameCount = DURATION_MS / 1000 * FPS;

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function startServer() {
  const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json", ".css": "text/css" };
  const server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      const target = path.resolve(projectRoot, `.${pathname === "/" ? "/demo-cartoon/seek-scene.html" : pathname}`);
      if (target !== projectRoot && !target.startsWith(`${projectRoot}${path.sep}`)) throw new Error("outside project");
      const data = await readFile(target);
      res.writeHead(200, { "content-type": mime[path.extname(target)] || "application/octet-stream", "cache-control": "no-store" });
      res.end(data);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not found");
    }
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server)));
}

class Cdp {
  #socket; #nextId = 1; #pending = new Map();
  constructor(socket) {
    this.#socket = socket;
    socket.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
    });
  }
  send(method, params = {}) {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.#pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30_000);
      this.#pending.set(id, { resolve: result => { clearTimeout(timer); resolve(result); }, reject: error => { clearTimeout(timer); reject(error); } });
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { this.#socket.close(); }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function connect(port) {
  let lastError;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const target = targets.find(item => item.type === "page");
      if (!target?.webSocketDebuggerUrl) throw new Error("no page target");
      const socket = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
      return new Cdp(socket);
    } catch (error) { lastError = error; await sleep(100); }
  }
  throw new Error(`Chrome CDP did not become ready: ${lastError?.message}`);
}

async function evaluate(cdp, expression, awaitPromise = false) {
  const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
  if (result.exceptionDetails) throw new Error(`page evaluation failed: ${result.exceptionDetails.text}`);
  return result.result?.value;
}
async function waitReady(cdp) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (await evaluate(cdp, "Boolean(window.__ready)")) return;
    const bootError = await evaluate(cdp, "window.__bootError || ''");
    if (bootError) throw new Error(`seek page boot failed: ${bootError}`);
    await sleep(50);
  }
  throw new Error("seek page did not set window.__ready");
}
function isCompletePng(bytes) {
  const iend = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
  return bytes.length >= iend.length && bytes.subarray(-iend.length).equals(iend);
}
async function capture(cdp, ms, index) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await evaluate(cdp, `window.__seek(${ms}); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`, true);
    const image = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
    const bytes = Buffer.from(image.data, "base64");
    if (isCompletePng(bytes)) return bytes;
  }
  throw new Error(`frame ${index} is incomplete after three captures`);
}
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve(output) : reject(new Error(`${command} exited ${code}: ${output}`)));
  });
}

await mkdir(out, { recursive: true });
await rm(frames, { recursive: true, force: true });
await mkdir(frames, { recursive: true });
const server = await startServer();
const cdpPort = await freePort();
const profile = path.join(out, `scene-chrome-${Date.now()}-${process.pid}`);
await mkdir(profile, { recursive: true });
const chrome = spawn("google-chrome", ["--headless=new", `--remote-debugging-port=${cdpPort}`, "--remote-debugging-address=127.0.0.1", `--window-size=${WIDTH},${HEIGHT}`, "--hide-scrollbars", "--force-device-scale-factor=1", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
let chromeStderr = "";
chrome.stderr.on("data", chunk => { chromeStderr = (chromeStderr + chunk).slice(-4000); });

try {
  const cdp = await connect(cdpPort);
  try {
    await cdp.send("Page.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/demo-cartoon/seek-scene.html` });
    await waitReady(cdp);
    for (let index = 0; index < frameCount; index += 1) {
      const png = await capture(cdp, Math.round(index * 1000 / FPS), index);
      await writeFile(path.join(frames, `frame-${String(index).padStart(5, "0")}.png`), png);
      if ((index + 1) % 60 === 0 || index + 1 === frameCount) console.log(`Captured ${index + 1}/${frameCount}`);
    }
  } finally { cdp.close(); }
  const mp4 = path.join(out, "scene.mp4");
  await run("ffmpeg", ["-y", "-framerate", String(FPS), "-i", path.join(frames, "frame-%05d.png"), "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4]);
  const duration = (await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", mp4])).trim();
  console.log(`Frames: ${frameCount}`);
  console.log(`MP4 duration: ${duration} s`);
  console.log(`MP4 size: ${(await stat(mp4)).size} bytes`);
} catch (error) {
  throw new Error(`${error.message}${chromeStderr ? `\nChrome stderr: ${chromeStderr}` : ""}`);
} finally {
  server.close();
  if (!chrome.killed) chrome.kill("SIGTERM");
  await new Promise(resolve => chrome.once("exit", resolve));
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
