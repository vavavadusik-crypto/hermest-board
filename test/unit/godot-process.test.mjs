import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import path from "node:path";
import test from "node:test";

import { createGodotProcessManager, describeGodotAvailability } from "../../src/animation/godot-process.js";

test("Godot availability only accepts an absolute configured executable", async () => {
  await assert.rejects(
    describeGodotAvailability({ env: { HERMEST_GODOT_PATH: "godot4" } }),
    /must be an absolute path/
  );
  const result = await describeGodotAvailability({
    env: { HERMEST_GODOT_PATH: "/opt/godot/godot4" },
    accessImpl: async candidate => {
      assert.equal(candidate, "/opt/godot/godot4");
    }
  });
  assert.equal(result.status, "executable");
  assert.equal(result.source, "env");
});

test("Godot process manager launches a fixed project and never accepts arbitrary argv", async () => {
  const calls = [];
  class FakeChild extends EventEmitter {
    constructor() {
      super();
      this.pid = 4321;
      this.stdout = new EventEmitter();
      this.stderr = new EventEmitter();
    }
    kill(signal) {
      queueMicrotask(() => this.emit("exit", 0, signal));
      return true;
    }
  }
  const child = new FakeChild();
  const manager = createGodotProcessManager({
    repositoryRoot: "/workspace/hermest-board",
    env: {},
    spawnImpl(binary, args, options) {
      calls.push({ binary, args, options });
      return child;
    },
    availabilityProbe: async () => ({ status: "executable", binaryPath: "/usr/bin/godot4" })
  });

  const running = await manager.start({ mode: "runtime", port: 37645 });
  assert.equal(running.status, "running");
  assert.equal(running.pid, 4321);
  assert.deepEqual(calls[0].args, [
    "--path",
    path.join("/workspace/hermest-board", "animation-engine/godot"),
    "--headless",
    "--",
    "--hermes-animation-port=37645"
  ]);
  assert.equal(calls[0].options.cwd, "/workspace/hermest-board");
  assert.equal(calls[0].options.env.HERMEST_ANIMATION_PORT, "37645");

  const same = await manager.start({ mode: "editor", port: 40000 });
  assert.equal(same.pid, 4321, "second start is idempotent while the child is running");
  assert.equal(calls.length, 1);

  const stopped = await manager.stop();
  assert.equal(stopped.status, "stopped");
  assert.deepEqual(stopped.exit, { code: 0, signal: "SIGTERM" });
});

test("Godot process manager fails closed when the runtime is unavailable", async () => {
  const manager = createGodotProcessManager({
    repositoryRoot: "/workspace/hermest-board",
    availabilityProbe: async () => ({ status: "missing", reason: "not installed" })
  });
  await assert.rejects(
    manager.start(),
    error => error.code === "GODOT_NOT_AVAILABLE" && error.message === "not installed"
  );
});
