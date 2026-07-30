import { access } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";

const DEFAULT_GODOT_PROJECT = "animation-engine/godot";
const DEFAULT_BRIDGE_PORT = 37645;
const MIN_PORT = 1024;
const MAX_PORT = 65535;

export async function describeGodotAvailability({
  env = process.env,
  platform = process.platform,
  accessImpl = access
} = {}) {
  const candidates = godotBinaryCandidates({ env, platform });
  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate)) continue;
    try {
      await accessImpl(candidate, fsConstants.X_OK);
      return { status: "executable", binaryPath: candidate, source: candidate === env.HERMEST_GODOT_PATH ? "env" : "known-path" };
    } catch {
      // Continue through the fixed allow-list. Never execute a request-provided path.
    }
  }
  return {
    status: "missing",
    binaryPath: candidates[0] ?? null,
    candidates,
    reason: "Godot 4 executable was not found; set HERMEST_GODOT_PATH to an absolute executable path"
  };
}

export function createGodotProcessManager({
  repositoryRoot,
  env = process.env,
  platform = process.platform,
  spawnImpl = spawn,
  availabilityProbe = options => describeGodotAvailability(options)
} = {}) {
  if (!path.isAbsolute(repositoryRoot || "")) {
    throw new TypeError("repositoryRoot must be an absolute path");
  }

  let child = null;
  let state = Object.freeze({ status: "stopped", pid: null, port: null, mode: null, startedAt: null, exit: null });

  return Object.freeze({
    getStatus() {
      return state;
    },

    async start({ mode = "runtime", port = DEFAULT_BRIDGE_PORT } = {}) {
      if (child && state.status === "running") return state;
      if (mode !== "runtime" && mode !== "editor") throw new RangeError("mode must be runtime or editor");
      validatePort(port);

      const availability = await availabilityProbe({ env, platform });
      if (availability.status !== "executable") {
        const error = new Error(availability.reason || "Godot is unavailable");
        error.code = "GODOT_NOT_AVAILABLE";
        error.details = availability;
        throw error;
      }

      const projectPath = path.join(repositoryRoot, DEFAULT_GODOT_PROJECT);
      const args = ["--path", projectPath];
      if (mode === "editor") args.push("--editor");
      else args.push("--headless");
      // Godot only exposes custom application arguments after the `--` separator.
      args.push("--", `--hermes-animation-port=${port}`);

      child = spawnImpl(availability.binaryPath, args, {
        cwd: repositoryRoot,
        env: {
          ...env,
          HERMEST_ANIMATION_PORT: String(port)
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      });

      const startedAt = new Date().toISOString();
      state = Object.freeze({
        status: "running",
        pid: Number.isSafeInteger(child.pid) ? child.pid : null,
        port,
        mode,
        startedAt,
        exit: null,
        binaryPath: availability.binaryPath,
        projectPath
      });

      child.once("exit", (code, signal) => {
        state = Object.freeze({
          ...state,
          status: "stopped",
          pid: null,
          exit: { code: Number.isInteger(code) ? code : null, signal: signal || null }
        });
        child = null;
      });

      child.once("error", error => {
        state = Object.freeze({
          ...state,
          status: "failed",
          pid: null,
          exit: { code: null, signal: null, error: error.message }
        });
        child = null;
      });

      return state;
    },

    async stop({ signal = "SIGTERM" } = {}) {
      if (!child) return state;
      if (signal !== "SIGTERM" && signal !== "SIGKILL") throw new RangeError("unsupported stop signal");
      const active = child;
      const stopped = new Promise(resolve => active.once("exit", resolve));
      active.kill(signal);
      await stopped;
      return state;
    }
  });
}

function godotBinaryCandidates({ env, platform }) {
  const configured = typeof env.HERMEST_GODOT_PATH === "string" ? env.HERMEST_GODOT_PATH.trim() : "";
  if (configured && !path.isAbsolute(configured)) {
    throw new TypeError("HERMEST_GODOT_PATH must be an absolute path");
  }
  const known = platform === "win32"
    ? ["C:\\Program Files\\Godot\\Godot_v4.5-stable_win64.exe"]
    : platform === "darwin"
      ? ["/Applications/Godot.app/Contents/MacOS/Godot"]
      : ["/usr/bin/godot4", "/usr/local/bin/godot4", "/usr/bin/godot", "/usr/local/bin/godot"];
  return [...new Set([configured, ...known].filter(Boolean))];
}

function validatePort(port) {
  if (!Number.isSafeInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new RangeError(`port must be within ${MIN_PORT}..${MAX_PORT}`);
  }
}
