import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import { createDraftTextModel, draftBoardService } from "../../src/local-media/draft-service.js";
import { CLI_MODEL_PRESETS, createCliTextModel, describeCliModelAvailability } from "../../src/media/cli-text-model.js";

// Фейковый child_process: ничего не спавнится, stdout/stderr/код возврата
// отдаются из параметров, stdin записывается в calls[].stdinText.
function fakeSpawn({ stdout = "", stderr = "", code = 0 } = {}) {
  const calls = [];
  const spawnImpl = (command, args, options) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.killSignals = [];
    child.kill = signal => {
      child.killSignals.push(signal);
      return true;
    };
    let stdinText = "";
    child.stdin.on("data", chunk => {
      stdinText += chunk.toString("utf8");
    });
    calls.push({
      command,
      args,
      options,
      child,
      get stdinText() {
        return stdinText;
      }
    });
    setImmediate(() => {
      if (stdout) child.stdout.write(stdout);
      if (stderr) child.stderr.write(stderr);
      child.emit("close", code);
    });
    return child;
  };
  return { calls, spawnImpl };
}

// Процесс, который никогда не завершается сам: SIGTERM игнорирует, на SIGKILL
// закрывается. Так проверяется kill-grace без реального процесса.
function hangingSpawn(killSignals) {
  return () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = signal => {
      killSignals.push(signal);
      if (signal === "SIGKILL") setImmediate(() => child.emit("close", null));
      return true;
    };
    return child;
  };
}

test("cli model runs the preset command with the prompt on stdin and returns stdout", async () => {
  const { calls, spawnImpl } = fakeSpawn({ stdout: "  ответ модели\n" });
  const model = createCliTextModel({ preset: "claude", model: "sonnet", env: {}, spawnImpl });

  const text = await model.complete({ system: "только JSON", prompt: "тема" });

  assert.equal(text, "ответ модели");
  assert.equal(model.provider, "cli:claude");
  assert.equal(model.model, "sonnet");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "claude");
  assert.deepEqual(calls[0].args, CLI_MODEL_PRESETS.claude.buildArgs("sonnet"));
  assert.equal(calls[0].args.includes("--model"), true);
  assert.equal(calls[0].options.shell, false, "argv must go to execve without a shell");
  assert.equal(calls[0].stdinText, "только JSON\n\nтема");
});

test("the command never comes from the caller: only a known preset id is accepted", () => {
  for (const preset of [
    "claude; rm -rf /",
    "claude && evil",
    "claude$(id)",
    "claude`id`",
    "../../bin/sh",
    "/etc/passwd",
    "evilcli",
    { command: "claude" },
    ["claude"],
    42,
    "",
    "   "
  ]) {
    assert.throws(
      () => createCliTextModel({ preset, env: {} }),
      RangeError,
      `expected rejection for preset ${JSON.stringify(preset)}`
    );
  }
});

test("command, args and buildArgs fields from the caller are ignored", async () => {
  const { calls, spawnImpl } = fakeSpawn({ stdout: "ok" });
  const model = createCliTextModel({
    preset: "claude",
    command: "sh",
    args: ["-c", "id"],
    buildArgs: () => ["pwned"],
    env: {},
    spawnImpl
  });

  await model.complete({ prompt: "тема" });

  assert.equal(calls[0].command, "claude");
  assert.deepEqual(calls[0].args, CLI_MODEL_PRESETS.claude.buildArgs("sonnet"));
});

test("the custom preset rejects shell-ish command names and relative paths", () => {
  for (const command of [
    "my cli",
    "cli;rm",
    "cli$(id)",
    "cli`id`",
    "cli\"quoted",
    "cli'quoted",
    "../bin/sh",
    "bin/sh",
    "./cli",
    "/tmp/ev il",
    "/tmp/ev;il",
    "/tmp/ev$(il)",
    ""
  ]) {
    assert.throws(
      () => createCliTextModel({ preset: "custom", env: { HERMEST_CLI_MODEL_COMMAND: command } }),
      RangeError,
      `expected rejection for command ${JSON.stringify(command)}`
    );
  }
  assert.doesNotThrow(() => createCliTextModel({ preset: "custom", env: { HERMEST_CLI_MODEL_COMMAND: "my-cli.2" } }));
  assert.doesNotThrow(() => createCliTextModel({ preset: "custom", env: { HERMEST_CLI_MODEL_COMMAND: "/usr/local/bin/my-cli" } }));
});

test("the custom preset caps the argument count and length", () => {
  const tooMany = Array.from({ length: 33 }, (_, index) => `a${index}`).join(" ");
  assert.throws(
    () => createCliTextModel({ preset: "custom", env: { HERMEST_CLI_MODEL_COMMAND: "my-cli", HERMEST_CLI_MODEL_ARGS: tooMany } }),
    /at most 32 arguments/
  );
  assert.throws(
    () => createCliTextModel({ preset: "custom", env: { HERMEST_CLI_MODEL_COMMAND: "my-cli", HERMEST_CLI_MODEL_ARGS: `run ${"x".repeat(257)}` } }),
    /longer than 256 characters/
  );
});

test("model names must match the safe pattern", () => {
  for (const model of [
    "bad model",
    "model;rm",
    "mod$(id)",
    "mod`id`",
    "mod\"el",
    "mod'el",
    "mod\nel",
    "модель",
    "a".repeat(129),
    "model > out"
  ]) {
    assert.throws(
      () => createCliTextModel({ preset: "claude", model, env: {} }),
      /invalid cli model name/,
      `expected rejection for model ${JSON.stringify(model)}`
    );
  }
  for (const model of ["llama3.1:8b", "gpt-4o-mini", "meta-llama/Llama-3.1-8B-Instruct", "qwen2.5_72b"]) {
    assert.doesNotThrow(() => createCliTextModel({ preset: "claude", model, env: {} }), `expected acceptance for ${model}`);
  }
});

test("the {model} placeholder in custom args is replaced with the validated model name", async () => {
  const { calls, spawnImpl } = fakeSpawn({ stdout: "ok" });
  const model = createCliTextModel({
    preset: "custom",
    env: {
      HERMEST_CLI_MODEL_COMMAND: "my-cli",
      HERMEST_CLI_MODEL_ARGS: "run --model {model} --fast {model}"
    },
    model: "qwen2.5:7b",
    spawnImpl
  });

  await model.complete({ prompt: "тема" });

  assert.equal(calls[0].command, "my-cli");
  assert.deepEqual(calls[0].args, ["run", "--model", "qwen2.5:7b", "--fast", "qwen2.5:7b"]);
});

test("an unset model falls back to the preset default", () => {
  const ollama = createCliTextModel({ preset: "ollama", model: "  ", env: {} });
  assert.equal(ollama.model, "llama3.1:8b");
  const custom = createCliTextModel({
    preset: "custom",
    env: { HERMEST_CLI_MODEL_COMMAND: "my-cli", HERMEST_CLI_MODEL_NAME: "  my-default  " }
  });
  assert.equal(custom.model, "my-default");
});

test("stdout is cut off at the size limit and the process is terminated", async () => {
  const killSignals = [];
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = signal => {
      killSignals.push(signal);
      setImmediate(() => child.emit("close", null));
      return true;
    };
    setImmediate(() => child.stdout.write(Buffer.alloc(1024 * 1024 + 1, "x")));
    return child;
  };
  const model = createCliTextModel({ preset: "claude", env: {}, spawnImpl, timeoutMs: 30000 });

  await assert.rejects(model.complete({ prompt: "тема" }), /output exceeds the allowed size/);
  assert.deepEqual(killSignals, ["SIGTERM"], "oversized output must stop the process, not wait for the timeout");
});

test("a hanging CLI is killed after the grace window and the error stays sanitized", async () => {
  const killSignals = [];
  const model = createCliTextModel({
    preset: "claude",
    env: { HOME: "/home/tester" },
    spawnImpl: hangingSpawn(killSignals),
    timeoutMs: 25
  });

  await assert.rejects(model.complete({ prompt: "тема" }), error => {
    assert.match(error.message, /^claude CLI timed out after 25ms$/);
    assert.equal(error.message.includes("/home"), false, "no paths in the timeout error");
    return true;
  });
  assert.deepEqual(killSignals, ["SIGTERM", "SIGKILL"], "SIGTERM first, SIGKILL after the grace window");
});

test("a non-zero exit leaks neither paths nor secrets from stderr", async () => {
  const secret = "sk-live-0123456789abcdefghijklmnop";
  const { spawnImpl } = fakeSpawn({
    code: 1,
    stderr: `auth failed with ${secret} at /home/architect/.config/claude/auth.json\n    at frame (/home/architect/app.js:1:1)\n${"шум ".repeat(200)}`
  });
  const model = createCliTextModel({ preset: "claude", env: {}, spawnImpl });

  await assert.rejects(model.complete({ prompt: "тема" }), error => {
    assert.match(error.message, /^claude CLI exited with code 1: /);
    assert.equal(error.message.includes(secret), false, "the secret must never reach the error text");
    assert.equal(error.message.includes("/home"), false, "no POSIX paths in the error text");
    assert.equal(error.message.includes("\n"), false, "no multi-line stacks in the error text");
    assert.ok(error.message.length <= 260, "the diagnostic summary is length-capped");
    return true;
  });
});

test("a spawn failure is reported without internals", async () => {
  const spawnImpl = () => {
    throw new Error("spawn /usr/local/bin/claude ENOENT at /home/architect/server.js:1");
  };
  const model = createCliTextModel({ preset: "claude", env: {}, spawnImpl });

  await assert.rejects(model.complete({ prompt: "тема" }), error => {
    assert.match(error.message, /^claude CLI failed to start: /);
    assert.equal(error.message.includes("/usr/local/bin"), false);
    assert.equal(error.message.includes("/home"), false);
    return true;
  });
});

test("ANSI escape sequences are stripped from the answer", async () => {
  const { spawnImpl } = fakeSpawn({
    stdout: "\x1b[1;32mзелёный\x1b[0m \x1b]8;;https://evil.example\x07link\x1b]8;;\x07 \x1b[?25hтекст\x1b[2K\n"
  });
  const model = createCliTextModel({ preset: "claude", env: {}, spawnImpl });

  const text = await model.complete({ prompt: "тема" });

  assert.equal(text, "зелёный link текст");
  assert.equal(text.includes("\x1b"), false);
});

test("an empty completion and an empty prompt fail closed without spawning for the latter", async () => {
  const { calls, spawnImpl } = fakeSpawn({ stdout: "  \x1b[0m \n " });
  const model = createCliTextModel({ preset: "claude", env: {}, spawnImpl });

  await assert.rejects(model.complete({ prompt: "тема" }), /empty completion/);
  await assert.rejects(model.complete({ prompt: "   " }), /prompt is required/);
  assert.equal(calls.length, 1, "an empty prompt must be rejected before spawn");
});

test("the child process gets a minimal environment: provider keys never reach the CLI", async () => {
  const { calls, spawnImpl } = fakeSpawn({ stdout: "ok" });
  const model = createCliTextModel({
    preset: "claude",
    env: {
      HOME: "/home/tester",
      PATH: "/custom/bin",
      LANG: "ru_RU.UTF-8",
      OPENAI_API_KEY: "sk-live-0123456789abcdefghijklmnop",
      ANTHROPIC_API_KEY: "sk-ant-0123456789abcdefghijklmnop",
      GROQ_API_KEY: "gsk_0123456789abcdefghijklmnop",
      AWS_SECRET_ACCESS_KEY: "aws-secret",
      ELEVENLABS_API_KEY: "el-key"
    },
    spawnImpl
  });

  await model.complete({ prompt: "тема" });

  const childEnv = calls[0].options.env;
  const allowed = new Set([
    "HOME", "PATH", "LANG", "LC_ALL", "LOGNAME", "USER", "TMPDIR",
    "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "CODEX_HOME", "OLLAMA_HOST",
    "NO_COLOR"
  ]);
  for (const key of Object.keys(childEnv)) {
    assert.ok(allowed.has(key), `unexpected env key leaked to the child: ${key}`);
  }
  assert.equal(childEnv.HOME, "/home/tester");
  assert.equal(childEnv.PATH, "/custom/bin");
  assert.equal(childEnv.LANG, "ru_RU.UTF-8");
  assert.equal(childEnv.NO_COLOR, "1");

  const fallback = fakeSpawn({ stdout: "ok" });
  const withoutPath = createCliTextModel({ preset: "claude", env: {}, spawnImpl: fallback.spawnImpl });
  await withoutPath.complete({ prompt: "тема" });
  assert.equal(fallback.calls[0].options.env.PATH, "/usr/local/bin:/usr/bin:/bin", "PATH falls back to a safe default");
});

test("availability reports missing for absent binaries and executable for present ones", async () => {
  const env = { PATH: "/usr/bin:/bin" };
  const missing = await describeCliModelAvailability({
    env,
    accessImpl: async () => {
      throw new Error("ENOENT");
    }
  });
  assert.deepEqual(missing.map(entry => entry.id), ["claude", "ollama", "codex", "gemini"]);
  for (const entry of missing) {
    assert.equal(entry.status, "missing");
    assert.equal(entry.reason, `${entry.command} is not installed or not on PATH`);
  }

  const found = await describeCliModelAvailability({
    env,
    accessImpl: async candidate => {
      if (String(candidate).endsWith("/ollama")) return;
      throw new Error("ENOENT");
    }
  });
  const byId = Object.fromEntries(found.map(entry => [entry.id, entry]));
  assert.equal(byId.ollama.status, "executable");
  assert.equal(byId.ollama.reason, "");
  assert.equal(byId.claude.status, "missing");
  assert.equal(byId.codex.status, "missing");
  assert.equal(byId.gemini.status, "missing");
});

test("availability probes a custom absolute-path command directly, not via PATH", async () => {
  const probed = [];
  const report = await describeCliModelAvailability({
    env: { PATH: "/usr/bin", HERMEST_CLI_MODEL_COMMAND: "/opt/tools/my-cli" },
    accessImpl: async candidate => {
      probed.push(String(candidate));
      if (String(candidate) === "/opt/tools/my-cli") return;
      throw new Error("ENOENT");
    }
  });
  const custom = report.find(entry => entry.id === "custom");
  assert.equal(custom.status, "executable");
  assert.equal(custom.command, "/opt/tools/my-cli");
  assert.equal(probed.includes("/usr/bin/my-cli"), false, "absolute paths must not be resolved via PATH");
});

test("availability is honest about a broken custom preset instead of hiding it", async () => {
  const report = await describeCliModelAvailability({
    env: { HERMEST_CLI_MODEL_COMMAND: "bad;command" },
    accessImpl: async () => {
      throw new Error("ENOENT");
    }
  });
  const custom = report.find(entry => entry.id === "custom");
  assert.equal(custom.status, "missing");
  assert.match(custom.reason, /bare binary name or an absolute path/);
});

const PLAN_JSON = JSON.stringify({
  title: "T",
  cards: [
    { title: "a", text: "aa" },
    { title: "b", text: "bb" }
  ]
});

function mockTextModel() {
  return {
    async complete() {
      return PLAN_JSON;
    }
  };
}

test("draft service builds the cli text model from the endpoint preset and model only", () => {
  const model = createDraftTextModel({
    endpoint: { kind: "cli", preset: "ollama", model: "llama3.1:8b", command: "sh", args: ["-c", "id"], baseUrl: "http://evil.example" }
  });
  assert.equal(model.provider, "cli:ollama");
  assert.equal(model.model, "llama3.1:8b");

  const fromRequest = createDraftTextModel({ endpoint: { kind: "cli", preset: "claude" }, model: "sonnet" });
  assert.equal(fromRequest.provider, "cli:claude");
  assert.equal(fromRequest.model, "sonnet");
});

test("draft service cli branch rejects hostile presets and model names", () => {
  assert.throws(
    () => createDraftTextModel({ endpoint: { kind: "cli", preset: "claude; rm -rf /" } }),
    /unknown cli preset/
  );
  assert.throws(
    () => createDraftTextModel({ endpoint: { kind: "cli", preset: "../../bin/sh" } }),
    /unknown cli preset/
  );
  assert.throws(
    () => createDraftTextModel({ endpoint: { kind: "cli", preset: "claude", model: "bad;model" } }),
    /invalid cli model name/
  );
});

test("draft service cli branch keeps the existing branches intact", () => {
  const bridge = createDraftTextModel({ model: "chatgpt" });
  assert.equal(bridge.model, "chatgpt");

  const openai = createDraftTextModel({
    endpoint: { kind: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" }
  });
  assert.equal(openai.provider, "openai-compatible");
  assert.equal(openai.model, "gpt-4o-mini");
});

test("draft service skips the bridge availability check for a cli endpoint", async () => {
  let availabilityCalls = 0;

  const result = await draftBoardService({
    topic: "CLI вместо моста",
    sceneCount: 2,
    research: false,
    endpoint: { kind: "cli", preset: "claude", model: "sonnet" },
    textModel: mockTextModel(),
    availabilityCheck: async () => {
      availabilityCalls += 1;
      return { status: "missing", reason: "bridge is down" };
    }
  });

  assert.equal(availabilityCalls, 0, "a cli endpoint must not depend on the browser bridge");
  assert.ok(result.board.cards.length >= 2);
});
