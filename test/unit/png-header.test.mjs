import assert from "node:assert/strict";
import test from "node:test";

import { readPngHeader } from "../../src/media/png-header.js";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngHeaderBuffer({ width = 1920, height = 1080, signature = PNG_SIGNATURE, chunkLength = 13, chunkType = "IHDR" } = {}) {
  const buffer = Buffer.alloc(24);
  Buffer.from(signature).copy(buffer, 0);
  buffer.writeUInt32BE(chunkLength, 8);
  buffer.write(chunkType, 12, "latin1");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

test("PNG header yields IHDR dimensions", () => {
  assert.deepEqual(readPngHeader(pngHeaderBuffer()), { width: 1920, height: 1080 });
  assert.deepEqual(readPngHeader(pngHeaderBuffer({ width: 1080, height: 1920 })), { width: 1080, height: 1920 });
});

test("PNG header rejects anything that is not a real PNG frame", () => {
  assert.throws(() => readPngHeader(Buffer.alloc(24)), /signature mismatch/);
  assert.throws(() => readPngHeader(Buffer.alloc(10)), /header is truncated/);
  assert.throws(() => readPngHeader(pngHeaderBuffer().subarray(0, 20)), /header is truncated/);
  assert.throws(() => readPngHeader("not a buffer"), /header is truncated/);
  assert.throws(
    () => readPngHeader(pngHeaderBuffer({ signature: [0xff, ...PNG_SIGNATURE.slice(1)] })),
    /signature mismatch/
  );
  assert.throws(() => readPngHeader(pngHeaderBuffer({ chunkType: "IDAT" })), /IHDR chunk is missing/);
  assert.throws(() => readPngHeader(pngHeaderBuffer({ chunkLength: 12 })), /IHDR chunk is missing/);
  assert.throws(() => readPngHeader(pngHeaderBuffer({ width: 0 })), /empty image/);
  assert.throws(() => readPngHeader(pngHeaderBuffer({ height: 0 })), /empty image/);
});
