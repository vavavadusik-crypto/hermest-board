import assert from "node:assert/strict";
import test from "node:test";

import { assertSequenceComplete } from "../../src/media/scene-frames.js";

const PATTERN = "/tmp/run/scene-01-f%04d.png";

function statOver(existing) {
  return async function statImpl(file) {
    if (!(file in existing)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    return { size: existing[file] };
  };
}

function sequence(count, { skip = [], zero = [] } = {}) {
  const files = {};
  for (let index = 0; index < count; index += 1) {
    if (skip.includes(index)) continue;
    const file = PATTERN.replace("%04d", String(index).padStart(4, "0"));
    files[file] = zero.includes(index) ? 0 : 4096;
  }
  return files;
}

test("a complete sequence passes", async () => {
  await assertSequenceComplete({
    pattern: PATTERN,
    frameCount: 12,
    statImpl: statOver(sequence(12))
  });
});

test("a hole in the middle is reported with the index that broke", async () => {
  await assert.rejects(
    assertSequenceComplete({
      pattern: PATTERN,
      frameCount: 12,
      statImpl: statOver(sequence(12, { skip: [7] }))
    }),
    error => {
      assert.match(error.message, /incomplete \(12 expected\)/u);
      assert.match(error.message, /нет кадров: 7/u);
      return true;
    }
  );
});

// Оборванная запись даёт файл нулевого размера: `image2` на нём спотыкается так
// же, как на отсутствующем, а по листингу каталога он выглядит на месте.
test("a zero-byte frame counts as missing", async () => {
  await assert.rejects(
    assertSequenceComplete({
      pattern: PATTERN,
      frameCount: 6,
      statImpl: statOver(sequence(6, { zero: [3] }))
    }),
    /пустые кадры: 3/u
  );
});

test("the missing list stops at five entries instead of naming a thousand", async () => {
  await assert.rejects(
    assertSequenceComplete({
      pattern: PATTERN,
      frameCount: 900,
      statImpl: statOver(sequence(900, { skip: Array.from({ length: 800 }, (_unused, index) => index + 50) }))
    }),
    error => {
      const named = error.message.split("нет кадров: ")[1].split(";")[0].split(", ");
      assert.equal(named.length, 5);
      return true;
    }
  );
});

// Кап на длинных сценах обрезает секвенцию честно: кадров ровно frameCount,
// и проверка не должна принимать это за потерю.
test("a sequence capped by the frame budget is still complete", async () => {
  await assertSequenceComplete({
    pattern: PATTERN,
    frameCount: 1800,
    statImpl: statOver(sequence(1800))
  });
});
