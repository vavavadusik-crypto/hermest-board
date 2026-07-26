import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFliteAudioArgs,
  buildNarrationCanonicalizeArgs,
  buildVideoRenderArgs,
  VOICE_POLISH_FILTER
} from "../../src/media/ffmpeg-args.js";

test("flite args keep narration text out of argv and use generated safe paths", () => {
  const args = buildFliteAudioArgs({
    textFile: "/tmp/hermest-board-run/narration.txt",
    outputFile: "/tmp/hermest-board-run/narration.wav",
    voice: "slt"
  });

  assert.deepEqual(args.slice(0, 6), ["-hide_banner", "-loglevel", "error", "-n", "-f", "lavfi"]);
  assert.ok(args.includes("flite=textfile=/tmp/hermest-board-run/narration.txt:voice=slt"));
  assert.equal(args.at(-1), "/tmp/hermest-board-run/narration.wav");
  assert.equal(args.join(" ").includes("secret narration"), false);
});

test("narration canonicalize args resample provider audio to the 48k mono contract", () => {
  const args = buildNarrationCanonicalizeArgs({
    inputFile: "/tmp/hermest-board-run/narration.raw.wav",
    outputFile: "/tmp/hermest-board-run/narration.partial.wav"
  });

  assert.deepEqual(args, [
    "-hide_banner", "-loglevel", "error", "-n",
    "-i", "/tmp/hermest-board-run/narration.raw.wav",
    "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le",
    "/tmp/hermest-board-run/narration.partial.wav"
  ]);
  assert.throws(
    () => buildNarrationCanonicalizeArgs({
      inputFile: "/tmp/run/in.wav:evil=1",
      outputFile: "/tmp/run/out.wav"
    }),
    /safe generated path/
  );
});

test("voice polish is opt-in and keeps its filters in the order the chain depends on", () => {
  const polished = buildNarrationCanonicalizeArgs({
    inputFile: "/tmp/hermest-board-run/narration.raw.wav",
    outputFile: "/tmp/hermest-board-run/narration.partial.wav",
    polish: true
  });

  assert.deepEqual(polished, [
    "-hide_banner", "-loglevel", "error", "-n",
    "-i", "/tmp/hermest-board-run/narration.raw.wav",
    "-af", VOICE_POLISH_FILTER,
    "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le",
    "/tmp/hermest-board-run/narration.partial.wav"
  ]);

  // Порядок — не вкусовщина: деэссер обязан стоять до подъёма присутствия,
  // экситер после компрессора, лимитер перед нормализацией. Сравнивать по
  // позиции, а не split(","): аргумент firequalizer сам содержит запятые.
  const order = [
    "highpass=",
    "deesser=",
    "firequalizer=",
    "acompressor=",
    "aexciter=",
    "aecho=",
    "alimiter=",
    "loudnorm="
  ].map(name => VOICE_POLISH_FILTER.indexOf(name));
  assert.equal(order.includes(-1), false, "every filter of the accepted chain must be present");
  assert.deepEqual(order, [...order].sort((left, right) => left - right));

  // Всё, кроме явного true, оставляет прежний argv: внешний TTS отдаёт уже
  // обработанный голос, второй проход компрессора его портит.
  for (const value of [undefined, false, null, 0, "", "true", 1]) {
    const args = buildNarrationCanonicalizeArgs({
      inputFile: "/tmp/hermest-board-run/narration.raw.wav",
      outputFile: "/tmp/hermest-board-run/narration.partial.wav",
      polish: value
    });
    assert.equal(args.includes("-af"), false, `polish: ${JSON.stringify(value)} must not add a filter`);
  }
});

test("video args map a generated color stream and narration to H.264/AAC MP4", () => {
  const args = buildVideoRenderArgs({
    audioFile: "/tmp/hermest-board-run/narration.wav",
    subtitleFile: "/tmp/hermest-board-run/narration.srt",
    outputFile: "/tmp/hermest-board-run/youtube_video.mp4",
    durationSeconds: 5.5,
    sceneTitleFiles: [
      {
        path: "/tmp/hermest-board-run/scene-001.txt",
        startSeconds: 0,
        endSeconds: 2.5
      }
    ],
    recipe: {
      width: 1920,
      height: 1080,
      fps: 30,
      videoCodec: "libx264",
      audioCodec: "aac",
      pixelFormat: "yuv420p",
      audioSampleRate: 48000,
      audioChannels: 2,
      loudnessTargetLufs: -16,
      safeZones: { bottom: 80 },
      maxDurationSeconds: 21600
    }
  });

  assert.ok(args.includes("color=c=0x111827:s=1920x1080:r=30:d=5.500"));
  assert.ok(args.includes("-n"));
  assert.equal(args.includes("-y"), false);
  const filter = args[args.indexOf("-vf") + 1];
  assert.match(filter, /drawtext=textfile=\/tmp\/hermest-board-run\/scene-001\.txt/);
  assert.match(filter, /expansion=none/);
  assert.match(filter, /enable='between\(t,0\.000,2\.500\)'/);
  assert.match(filter, /subtitles=filename=\/tmp\/hermest-board-run\/narration\.srt/);
  assert.match(filter, /MarginV=80/);
  assert.ok(args.includes("libx264"));
  assert.ok(args.includes("aac"));
  assert.equal(args[args.indexOf("-af") + 1], "loudnorm=I=-16:TP=-1.5:LRA=11");
  assert.equal(args.at(-1), "/tmp/hermest-board-run/youtube_video.mp4");
});

test("ffmpeg args reject filter injection and unsupported voices", () => {
  assert.throws(
    () => buildFliteAudioArgs({
      textFile: "/tmp/run/text.txt:evil=1",
      outputFile: "/tmp/run/out.wav",
      voice: "slt"
    }),
    /safe generated path/
  );
  assert.throws(
    () => buildFliteAudioArgs({
      textFile: "/tmp/run/text.txt",
      outputFile: "/tmp/run/out.wav",
      voice: "$(touch pwned)"
    }),
    /Unsupported flite voice/
  );
});
