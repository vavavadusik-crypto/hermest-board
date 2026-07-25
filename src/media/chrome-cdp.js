import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { assertSafeGeneratedPath } from "./ffmpeg-args.js";
import { spawnMediaTool } from "./process-runner.js";
import { assertFrameTimeMs } from "./scene-markup.js";

// Chrome сам выбирает свободный порт (--remote-debugging-port=0) и пишет его в
// DevToolsActivePort внутри профиля: первая строка — порт, вторая — путь
// browser-таргета. Так мы не гадаем порт и не гоняем гонку за bind().
// Отладочный сокет слушает только loopback, а профиль лежит внутри run-каталога,
// созданного mkdtemp с правами 0700 — путь browser-таргета чужому пользователю
// не прочитать.
const DEVTOOLS_PORT_FILE = "DevToolsActivePort";
const LOOPBACK_ADDRESS = "127.0.0.1";
const BROWSER_TARGET_PATH = /^\/devtools\/browser\/[A-Za-z0-9_-]+$/;
const LAUNCH_TIMEOUT_MS = 30000;
const PORT_POLL_INTERVAL_MS = 25;
const COMMAND_TIMEOUT_MS = 60000;
const NAVIGATION_TIMEOUT_MS = 60000;
const KILL_GRACE_MS = 2000;
const GRACEFUL_CLOSE_MS = 3000;
const MAX_STDERR_CHARS = 8192;
const MAX_WINDOW_DIMENSION = 16384;
// Замеры показали насыщение на четырёх параллельных вкладках: разметка сцены
// живёт в одном renderer-процессе, поэтому parse/layout/paint не распараллелить,
// а перекрываются только растеризация и PNG-кодирование.
const MAX_CAPTURE_WORKERS = 4;

export function buildSceneBrowserArgs({ profileDir, width, height }) {
  const safeProfileDir = assertSafeGeneratedPath(profileDir);
  const safeWidth = windowDimension(width, "width");
  const safeHeight = windowDimension(height, "height");
  return [
    "--headless=new",
    "--disable-gpu",
    "--disable-extensions",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    `--user-data-dir=${safeProfileDir}`,
    `--window-size=${safeWidth},${safeHeight}`,
    `--remote-debugging-address=${LOOPBACK_ADDRESS}`,
    "--remote-debugging-port=0",
    "about:blank"
  ];
}

export function resolveCaptureWorkerCount({ env = process.env, parallelism = os.availableParallelism() } = {}) {
  const configured = Number(env?.HERMEST_SCENE_CAPTURE_WORKERS);
  if (Number.isSafeInteger(configured) && configured >= 1 && configured <= MAX_CAPTURE_WORKERS) {
    return configured;
  }
  const available = Number.isSafeInteger(parallelism) && parallelism > 0 ? parallelism : 1;
  return Math.max(1, Math.min(MAX_CAPTURE_WORKERS, available - 1));
}

/**
 * Поднимает headless Chrome ОДИН раз на весь рендер и отдаёт сессию захвата
 * кадров через CDP. Никаких внешних зависимостей: транспорт — встроенный в
 * Node глобальный WebSocket.
 */
export async function openSceneBrowser({
  profileDir,
  width,
  height,
  signal,
  spawnImpl = spawnMediaTool,
  webSocketImpl = globalThis.WebSocket,
  launchTimeoutMs = LAUNCH_TIMEOUT_MS,
  commandTimeoutMs = COMMAND_TIMEOUT_MS,
  gracefulCloseMs = GRACEFUL_CLOSE_MS,
  workerCount = resolveCaptureWorkerCount()
} = {}) {
  if (typeof webSocketImpl !== "function") {
    throw new TypeError("A WebSocket implementation is required for the CDP transport");
  }
  signal?.throwIfAborted();
  const argv = buildSceneBrowserArgs({ profileDir, width, height });
  const expectedWidth = windowDimension(width, "width");
  const expectedHeight = windowDimension(height, "height");
  const workers = positiveWorkerCount(workerCount);

  const child = spawnImpl("chrome", argv);
  const browser = new SceneBrowser({
    child,
    argv,
    profileDir: assertSafeGeneratedPath(profileDir),
    webSocketImpl,
    commandTimeoutMs,
    gracefulCloseMs,
    signal
  });
  try {
    await browser.connect({ launchTimeoutMs });
    await browser.attachWorkers({ expectedWidth, expectedHeight, workerCount: workers });
  } catch (error) {
    await browser.close();
    throw error;
  }
  return browser;
}

class SceneBrowser {
  #child;
  #argv;
  #profileDir;
  #webSocketImpl;
  #commandTimeoutMs;
  #gracefulCloseMs;
  #signal;
  #abortHandler = null;
  #socket = null;
  #workers = [];
  #sceneFile = "";
  #nextMessageId = 1;
  #pending = new Map();
  #eventWaiters = new Set();
  #stderr = "";
  #exitInfo = null;
  #exitPromise;
  #closed = false;
  #failure = null;

  constructor({ child, argv, profileDir, webSocketImpl, commandTimeoutMs, gracefulCloseMs, signal }) {
    this.#child = child;
    this.#argv = argv;
    this.#profileDir = profileDir;
    this.#webSocketImpl = webSocketImpl;
    this.#commandTimeoutMs = commandTimeoutMs;
    this.#gracefulCloseMs = gracefulCloseMs;
    this.#signal = signal;

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", chunk => {
      this.#stderr = `${this.#stderr}${chunk}`.slice(-MAX_STDERR_CHARS);
    });
    child.on("error", error => this.#fail(error));
    this.#exitPromise = new Promise(resolve => {
      child.on("exit", (code, killSignal) => {
        this.#exitInfo = { code, signal: killSignal };
        if (!this.#closed) {
          this.#fail(new Error(`chrome exited ${code ?? killSignal}: ${this.#diagnostics()}`));
        }
        resolve();
      });
    });
    if (signal) {
      this.#abortHandler = () => this.#fail(
        signal.reason instanceof Error ? signal.reason : new Error("chrome execution aborted")
      );
      signal.addEventListener("abort", this.#abortHandler, { once: true });
    }
  }

  get launchArgv() {
    return [...this.#argv];
  }

  get workerCount() {
    return this.#workers.length;
  }

  async connect({ launchTimeoutMs }) {
    const endpoint = await this.#readDevToolsEndpoint(launchTimeoutMs);
    this.#socket = await this.#openSocket(endpoint, launchTimeoutMs);
  }

  /**
   * Готовит пул вкладок-исполнителей. Вкладка из аргумента about:blank идёт
   * первой, остальные создаются через Target.createTarget; размер кадра каждой
   * задаётся явно, поэтому окно ОС на результат не влияет.
   */
  async attachWorkers({ expectedWidth, expectedHeight, workerCount }) {
    const { targetInfos } = await this.send("Target.getTargets");
    const page = (Array.isArray(targetInfos) ? targetInfos : []).find(info => info?.type === "page");
    if (!page?.targetId) throw new Error("chrome did not expose a page target for scene capture");
    const targetIds = [page.targetId];
    for (let index = 1; index < workerCount; index += 1) {
      const created = await this.send("Target.createTarget", { url: "about:blank" });
      if (typeof created?.targetId !== "string" || created.targetId.length === 0) {
        throw new Error("chrome refused to create a scene capture tab");
      }
      targetIds.push(created.targetId);
    }
    for (const targetId of targetIds) {
      const attached = await this.send("Target.attachToTarget", { targetId, flatten: true });
      if (typeof attached?.sessionId !== "string" || attached.sessionId.length === 0) {
        throw new Error("chrome refused to attach a CDP session to the scene page");
      }
      const sessionId = attached.sessionId;
      this.#workers.push({ sessionId, busy: false });
      await this.send("Page.enable", {}, sessionId);
      // --window-size задаёт окно ОС, а не вьюпорт: в headless=new вьюпорт ниже
      // на высоту служебной полосы, а созданные вкладки его вовсе не наследуют.
      // Однокадровый --screenshot снимал окно целиком, поэтому размер кадра
      // приходится задавать явно.
      await this.send("Emulation.setDeviceMetricsOverride", {
        width: expectedWidth,
        height: expectedHeight,
        deviceScaleFactor: 1,
        mobile: false
      }, sessionId);
      const viewport = await this.#evaluate(sessionId, "[innerWidth, innerHeight]");
      if (viewport?.[0] !== expectedWidth || viewport?.[1] !== expectedHeight) {
        throw new Error(
          `chrome viewport is ${viewport?.[0]}x${viewport?.[1]}, expected ${expectedWidth}x${expectedHeight}`
        );
      }
    }
  }

  /**
   * Объявляет активную сцену. transparent повторяет поведение флага
   * --default-background-color=00000000 из однокадрового пути, но задаётся
   * per-tab, потому что один браузер обслуживает и opaque, и overlay сцены.
   */
  async openScene({ htmlFile, transparent = false }) {
    this.#sceneFile = assertSafeGeneratedPath(htmlFile);
    const params = transparent ? { color: { r: 0, g: 0, b: 0, a: 0 } } : {};
    for (const worker of this.#workers) {
      await this.send("Emulation.setDefaultBackgroundColorOverride", params, worker.sessionId);
    }
  }

  /**
   * Снимает один кадр сцены. Документ загружается заново на каждый кадр: сам
   * markup ставит анимации на #t=<ms> и замораживает их, а свежий документ —
   * единственный способ получить кадр, побайтово равный однокадровому пути
   * (внутри одного документа остаточные composited-слои от уже отыгранных
   * анимаций меняют сглаживание на десятках пикселей).
   */
  async captureFrame(frameTimeMs, workerIndex = 0) {
    if (!this.#sceneFile) throw new Error("No scene is open for capture");
    const worker = this.#workers[workerIndex];
    if (!worker) throw new RangeError(`Unknown scene capture worker ${workerIndex}`);
    // Одна вкладка — один кадр за раз: параллельные навигации в одном таргете
    // перепутали бы ожидание load между кадрами.
    if (worker.busy) throw new Error(`Scene capture worker ${workerIndex} is already capturing a frame`);
    worker.busy = true;
    try {
      return await this.#captureFrameOn(worker, frameTimeMs);
    } finally {
      worker.busy = false;
    }
  }

  async #captureFrameOn(worker, frameTimeMs) {
    const safeFrameTimeMs = assertFrameTimeMs(frameTimeMs);
    // Смена только фрагмента не перезагружает документ, поэтому кадр попадает
    // и в query: он делает URL уникальным, а разметку не затрагивает.
    const url = `file://${this.#sceneFile}?f=${safeFrameTimeMs}#t=${safeFrameTimeMs}`;
    const loaded = this.#waitForEvent("Page.loadEventFired", worker.sessionId, NAVIGATION_TIMEOUT_MS);
    loaded.catch(() => {});
    const navigation = await this.send("Page.navigate", { url }, worker.sessionId);
    if (navigation?.errorText) {
      throw new Error(`chrome failed to load scene markup: ${navigation.errorText}`);
    }
    await loaded;
    await this.#evaluate(worker.sessionId, "document.fonts.ready.then(() => document.fonts.status)", {
      awaitPromise: true
    });
    const { data } = await this.send(
      "Page.captureScreenshot",
      { format: "png", captureBeyondViewport: false },
      worker.sessionId
    );
    if (typeof data !== "string" || data.length === 0) {
      throw new Error("chrome returned an empty scene screenshot");
    }
    return Buffer.from(data, "base64");
  }

  send(method, params = {}, sessionId) {
    if (this.#failure) return Promise.reject(this.#failure);
    if (this.#closed) return Promise.reject(new Error("chrome CDP session is closed"));
    const id = this.#nextMessageId;
    this.#nextMessageId += 1;
    const message = sessionId ? { id, method, params, sessionId } : { id, method, params };
    return new Promise((resolve, reject) => {
      const entry = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.#pending.delete(id);
          reject(new Error(`chrome CDP command ${method} timed out after ${this.#commandTimeoutMs}ms`));
        }, this.#commandTimeoutMs)
      };
      this.#pending.set(id, entry);
      try {
        this.#socket.send(JSON.stringify(message));
      } catch (error) {
        clearTimeout(entry.timer);
        this.#pending.delete(id);
        reject(error);
      }
    });
  }

  async close() {
    if (this.#closed) {
      await this.#exitPromise;
      return;
    }
    // Сначала штатное завершение: Browser.close даёт Chrome дописать профиль и
    // забрать свои дочерние процессы. SIGTERM ниже — только страховка.
    if (!this.#failure && this.#exitInfo === null && this.#socket) {
      await withTimeout(this.send("Browser.close").catch(() => {}), this.#gracefulCloseMs);
      await withTimeout(this.#exitPromise, this.#gracefulCloseMs);
    }
    this.#closed = true;
    if (this.#signal && this.#abortHandler) {
      this.#signal.removeEventListener("abort", this.#abortHandler);
    }
    this.#rejectOutstanding(this.#failure ?? new Error("chrome CDP session is closed"));
    try {
      this.#socket?.close();
    } catch {
      // Транспорт мог умереть вместе с браузером — процесс всё равно добиваем.
    }
    if (this.#exitInfo === null) {
      this.#child.kill("SIGTERM");
      const killTimer = setTimeout(() => {
        if (this.#exitInfo === null) this.#child.kill("SIGKILL");
      }, KILL_GRACE_MS);
      try {
        await this.#exitPromise;
      } finally {
        clearTimeout(killTimer);
      }
      return;
    }
    await this.#exitPromise;
  }

  async #evaluate(sessionId, expression, { awaitPromise = false } = {}) {
    const result = await this.send(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise },
      sessionId
    );
    if (result?.exceptionDetails) {
      const text = result.exceptionDetails.exception?.description
        || result.exceptionDetails.text
        || "unknown evaluation error";
      throw new Error(`chrome rejected scene evaluation: ${text}`);
    }
    return result?.result?.value;
  }

  async #readDevToolsEndpoint(launchTimeoutMs) {
    const portFile = path.join(this.#profileDir, DEVTOOLS_PORT_FILE);
    const deadline = Date.now() + launchTimeoutMs;
    for (;;) {
      if (this.#failure) throw this.#failure;
      const lines = await readPortFileLines(portFile);
      if (lines) {
        const port = Number(lines[0]);
        const targetPath = lines[1];
        if (!Number.isSafeInteger(port) || port < 1 || port > 65535 || !BROWSER_TARGET_PATH.test(targetPath)) {
          throw new Error("chrome published an unusable DevTools endpoint");
        }
        return `ws://${LOOPBACK_ADDRESS}:${port}${targetPath}`;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `chrome did not publish a DevTools endpoint within ${launchTimeoutMs}ms: ${this.#diagnostics()}`
        );
      }
      await delay(PORT_POLL_INTERVAL_MS);
    }
  }

  #openSocket(endpoint, launchTimeoutMs) {
    return new Promise((resolve, reject) => {
      let socket;
      try {
        socket = new this.#webSocketImpl(endpoint);
      } catch (error) {
        reject(error);
        return;
      }
      const timer = setTimeout(() => {
        try {
          socket.close();
        } catch {
          // Уже мёртвый сокет закрывать нечем — ниже всё равно reject.
        }
        reject(new Error(`chrome DevTools handshake timed out after ${launchTimeoutMs}ms`));
      }, launchTimeoutMs);
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        socket.addEventListener("message", event => this.#handleMessage(event.data));
        socket.addEventListener("close", () => {
          if (!this.#closed) this.#fail(new Error("chrome closed the DevTools connection"));
        });
        socket.addEventListener("error", () => {
          if (!this.#closed) this.#fail(new Error("chrome DevTools connection failed"));
        });
        resolve(socket);
      }, { once: true });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error(`chrome DevTools handshake failed: ${this.#diagnostics()}`));
      }, { once: true });
    });
  }

  #handleMessage(raw) {
    let message;
    try {
      message = JSON.parse(typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8"));
    } catch {
      return;
    }
    if (message.id !== undefined) {
      const entry = this.#pending.get(message.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      this.#pending.delete(message.id);
      if (message.error) {
        entry.reject(new Error(
          `chrome CDP error ${message.error.code ?? ""}: ${message.error.message ?? "unknown"}`.trim()
        ));
        return;
      }
      entry.resolve(message.result ?? {});
      return;
    }
    if (typeof message.method !== "string") return;
    for (const waiter of this.#eventWaiters) {
      if (waiter.method !== message.method) continue;
      if (waiter.sessionId && message.sessionId !== waiter.sessionId) continue;
      clearTimeout(waiter.timer);
      this.#eventWaiters.delete(waiter);
      waiter.resolve(message.params ?? {});
    }
  }

  #waitForEvent(method, sessionId, timeoutMs) {
    return new Promise((resolve, reject) => {
      if (this.#failure) {
        reject(this.#failure);
        return;
      }
      const waiter = { method, sessionId, resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        this.#eventWaiters.delete(waiter);
        reject(new Error(`chrome CDP event ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.#eventWaiters.add(waiter);
    });
  }

  #fail(error) {
    if (this.#failure) return;
    this.#failure = error;
    this.#rejectOutstanding(error);
  }

  #rejectOutstanding(error) {
    for (const [id, entry] of this.#pending) {
      clearTimeout(entry.timer);
      this.#pending.delete(id);
      entry.reject(error);
    }
    for (const waiter of this.#eventWaiters) {
      clearTimeout(waiter.timer);
      this.#eventWaiters.delete(waiter);
      waiter.reject(error);
    }
  }

  #diagnostics() {
    return this.#stderr.trim().split(/\r?\n/u).slice(-3).join(" | ") || "no diagnostic output";
  }
}

async function readPortFileLines(portFile) {
  let content;
  try {
    content = await readFile(portFile, "utf8");
  } catch {
    return null;
  }
  const lines = content.split("\n");
  if (lines.length < 2 || lines[0].trim() === "" || lines[1].trim() === "") return null;
  return [lines[0].trim(), lines[1].trim()];
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Таймер обязан гаситься: иначе висящий setTimeout держит event loop открытым
// после того, как рендер уже закончился.
function withTimeout(promise, ms) {
  let timer = null;
  const expiry = new Promise(resolve => {
    timer = setTimeout(resolve, ms);
  });
  return Promise.race([promise, expiry]).finally(() => clearTimeout(timer));
}

function positiveWorkerCount(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > MAX_CAPTURE_WORKERS) {
    throw new RangeError(`workerCount must be within 1..${MAX_CAPTURE_WORKERS}`);
  }
  return number;
}

function windowDimension(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0 || number > MAX_WINDOW_DIMENSION) {
    throw new TypeError(`${name} must be a positive integer within 1..${MAX_WINDOW_DIMENSION}`);
  }
  return number;
}
