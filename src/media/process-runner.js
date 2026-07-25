import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { assertSafeGeneratedPath } from "./ffmpeg-args.js";
import { parseProbeOutput } from "./ffprobe.js";

const TOOL_PATHS = Object.freeze({
  ffmpeg: "/usr/bin/ffmpeg",
  ffprobe: "/usr/bin/ffprobe"
});
const SCRUBBED_ENV = Object.freeze({
  HOME: "/tmp",
  LANG: "C.UTF-8",
  LC_ALL: "C.UTF-8",
  PATH: "/usr/bin:/bin",
  TMPDIR: "/tmp"
});
const MAX_CAPTURE_CHARS = 128000;
const MAX_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const KILL_GRACE_MS = 2000;
const MAX_STDIN_BYTES = 1024 * 1024;

const SAFE_ABSOLUTE_PATH = /^\/[A-Za-z0-9_./-]+$/;

export function resolvePiperBinaryPath({ env = process.env, homeDirectory = os.userInfo().homedir } = {}) {
  const configured = typeof env.HERMEST_PIPER_PATH === "string" ? env.HERMEST_PIPER_PATH.trim() : "";
  if (configured) {
    if (!SAFE_ABSOLUTE_PATH.test(configured)) {
      throw new RangeError("HERMEST_PIPER_PATH must be a safe absolute path");
    }
    return configured;
  }
  return path.join(homeDirectory, ".local", "opt", "piper", "piper");
}

export function resolveChromeBinaryPath({ env = process.env } = {}) {
  const configured = typeof env.HERMEST_CHROME_PATH === "string" ? env.HERMEST_CHROME_PATH.trim() : "";
  if (configured) {
    if (!SAFE_ABSOLUTE_PATH.test(configured)) {
      throw new RangeError("HERMEST_CHROME_PATH must be a safe absolute path");
    }
    return configured;
  }
  return "/usr/bin/google-chrome";
}

export function getMediaToolDescriptor(tool) {
  if (tool === "piper") {
    return { path: resolvePiperBinaryPath(), env: { ...SCRUBBED_ENV } };
  }
  if (tool === "chrome") {
    return { path: resolveChromeBinaryPath(), env: { ...SCRUBBED_ENV } };
  }
  const binaryPath = TOOL_PATHS[tool];
  if (!binaryPath) throw new RangeError(`Unsupported media tool: ${tool}`);
  return { path: binaryPath, env: { ...SCRUBBED_ENV } };
}

// Долгоживущий инструмент (headless Chrome под CDP) не укладывается в
// run-to-completion контракт runMediaTool, но обязан спавниться по тем же
// правилам: массив аргументов, shell:false, вычищенное окружение.
export function spawnMediaTool(tool, args) {
  const descriptor = getMediaToolDescriptor(tool);
  assertStringArguments(args);
  return spawn(descriptor.path, args, {
    shell: false,
    stdio: ["ignore", "ignore", "pipe"],
    env: descriptor.env
  });
}

export async function runMediaTool(tool, args, { timeoutMs = 300000, signal, stdinText } = {}) {
  const descriptor = getMediaToolDescriptor(tool);
  assertStringArguments(args);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new RangeError(`Media tool timeout must be within 1..${MAX_TIMEOUT_MS}ms`);
  }
  if (stdinText !== undefined) {
    if (typeof stdinText !== "string") throw new TypeError("Media tool stdin must be a string");
    if (Buffer.byteLength(stdinText, "utf8") > MAX_STDIN_BYTES) {
      throw new RangeError(`Media tool stdin limit is ${MAX_STDIN_BYTES} bytes`);
    }
  }
  signal?.throwIfAborted();

  return new Promise((resolve, reject) => {
    const child = spawn(descriptor.path, args, {
      shell: false,
      stdio: [stdinText === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      env: descriptor.env
    });
    if (stdinText !== undefined) {
      child.stdin.on("error", () => {});
      child.stdin.end(stdinText);
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    let terminationError = null;
    let killTimer = null;
    const append = (current, chunk) => `${current}${chunk}`.slice(-MAX_CAPTURE_CHARS);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => { stdout = append(stdout, chunk); });
    child.stderr.on("data", chunk => { stderr = append(stderr, chunk); });

    const requestTermination = error => {
      if (terminationError || settled) return;
      terminationError = error;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, KILL_GRACE_MS);
    };
    const abortHandler = () => {
      requestTermination(signal?.reason instanceof Error
        ? signal.reason
        : new Error(`${tool} execution aborted`));
    };
    if (signal) signal.addEventListener("abort", abortHandler, { once: true });
    const timer = setTimeout(() => {
      requestTermination(new Error(`${tool} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      if (signal) signal.removeEventListener("abort", abortHandler);
    };
    const settle = callback => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };

    child.on("error", error => settle(() => reject(error)));
    child.on("close", code => settle(() => {
      if (terminationError) {
        reject(terminationError);
        return;
      }
      if (code !== 0) {
        reject(new Error(`${tool} exited ${code}: ${stderr.trim() || "no diagnostic output"}`));
        return;
      }
      resolve({ code, stdout, stderr });
    }));
  });
}

function assertStringArguments(args) {
  if (!Array.isArray(args) || args.some(value => typeof value !== "string")) {
    throw new TypeError("Media tool arguments must be a string array");
  }
}

export async function probeMediaFile(filePath, { signal } = {}) {
  const safePath = assertSafeGeneratedPath(filePath);
  const { stdout } = await runMediaTool("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration,size",
    "-show_entries", "stream=index,codec_name,codec_type,width,height,sample_rate,channels",
    "-of", "json",
    safePath
  ], { timeoutMs: 60000, signal });
  return parseProbeOutput(stdout);
}

export async function mediaToolVersion(tool, { signal } = {}) {
  const { stdout } = await runMediaTool(tool, ["-version"], { timeoutMs: 30000, signal });
  return stdout.split(/\r?\n/u)[0].trim();
}

export async function describeArtifact(filePath, { name, type, probe = {} }) {
  const safePath = assertSafeGeneratedPath(filePath);
  const info = await stat(safePath);
  if (!info.isFile() || info.size <= 0) throw new TypeError(`Artifact is missing or empty: ${name}`);
  return {
    name,
    type,
    bytes: info.size,
    sha256: await hashFile(safePath),
    probe
  };
}

async function hashFile(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}
