import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { isCompletePng } from "../../src/media/png-header.js";
import { captureCompleteFrame } from "../../src/media/scene-frames.js";

const run = promisify(execFile);

/** Настоящий PNG, а не рукописный: проверять надо то, что отдаёт реальный кодек. */
async function realPng() {
  const dir = await mkdtemp(path.join(tmpdir(), "hermest-png-"));
  const file = path.join(dir, "frame.png");
  try {
    await run("/usr/bin/ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=#0b1526:s=64x36", "-frames:v", "1", "-y", file]);
    return await readFile(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("a whole PNG passes and a truncated one does not", async () => {
  const png = await realPng();
  assert.equal(isCompletePng(png), true);

  // Ровно тот файл, который проходил прежнюю проверку: та же сигнатура, тот же
  // ненулевой размер — и никакого конца.
  const truncated = png.subarray(0, png.length - 12);
  assert.equal(isCompletePng(truncated), false);
  assert.equal(truncated.subarray(0, 8).equals(png.subarray(0, 8)), true, "обрезанный кадр неотличим по заголовку");

  assert.equal(isCompletePng(Buffer.alloc(0)), false);
  assert.equal(isCompletePng(Buffer.from("не png вовсе")), false);
  assert.equal(isCompletePng("строка"), false);
  assert.equal(isCompletePng(null), false);
});

test("a whole frame is taken once, without a retry", async () => {
  const png = await realPng();
  let calls = 0;
  const browser = { captureFrame: async () => { calls += 1; return png; } };
  const frame = await captureCompleteFrame({ browser, timeMs: 0, workerIndex: 0, label: "001-f0" });
  assert.equal(calls, 1);
  assert.equal(frame, png);
});

test("a truncated frame is retaken, not written", async () => {
  const png = await realPng();
  const attempts = [png.subarray(0, 40), png];
  let calls = 0;
  const browser = { captureFrame: async () => attempts[calls++] };
  const frame = await captureCompleteFrame({ browser, timeMs: 100, workerIndex: 1, label: "002-f6" });
  assert.equal(calls, 2, "первый снимок отброшен, второй принят");
  assert.equal(frame, png);
});

test("a frame that never arrives whole names itself in the error", async () => {
  const png = await realPng();
  let calls = 0;
  const browser = { captureFrame: async () => { calls += 1; return png.subarray(0, 40); } };
  await assert.rejects(
    () => captureCompleteFrame({ browser, timeMs: 200, workerIndex: 0, label: "003-f713" }),
    error => {
      assert.match(error.message, /003-f713/u, "в ошибке видно, какой кадр не дался");
      assert.match(error.message, /40 bytes/u, "и сколько байтов пришло вместо кадра");
      assert.match(error.message, /IEND/u);
      return true;
    }
  );
  assert.equal(calls, 3, "три попытки, а не бесконечный цикл");
});

test("the capture time is the same on every attempt", async () => {
  const png = await realPng();
  const seen = [];
  let calls = 0;
  const browser = {
    captureFrame: async timeMs => {
      seen.push(timeMs);
      calls += 1;
      return calls < 3 ? png.subarray(0, 40) : png;
    }
  };
  await captureCompleteFrame({ browser, timeMs: 1234, workerIndex: 0, label: "004-f74" });
  assert.deepEqual(seen, [1234, 1234, 1234], "повтор снимает то же виртуальное время, иначе кадр был бы другим");
});
