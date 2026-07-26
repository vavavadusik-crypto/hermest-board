import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRenderManifest,
  hashJson
} from "../../src/media/manifest.js";

const recipe = {
  schemaVersion: 1,
  version: "1.0.0",
  id: "youtube-16x9-1080p",
  platformId: "youtube_video",
  width: 1920,
  height: 1080,
  videoCodec: "libx264",
  audioCodec: "aac",
  adaptationMode: "master",
  readinessBlockers: []
};
const artifact = {
  name: "youtube-16x9-1080p.mp4",
  type: "video/mp4",
  bytes: 1200,
  sha256: "a".repeat(64),
  probe: {
    durationSeconds: 3.2,
    video: { codec: "h264", width: 1920, height: 1080 },
    audio: { codec: "aac", sampleRate: 48000, channels: 2 }
  }
};

const validTtsCommand = {
  id: "tts",
  tool: "ffmpeg",
  argv: [
    "-hide_banner", "-loglevel", "error", "-n", "-f", "lavfi",
    "-i", "flite=textfile=/tmp/private-run/narration.txt:voice=slt",
    "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le",
    "/tmp/private-run/narration.partial.wav"
  ]
};
const validRenderCommand = {
  id: "render",
  tool: "ffmpeg",
  argv: [
    "-hide_banner", "-loglevel", "error", "-n", "-f", "lavfi",
    "-i", "color=c=0x111827:s=1920x1080:r=30:d=3.200",
    "-i", "/tmp/private-run/narration.wav",
    "-map", "0:v:0", "-map", "1:a:0",
    "-vf", "subtitles=filename=/tmp/private-run/narration.srt:force_style='FontName=DejaVu Sans,Alignment=2,MarginV=80'",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
    "-pix_fmt", "yuv420p", "-r", "30", "-c:a", "aac",
    "-b:a", "192k", "-ar", "48000", "-ac", "2",
    "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-shortest",
    "-movflags", "+faststart", "/tmp/private-run/youtube.partial.mp4"
  ]
};

function build(overrides = {}) {
  return buildRenderManifest({
    project: { schemaVersion: 1, title: "Demo", cards: [{ id: "a" }] },
    storyboard: { schemaVersion: 1, scenes: [{ id: "scene-a" }] },
    recipe,
    tools: {
      ffmpeg: "ffmpeg version 8.0.1",
      ffprobe: "ffprobe version 8.0.1",
      renderer: "hermest-board-media-r1",
      tts: {
        provider: "ffmpeg-flite",
        model: "flite",
        voice: "slt",
        language: "en",
        apiToken: "must-not-survive"
      },
      apiToken: "secret-value"
    },
    commands: [validTtsCommand, validRenderCommand],
    qc: { passed: true, checks: ["ffprobe_streams", "artifact_hashes"] },
    blockers: ["semantic_edit_not_implemented"],
    warnings: ["offline_flite_voice_is_english_only"],
    lineage: { parents: ["project:demo"], children: ["artifact:video"] },
    artifacts: [artifact],
    ...overrides
  });
}

test("hashJson is deterministic across object key order", () => {
  assert.equal(hashJson({ a: 1, b: { c: 2 } }), hashJson({ b: { c: 2 }, a: 1 }));
  assert.match(hashJson({ a: 1 }), /^[a-f0-9]{64}$/);
});

test("render manifest is deterministic and records recipe, QC, commands and lineage", () => {
  const first = build();
  const second = build();

  assert.deepEqual(first, second);
  assert.equal("createdAt" in first, false);
  assert.equal(first.schemaVersion, 1);
  assert.equal(first.recipe.id, recipe.id);
  assert.equal(first.recipe.adaptationMode, "master");
  assert.match(first.recipeSha256, /^[a-f0-9]{64}$/);
  assert.match(first.inputs.projectSha256, /^[a-f0-9]{64}$/);
  assert.match(first.inputs.storyboardSha256, /^[a-f0-9]{64}$/);
  assert.equal(first.artifacts[0].name, artifact.name);
  assert.equal("path" in first.artifacts[0], false);
  assert.equal(first.qc.passed, true);
  assert.deepEqual(first.lineage.parents, ["project:demo"]);
  assert.equal(first.commands[0].argv[7], "flite=textfile=<run>/narration.txt:voice=slt");
  assert.equal(first.commands[1].argv[9], "<run>/narration.wav");
  assert.equal(first.commands[1].argv.at(-1), "<run>/youtube.partial.mp4");
  assert.ok(first.blockers.includes("semantic_edit_not_implemented"));
});

test("render manifest allowlists tool metadata and removes secret-shaped fields", () => {
  const manifest = build();
  const serialized = JSON.stringify(manifest);

  assert.equal(manifest.tools.ffmpeg, "ffmpeg version 8.0.1");
  assert.equal(manifest.tools.tts.provider, "ffmpeg-flite");
  assert.equal(manifest.tools.tts.language, "en");
  assert.equal(manifest.tools.tts.voice, "slt");
  assert.equal("apiToken" in manifest.tools, false);
  assert.equal("apiToken" in manifest.tools.tts, false);
  assert.doesNotMatch(serialized, /secret-value|must-not-survive/);
});

test("render manifest rejects credential carriers before command schema parsing", () => {
  const sentinel = "review-sentinel-73f2";
  const authHeader = `${"Author" + "ization"}: ${"Bear" + "er"} ${sentinel}`;
  const proxyAuthHeader = `${"Proxy-Author" + "ization"}: Basic ${sentinel}`;
  const cookieHeader = `${"Cook" + "ie"}: sid=${sentinel}`;
  const counterexamples = [
    [`--header=${authHeader}`],
    [`-H${authHeader}`],
    [`-headers=${authHeader}`],
    ["-headers", `  ${authHeader}`],
    ["-headers", `X-Test: ok\r\n${authHeader}\r\n`],
    ["--header", proxyAuthHeader],
    ["--header", cookieHeader],
    [`https://${sentinel}@example.invalid/input`],
    [`HTTP://user:${sentinel}@example.invalid/input`],
    [`https://user${sentinel}%40example.invalid/input`],
    [`source=https://user:${sentinel}@example.invalid/input`],
    ["--cookie", sentinel],
    [`token=${sentinel}`],
    [`secret=${sentinel}`],
    [`password=${sentinel}`],
    [`credential=${sentinel}`],
    [`api-key=${sentinel}`],
    [`${"Set-Cook" + "ie"}: sid=${sentinel}`],
    [`${"Cook" + "ie"}:sid=${sentinel}`]
  ];
  for (const argv of counterexamples) {
    assert.throws(
      () => build({ commands: [{ id: "render", tool: "ffmpeg", argv }] }),
      /sensitive command argument/i
    );
  }
});

test("render manifest rejects unknown command evidence and unsafe argv shapes", () => {
  assert.throws(
    () => build({ commands: [{ id: "upload", tool: "curl", argv: ["https://example.invalid"] }] }),
    /unsupported command evidence/i
  );
  assert.throws(
    () => build({ commands: [{ id: "render", tool: "ffmpeg", argv: ["-i", "bad\u0000arg"] }] }),
    /unsafe command argument/i
  );
});

test("render manifest rejects unverifiable artifacts", () => {
  assert.throws(
    () => build({ artifacts: [{ name: "empty.mp4", bytes: 0, sha256: "" }] }),
    /verified bytes and sha256/
  );
});

const validPiperCommand = {
  id: "tts",
  tool: "piper",
  argv: [
    "--model", "/home/tester/.local/share/piper/voices/ru_RU-dmitri-medium.onnx",
    "--output_file", "/tmp/private-run/narration.partial.wav",
    "--noise_scale", "0",
    "--noise_w", "0",
    "--sentence_silence", "0.35"
  ]
};

const validCanonicalizeCommand = {
  id: "narration-canonicalize",
  tool: "ffmpeg",
  argv: [
    "-hide_banner", "-loglevel", "error", "-n",
    "-i", "/tmp/private-run/narration.raw.wav",
    "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le",
    "/tmp/private-run/narration.partial.wav"
  ]
};

test("render manifest accepts narration canonicalization command evidence", () => {
  const manifest = build({
    commands: [validPiperCommand, validCanonicalizeCommand, validRenderCommand]
  });
  const canonicalize = manifest.commands.find(command => command.id === "narration-canonicalize");
  assert.equal(canonicalize.tool, "ffmpeg");
  assert.equal(canonicalize.argv.at(-1), "<run>/narration.partial.wav");
});

test("render manifest rejects canonicalization argv that changes the audio contract", () => {
  assert.throws(
    () => build({
      commands: [
        validPiperCommand,
        {
          ...validCanonicalizeCommand,
          argv: validCanonicalizeCommand.argv.map(arg => (arg === "48000" ? "44100" : arg))
        },
        validRenderCommand
      ]
    }),
    TypeError
  );
  assert.throws(
    () => build({
      commands: [
        validPiperCommand,
        { ...validCanonicalizeCommand, argv: [...validCanonicalizeCommand.argv, "-y"] },
        validRenderCommand
      ]
    }),
    TypeError
  );
});

const validLoudnessCommand = {
  id: "loudness-measure",
  tool: "ffmpeg",
  argv: [
    "-hide_banner", "-nostats",
    "-i", "/tmp/private-run/youtube.partial.mp4",
    "-map", "0:a:0",
    "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json",
    "-f", "null", "-"
  ]
};

test("render manifest records measured loudness in qc and accepts the measure command", () => {
  const manifest = build({
    commands: [validTtsCommand, validRenderCommand, validLoudnessCommand],
    qc: {
      passed: true,
      checks: ["audio_loudness_measured"],
      loudness: {
        integratedLufs: -15.98,
        truePeakDbtp: -1.62,
        loudnessRangeLu: 4.1,
        thresholdLufs: -26.34,
        targetIntegratedLufs: -16,
        targetTruePeakDbtp: -1.5,
        targetLoudnessRangeLu: 11
      }
    }
  });

  assert.equal(manifest.qc.loudness.integratedLufs, -15.98);
  assert.equal(manifest.qc.loudness.targetIntegratedLufs, -16);
  assert.ok(manifest.commands.some(command => command.id === "loudness-measure"));
});

test("render manifest fails closed on a malformed loudness report", () => {
  assert.throws(
    () => build({
      qc: {
        passed: true,
        checks: [],
        loudness: { integratedLufs: "loud", truePeakDbtp: -1 }
      }
    }),
    TypeError
  );
  assert.throws(
    () => build({
      commands: [
        { ...validLoudnessCommand, argv: [...validLoudnessCommand.argv, "--extra"] }
      ]
    }),
    TypeError
  );
});

test("render manifest accepts Piper narration command evidence", () => {
  const manifest = build({ commands: [validPiperCommand, validRenderCommand] });
  const ttsCommand = manifest.commands.find(command => command.tool === "piper");
  assert.equal(ttsCommand.id, "tts");
  assert.equal(ttsCommand.argv[0], "--model");
});

test("render manifest rejects malformed Piper narration argv", () => {
  assert.throws(
    () => build({
      commands: [
        {
          id: "tts",
          tool: "piper",
          argv: ["--model", "not-a-model", "--output_file", "/tmp/private-run/n.wav", "--sentence_silence", "0.35"]
        },
        validRenderCommand
      ]
    }),
    TypeError
  );
  assert.throws(
    () => build({
      commands: [
        {
          id: "tts",
          tool: "piper",
          argv: [...validPiperCommand.argv, "--unexpected"]
        },
        validRenderCommand
      ]
    }),
    TypeError
  );
});

test("render manifest accepts an optional Piper speech rate inside the domain corridor", () => {
  const manifest = build({
    commands: [
      { ...validPiperCommand, argv: [...validPiperCommand.argv, "--length_scale", "0.880"] },
      validRenderCommand
    ]
  });
  const ttsCommand = manifest.commands.find(command => command.tool === "piper");
  assert.deepEqual(ttsCommand.argv.slice(-2), ["--length_scale", "0.880"]);
});

test("render manifest rejects a Piper speech rate outside the domain corridor", () => {
  for (const scale of ["0.500", "1.500", "нет"]) {
    assert.throws(
      () => build({
        commands: [
          { ...validPiperCommand, argv: [...validPiperCommand.argv, "--length_scale", scale] },
          validRenderCommand
        ]
      }),
      TypeError,
      scale
    );
  }
  assert.throws(
    () => build({
      commands: [
        { ...validPiperCommand, argv: [...validPiperCommand.argv, "--speed", "0.880"] },
        validRenderCommand
      ]
    }),
    TypeError
  );
});

test("render manifest includes footage with assetType", () => {
  const manifest = build({
    footage: [
      {
        sceneIndex: 1,
        assetType: "stock-footage",
        license: "pexels",
        sha256: "abc123def4567890123456789012345678901234567890123456789012345678",
        provenance: {
          source: "stock",
          provider: "pexels",
          clipId: "12345",
          author: "John Doe",
          url: "https://example.com/video"
        }
      },
      {
        sceneIndex: 2,
        assetType: "generated-image",
        license: "pollinations-generated",
        sha256: "def456abc7890123456789012345678901234567890123456789012345678901",
        provenance: {
          source: "generated",
          provider: "pollinations",
          model: "flux",
          promptSha256: "xyz7890123456789012345678901234567890123456789012345678901234567"
        }
      }
    ]
  });
  assert.ok(Array.isArray(manifest.footage), "footage is array");
  assert.equal(manifest.footage.length, 2, "two footage entries");
  assert.equal(manifest.footage[0].sceneIndex, 1, "first scene index");
  assert.equal(manifest.footage[0].assetType, "stock-footage", "first assetType is stock-footage");
  assert.equal(manifest.footage[0].license, "pexels", "first license");
  assert.equal(manifest.footage[0].provider, "pexels", "first provider");
  assert.equal(manifest.footage[1].sceneIndex, 2, "second scene index");
  assert.equal(manifest.footage[1].assetType, "generated-image", "second assetType is generated-image");
  assert.equal(manifest.footage[1].license, "pollinations-generated", "second license");
  assert.equal(manifest.footage[1].provider, "pollinations", "second provider");
});

test("render manifest rejects footage without assetType", () => {
  assert.throws(
    () => build({
      footage: [
        {
          sceneIndex: 1,
          license: "pexels",
          sha256: "abc123def4567890123456789012345678901234567890123456789012345678",
          provenance: { source: "stock", provider: "pexels" }
        }
      ]
    }),
    /assetType/i,
    "footage without assetType throws"
  );
});

test("render manifest rejects footage with invalid assetType", () => {
  assert.throws(
    () => build({
      footage: [
        {
          sceneIndex: 1,
          assetType: "unknown-type",
          license: "pexels",
          sha256: "abc123def4567890123456789012345678901234567890123456789012345678",
          provenance: { source: "stock", provider: "pexels" }
        }
      ]
    }),
    /invalid assetType/i,
    "footage with invalid assetType throws"
  );
});

test("render manifest includes per-scene assetType array", () => {
  const storyboard = {
    schemaVersion: 1,
    scenes: [
      { id: "scene-0", title: "Intro", narration: "Welcome", durationMs: 2000 },
      { id: "scene-1", title: "Main", narration: "Main content", durationMs: 3000 },
      { id: "scene-2", title: "End", narration: "Bye", durationMs: 1500 }
    ]
  };
  const manifest = build({
    storyboard,
    footage: [
      {
        sceneIndex: 0,
        assetType: "deterministic",
        license: "n/a",
        sha256: "0".repeat(64),
        provenance: { source: "deterministic", provider: "hermest-board-scene-composer" }
      },
      {
        sceneIndex: 1,
        assetType: "stock-footage",
        license: "pexels",
        sha256: "a".repeat(64),
        provenance: { source: "stock", provider: "pexels" }
      },
      {
        sceneIndex: 2,
        assetType: "generated-image",
        license: "pollinations-generated",
        sha256: "b".repeat(64),
        provenance: { source: "generated", provider: "pollinations" }
      }
    ]
  });
  assert.ok(Array.isArray(manifest.scenes), "manifest.scenes is array");
  assert.equal(manifest.scenes.length, 3, "three scene entries");
  assert.equal(manifest.scenes[0].sceneIndex, 0, "scene 0 index");
  assert.equal(manifest.scenes[0].title, "Intro", "scene 0 title");
  assert.equal(manifest.scenes[0].assetType, "deterministic", "scene 0 assetType");
  assert.equal(manifest.scenes[1].sceneIndex, 1, "scene 1 index");
  assert.equal(manifest.scenes[1].title, "Main", "scene 1 title");
  assert.equal(manifest.scenes[1].assetType, "stock-footage", "scene 1 assetType");
  assert.equal(manifest.scenes[2].sceneIndex, 2, "scene 2 index");
  assert.equal(manifest.scenes[2].title, "End", "scene 2 title");
  assert.equal(manifest.scenes[2].assetType, "generated-image", "scene 2 assetType");
});

test("render manifest fills missing scene assetType with deterministic", () => {
  const storyboard = {
    schemaVersion: 1,
    scenes: [
      { id: "scene-0", title: "Intro", narration: "Welcome", durationMs: 2000 },
      { id: "scene-1", title: "Main", narration: "Main content", durationMs: 3000 }
    ]
  };
  const manifest = build({
    storyboard,
    footage: [
      {
        sceneIndex: 1,
        assetType: "stock-footage",
        license: "pexels",
        sha256: "a".repeat(64),
        provenance: { source: "stock", provider: "pexels" }
      }
    ]
  });
  assert.equal(manifest.scenes[0].assetType, "deterministic", "scene 0 defaults to deterministic");
  assert.equal(manifest.scenes[1].assetType, "stock-footage", "scene 1 from footage");
});
