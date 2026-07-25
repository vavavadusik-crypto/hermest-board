import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { getMediaToolDescriptor, runMediaTool } from "../../src/media/process-runner.js";

// Доказательство строится на sentinel-файле, а не на тексте ошибки инструмента:
// при shell:true инъекция создала бы файл, при shell:false — нет. Проверка верна
// и там, где ffmpeg/ffprobe не установлены (CI без медиа-тулчейна): там spawn
// падает с ENOENT, но shell всё равно не запускался, и sentinel не появляется.
const sandbox = await mkdtemp(path.join(os.tmpdir(), "hermest-spawn-safety-"));
after(() => rm(sandbox, { recursive: true, force: true }));

const sentinelPath = name => path.join(sandbox, `${name}.sentinel`);
const toolExists = tool => existsSync(getMediaToolDescriptor(tool).path);

async function assertNoShellExecution(tool, args, sentinel) {
  await assert.rejects(async () => runMediaTool(tool, args, { timeoutMs: 3000 }));
  assert.equal(existsSync(sentinel), false, `shell injection executed: ${sentinel} was created`);
}

describe("spawn safety — command injection guards", () => {
  it("rejects non-array args", async () => {
    await assert.rejects(
      async () => runMediaTool("ffmpeg", "-version"),
      {
        name: "TypeError",
        message: /Media tool arguments must be a string array/
      }
    );
  });

  it("rejects non-string array elements", async () => {
    await assert.rejects(
      async () => runMediaTool("ffmpeg", ["-version", 123, null]),
      {
        name: "TypeError",
        message: /Media tool arguments must be a string array/
      }
    );
  });

  it("shell injection attempt stays literal (safe array form)", async () => {
    const sentinel = sentinelPath("semicolon-flag");
    await assertNoShellExecution("ffmpeg", [`-version; touch ${sentinel}`], sentinel);
  });

  it("filename with semicolon stays literal", async () => {
    const sentinel = sentinelPath("semicolon-filename");
    await assertNoShellExecution("ffprobe", ["-v", "error", `file.txt;touch ${sentinel}`], sentinel);
  });

  it("filename with newline injection stays literal", async () => {
    const sentinel = sentinelPath("newline-filename");
    await assertNoShellExecution("ffprobe", ["-v", "error", `video.mp4\ntouch ${sentinel}`], sentinel);
  });

  it("media tool reports the injected argument as its own failure", { skip: !toolExists("ffprobe") }, async () => {
    // Дополнительная проверка там, где тулчейн есть: аргумент дошёл до ffprobe
    // целиком и был отвергнут им самим, а не разобран оболочкой.
    await assert.rejects(
      async () => runMediaTool("ffprobe", ["-v", "error", "file.txt;whoami"], { timeoutMs: 3000 }),
      error => error.message.includes("exited") || error.message.includes("No such file")
    );
  });
});
