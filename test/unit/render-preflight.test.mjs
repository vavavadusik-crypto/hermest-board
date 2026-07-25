import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  preflightBoardInput,
  renderProject,
  resolveOutputRoot,
  validateBoardProject
} from "../../src/media/render-project.js";

const validFixture = path.resolve("test/fixtures/minimal-board.json");
const execFileAsync = promisify(execFile);

test("invalid board input fails before any output directory is created", async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "hermest-board-preflight-"));
  const invalidInput = path.join(sandbox, "invalid.json");
  const missingOutput = path.join(sandbox, "must-not-exist");
  await writeFile(invalidInput, "{invalid", { mode: 0o600 });

  await assert.rejects(
    () => renderProject({ inputPath: invalidInput, outputDir: missingOutput }),
    /valid JSON/
  );
  await assert.rejects(() => access(missingOutput));
});

test("board input preflight enforces a bounded regular file", async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "hermest-board-preflight-size-"));
  const oversized = path.join(sandbox, "oversized.json");
  await writeFile(oversized, " ".repeat(2 * 1024 * 1024 + 1), { mode: 0o600 });

  await assert.rejects(() => preflightBoardInput(oversized), /input file.*limit/i);
  await assert.rejects(() => preflightBoardInput(sandbox), /regular file/i);
});

test("structural preflight rejects excessive depth and cycles before rendering", () => {
  const project = {
    schemaVersion: 1,
    title: "Depth",
    cards: [{ id: "safe", title: "Safe", text: "Renderable" }],
    unknown: {}
  };
  let cursor = project.unknown;
  for (let index = 0; index < 80; index += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  assert.throws(() => validateBoardProject(project), /maximum depth/i);

  const cyclic = {
    schemaVersion: 1,
    title: "Cycle",
    cards: [{ id: "safe", title: "Safe", text: "Renderable" }]
  };
  cyclic.self = cyclic;
  assert.throws(() => validateBoardProject(cyclic), /cycle/i);
});

test("deep valid JSON fails before output root access or TTS execution", async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "hermest-board-preflight-deep-"));
  const deepInput = path.join(sandbox, "deep.json");
  const missingOutput = path.join(sandbox, "must-not-exist");
  const nested = `${'{"next":'.repeat(80)}null${"}".repeat(80)}`;
  await writeFile(
    deepInput,
    `{"schemaVersion":1,"title":"Deep","cards":[{"id":"a","text":"ok"}],"unknown":${nested}}`,
    { mode: 0o600 }
  );
  let ttsCalled = false;

  await assert.rejects(
    () => renderProject({
      inputPath: deepInput,
      outputDir: missingOutput,
      ttsAdapter: { synthesize: async () => { ttsCalled = true; } }
    }),
    /maximum depth/i
  );
  assert.equal(ttsCalled, false);
  await assert.rejects(() => access(missingOutput));
});

test("CLI completes structural preflight before creating output or invoking render", async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "hermest-board-cli-preflight-"));
  const deepInput = path.join(sandbox, "deep.json");
  const nested = `${'{"next":'.repeat(80)}null${"}".repeat(80)}`;
  await writeFile(
    deepInput,
    `{"schemaVersion":1,"title":"Deep","cards":[{"id":"a","text":"ok"}],"unknown":${nested}}`,
    { mode: 0o600 }
  );

  await assert.rejects(
    () => execFileAsync(process.execPath, [
      path.resolve("scripts/render-project.mjs"),
      "--input", deepInput
    ], {
      cwd: sandbox,
      timeout: 30000,
      env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" }
    }),
    error => error?.code === 1 && /maximum depth/i.test(String(error.stderr || ""))
  );
  await assert.rejects(() => access(path.join(sandbox, "tmp")));
});

test("render output realpath cannot escape through a symlink", async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "hermest-board-preflight-link-"));
  const escaped = path.join(sandbox, "escaped");
  await symlink("/etc", escaped);

  await assert.rejects(
    () => renderProject({ inputPath: validFixture, outputDir: escaped }),
    /outside allowed render roots/
  );
});

test("filesystem roots outside system temp are not trusted render roots", async () => {
  await assert.rejects(
    () => resolveOutputRoot("/home"),
    /outside allowed render roots/
  );
  await assert.rejects(
    () => resolveOutputRoot(path.resolve("tmp")),
    /outside allowed render roots|ENOENT/
  );
  assert.equal(await resolveOutputRoot("/tmp"), "/tmp");
});

test("preflight rejects a hostile target duration before any synthesis is paid for", async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "hermest-board-preflight-duration-"));
  const fixture = JSON.parse(await readFile(validFixture, "utf8"));

  const withValidTarget = path.join(sandbox, "valid-target.json");
  await writeFile(
    withValidTarget,
    JSON.stringify({ ...fixture, brief: { ...fixture.brief, targetDurationSeconds: 60 } }),
    { mode: 0o600 }
  );
  const accepted = await preflightBoardInput(withValidTarget);
  assert.equal(accepted.brief.targetDurationSeconds, 60);

  for (const [name, value] of [["short", 5], ["long", 4000], ["text", "минута"], ["bool", true]]) {
    const rejectedInput = path.join(sandbox, `rejected-${name}.json`);
    await writeFile(
      rejectedInput,
      JSON.stringify({ ...fixture, brief: { ...fixture.brief, targetDurationSeconds: value } }),
      { mode: 0o600 }
    );
    await assert.rejects(() => preflightBoardInput(rejectedInput), /targetDurationSeconds/, name);
  }

  // Прежнее поведение: без цели длительности проект проходит как раньше.
  const untouched = await preflightBoardInput(validFixture);
  assert.equal(untouched.brief.targetDurationSeconds, undefined);
});
