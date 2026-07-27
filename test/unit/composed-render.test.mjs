import assert from "node:assert/strict";
import test from "node:test";

import { buildComposedVideoRenderArgs } from "../../src/media/ffmpeg-args.js";
import { buildRenderManifest } from "../../src/media/manifest.js";

const recipe = Object.freeze({
  width: 1920,
  height: 1080,
  fps: 30,
  videoCodec: "libx264",
  audioCodec: "aac",
  pixelFormat: "yuv420p",
  audioSampleRate: 48000,
  audioChannels: 2,
  safeZones: { bottom: 96 },
  loudnessTargetLufs: -16
});

const sceneFrames = Object.freeze([
  Object.freeze({ path: "/tmp/run/scene-001.png", durationSeconds: 4.2 }),
  Object.freeze({ path: "/tmp/run/scene-002.png", durationSeconds: 5.1 })
]);

function buildArgs(overrides = {}) {
  return buildComposedVideoRenderArgs({
    sceneFrames,
    audioFile: "/tmp/run/narration.wav",
    subtitleFile: "/tmp/run/narration.srt",
    outputFile: "/tmp/run/out.partial.mp4",
    durationSeconds: 9.3,
    recipe,
    ...overrides
  });
}

test("composed render args interleave per-frame inputs and concat them", () => {
  const args = buildArgs();
  assert.deepEqual(args.slice(0, 4), ["-hide_banner", "-loglevel", "error", "-n"]);
  assert.ok(args.includes("/tmp/run/scene-001.png"));
  assert.ok(args.includes("/tmp/run/scene-002.png"));
  const filterComplex = args[args.indexOf("-filter_complex") + 1];
  assert.match(filterComplex, /concat=n=2:v=1:a=0\[vc\]/);
  assert.match(filterComplex, /subtitles=filename=\/tmp\/run\/narration\.srt/);
  assert.equal(args[args.indexOf("-map") + 1], "[vout]");
  assert.ok(args.includes("2:a:0"));
});

test("composed render args validate frames and duration", () => {
  assert.throws(() => buildArgs({ sceneFrames: [] }), RangeError);
  assert.throws(() => buildArgs({
    sceneFrames: [{ path: "/tmp/run/scene.png", durationSeconds: 0 }]
  }), RangeError);
  assert.throws(() => buildArgs({
    sceneFrames: [{ path: "../evil.png", durationSeconds: 2 }]
  }), TypeError);
  assert.throws(() => buildArgs({ durationSeconds: 0 }), RangeError);
});

function manifestWith(commands) {
  return buildRenderManifest({
    project: { cards: [] },
    storyboard: { schemaVersion: 1, scenes: [] },
    recipe: { id: "youtube-16x9-1080p", platformId: "youtube_video" },
    tools: { ffmpeg: "8.0.1", ffprobe: "8.0.1", renderer: "hermest-board-media-r1", sceneComposer: "scene-markup@1" },
    commands,
    qc: { passed: true, checks: ["composed_scene_frames"] },
    blockers: [],
    warnings: [],
    lineage: { parents: [], children: [] },
    artifacts: [{ name: "a.mp4", type: "video/mp4", bytes: 10, sha256: "a".repeat(64) }]
  });
}

const SCENE_BROWSER_ARGV = Object.freeze([
  "--headless=new",
  "--disable-gpu",
  "--disable-extensions",
  "--hide-scrollbars",
  "--force-device-scale-factor=1",
  "--user-data-dir=/tmp/run/chrome-profile",
  "--window-size=1920,1080",
  "--remote-debugging-address=127.0.0.1",
  "--remote-debugging-port=0",
  "about:blank"
]);

test("manifest accepts the locked scene-browser chrome schema and keeps composer lineage", () => {
  const manifest = manifestWith([{
    id: "scene-browser",
    tool: "chrome",
    argv: [...SCENE_BROWSER_ARGV]
  }]);
  assert.equal(manifest.tools.sceneComposer, "scene-markup@1");
  assert.equal(manifest.commands.length, 1);
  assert.ok(manifest.commands[0].argv.includes("--user-data-dir=<run>/chrome-profile"));
  assert.ok(!JSON.stringify(manifest.commands).includes("/tmp/run/"));
});

test("manifest accepts the composed ffmpeg render schema", () => {
  const manifest = manifestWith([{
    id: "render-composed",
    tool: "ffmpeg",
    argv: buildArgs()
  }]);
  assert.equal(manifest.commands[0].id, "render-composed");
});

test("manifest pins the debugging endpoint to an ephemeral loopback port", () => {
  const nonLoopback = SCENE_BROWSER_ARGV.map(
    argument => (argument === "--remote-debugging-address=127.0.0.1" ? "--remote-debugging-address=0.0.0.0" : argument)
  );
  assert.throws(() => manifestWith([{ id: "scene-browser", tool: "chrome", argv: nonLoopback }]), /schema mismatch/);
  const fixedPort = SCENE_BROWSER_ARGV.map(
    argument => (argument === "--remote-debugging-port=0" ? "--remote-debugging-port=9222" : argument)
  );
  assert.throws(() => manifestWith([{ id: "scene-browser", tool: "chrome", argv: fixedPort }]), /schema mismatch/);
});

test("manifest rejects scene-browser drift from the locked schema", () => {
  assert.throws(() => manifestWith([{
    id: "scene-browser",
    tool: "chrome",
    argv: ["--headless=new", "--disable-gpu", "--remote-debugging-port=9222"]
  }]), /schema mismatch|Unsupported/);
  assert.throws(() => manifestWith([{
    id: "scene-browser",
    tool: "ffmpeg",
    argv: ["-i", "/tmp/x.png"]
  }]), /Unsupported command evidence/);
  assert.throws(() => manifestWith([{
    id: "scene-frame",
    tool: "chrome",
    argv: [...SCENE_BROWSER_ARGV]
  }]), /Unsupported command evidence/);
  const unsafeProfile = SCENE_BROWSER_ARGV.map(
    argument => (argument.startsWith("--user-data-dir=") ? "--user-data-dir=/tmp/run/../etc" : argument)
  );
  assert.throws(() => manifestWith([{ id: "scene-browser", tool: "chrome", argv: unsafeProfile }]), /schema mismatch/);
  const extraTarget = [...SCENE_BROWSER_ARGV, "https://evil.example/page.html"];
  assert.throws(() => manifestWith([{ id: "scene-browser", tool: "chrome", argv: extraTarget }]), /schema mismatch/);
});

test("composed render args support b-roll overlay scenes", () => {
  const args = buildArgs({
    sceneFrames: [
      { path: "/tmp/run/scene-001.png", durationSeconds: 4.2 },
      { path: "/tmp/run/scene-002.png", durationSeconds: 5.1, brollPath: "/tmp/run/broll-002.mp4" }
    ]
  });
  assert.ok(args.includes("-stream_loop"));
  assert.ok(args.includes("/tmp/run/broll-002.mp4"));
  const filterComplex = args[args.indexOf("-filter_complex") + 1];
  assert.match(filterComplex, /force_original_aspect_ratio=increase/);
  assert.match(filterComplex, /\[b1\]\[f1\]overlay=0:0,format=yuv420p\[v1\]/);
  assert.ok(args.includes("3:a:0"));
  assert.throws(() => buildArgs({
    sceneFrames: [{ path: "/tmp/run/s.png", durationSeconds: 2, brollPath: "../evil.mp4" }]
  }), TypeError);
});

test("composed render args support generated background image scenes", () => {
  const args = buildArgs({
    sceneFrames: [
      { path: "/tmp/run/scene-001.png", durationSeconds: 4.2 },
      { path: "/tmp/run/scene-002.png", durationSeconds: 5.1, backgroundImagePath: "/tmp/run/bg-002.png" }
    ]
  });
  assert.ok(args.includes("/tmp/run/bg-002.png"));
  const filterComplex = args[args.indexOf("-filter_complex") + 1];
  assert.match(filterComplex, /\[1:v\]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,zoompan=z='1\.080':x='\(iw-iw\/zoom\)\*on\/152'/);
  assert.match(filterComplex, /\[b1\]\[f1\]overlay=0:0,format=yuv420p\[v1\]/);
  assert.ok(args.includes("3:a:0"));
  const manifest = manifestWith([{ id: "render-composed", tool: "ffmpeg", argv: args }]);
  assert.equal(manifest.commands[0].id, "render-composed");
  assert.throws(() => buildArgs({
    sceneFrames: [{ path: "/tmp/run/s.png", durationSeconds: 2, backgroundImagePath: "../bg.png" }]
  }), TypeError);
});

test("static background scenes get deterministic Ken Burns drift cycling by scene index", () => {
  const backgrounds = [1, 2, 3, 4].map(index => ({
    path: `/tmp/run/scene-00${index}.png`,
    durationSeconds: 4,
    backgroundImagePath: `/tmp/run/bg-00${index}.png`
  }));
  const args = buildArgs({ sceneFrames: backgrounds, durationSeconds: 16 });
  const filterComplex = args[args.indexOf("-filter_complex") + 1];
  const segments = filterComplex.split(";");

  const drifted = segments.filter(segment => segment.includes("zoompan="));
  assert.equal(drifted.length, 4);
  // 4 фиксированных пресета по индексу сцены: zoom-in, пан вправо, zoom-out, пан влево
  assert.match(drifted[0], /zoompan=z='1\+0\.080\*on\/119':x='\(iw-iw\/zoom\)\/2':y='\(ih-ih\/zoom\)\/2':d=1:s=1920x1080:fps=30/);
  assert.match(drifted[1], /zoompan=z='1\.080':x='\(iw-iw\/zoom\)\*on\/119':y='\(ih-ih\/zoom\)\/2':d=1:s=1920x1080:fps=30/);
  assert.match(drifted[2], /zoompan=z='1\.080-0\.080\*on\/119':x='\(iw-iw\/zoom\)\/2':y='\(ih-ih\/zoom\)\/2':d=1:s=1920x1080:fps=30/);
  assert.match(drifted[3], /zoompan=z='1\.080':x='\(iw-iw\/zoom\)\*\(1-on\/119\)':y='\(ih-ih\/zoom\)\/2':d=1:s=1920x1080:fps=30/);
  for (const segment of drifted) {
    assert.match(segment, /,eq=brightness=-0\.18:saturation=0\.85,setsar=1\[b\d+\]$/);
  }

  const manifest = manifestWith([{ id: "render-composed", tool: "ffmpeg", argv: args }]);
  assert.equal(manifest.commands[0].id, "render-composed");

  const repeated = buildArgs({ sceneFrames: backgrounds, durationSeconds: 16 });
  assert.deepEqual(repeated, args);
});

test("Ken Burns drift stays on backgrounds only and out of b-roll and plain frames", () => {
  const args = buildArgs({
    sceneFrames: [
      { path: "/tmp/run/scene-001.png", durationSeconds: 4.2 },
      { path: "/tmp/run/scene-002.png", durationSeconds: 5.1, brollPath: "/tmp/run/broll-002.mp4" },
      { path: "/tmp/run/scene-003.png", durationSeconds: 3, backgroundImagePath: "/tmp/run/bg-003.png" }
    ]
  });
  const filterComplex = args[args.indexOf("-filter_complex") + 1];
  const segments = filterComplex.split(";");
  assert.equal(segments.filter(segment => segment.includes("zoompan=")).length, 1);
  assert.doesNotMatch(segments.find(segment => segment.startsWith("[0:v]scale=1920:1080,")), /zoompan/);
  assert.match(filterComplex, /\[1:v\]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=30,eq=/);
  assert.match(filterComplex, /\[3:v\]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,zoompan=/);
});

test("manifest rejects tampered Ken Burns expressions", () => {
  const args = buildArgs({
    sceneFrames: [
      { path: "/tmp/run/scene-001.png", durationSeconds: 4, backgroundImagePath: "/tmp/run/bg-001.png" },
      { path: "/tmp/run/scene-002.png", durationSeconds: 4 }
    ],
    durationSeconds: 8
  });
  const filterIndex = args.indexOf("-filter_complex") + 1;
  for (const [from, to] of [
    ["zoompan=z='1+0.080*on/119'", "zoompan=z='9+0.080*on/119'"],
    ["y='(ih-ih/zoom)/2'", "y='sin(on)'"],
    ["d=1:s=1920x1080:fps=30", "d=1:s=1920x1080:fps=30,drawtext=text=x"]
  ]) {
    const tampered = [...args];
    tampered[filterIndex] = tampered[filterIndex].replace(from, to);
    assert.notEqual(tampered[filterIndex], args[filterIndex]);
    assert.throws(() => manifestWith([{
      id: "render-composed",
      tool: "ffmpeg",
      argv: tampered
    }]), /schema mismatch/);
  }
});

test("footage records keep generated-image lineage", () => {
  const manifest = manifestWith([]);
  assert.deepEqual(manifest.footage, []);
  const generated = buildRenderManifest({
    project: { cards: [] },
    storyboard: { schemaVersion: 1, scenes: [] },
    recipe: { id: "r", platformId: "p" },
    tools: {},
    commands: [],
    qc: {},
    blockers: [],
    warnings: [],
    lineage: {},
    footage: [{
      sceneIndex: 2,
      assetType: "generated-image",
      license: "fal-generated",
      sha256: "c".repeat(64),
      provenance: { source: "generated", provider: "fal", model: "fal-ai/flux/schnell", promptSha256: "d".repeat(64) }
    }],
    artifacts: [{ name: "a.mp4", type: "video/mp4", bytes: 10, sha256: "a".repeat(64) }]
  });
  assert.equal(generated.footage[0].assetType, "generated-image");
  assert.equal(generated.footage[0].model, "fal-ai/flux/schnell");
  assert.equal(generated.footage[0].promptSha256, "d".repeat(64));
  assert.equal(generated.footage[0].source, "generated");
});

test("manifest accepts the b-roll composed schema and footage provenance", () => {
  const args = buildArgs({
    sceneFrames: [
      { path: "/tmp/run/scene-001.png", durationSeconds: 4.2 },
      { path: "/tmp/run/scene-002.png", durationSeconds: 5.1, brollPath: "/tmp/run/broll-002.mp4" }
    ]
  });
  const manifest = buildRenderManifest({
    project: { cards: [] },
    storyboard: { schemaVersion: 1, scenes: [] },
    recipe: { id: "youtube-16x9-1080p", platformId: "youtube_video" },
    tools: { ffmpeg: "8.0.1", ffprobe: "8.0.1", renderer: "hermest-board-media-r1" },
    commands: [{ id: "render-composed", tool: "ffmpeg", argv: args }],
    qc: { passed: true, checks: ["broll_footage_provenance"] },
    blockers: [],
    warnings: [],
    lineage: { parents: [], children: [] },
    footage: [{
      sceneIndex: 1,
      assetType: "stock-footage",
      license: "pexels",
      sha256: "b".repeat(64),
      provenance: { source: "stock", provider: "pexels", author: "Автор", url: "https://www.pexels.com/video/101/" }
    }],
    artifacts: [{ name: "a.mp4", type: "video/mp4", bytes: 10, sha256: "a".repeat(64) }]
  });
  assert.equal(manifest.footage.length, 1);
  assert.equal(manifest.footage[0].assetType, "stock-footage");
  assert.equal(manifest.footage[0].provider, "pexels");
  assert.equal(manifest.footage[0].url, "https://www.pexels.com/video/101/");
  assert.throws(() => buildRenderManifest({
    project: { cards: [] },
    storyboard: { schemaVersion: 1, scenes: [] },
    recipe: { id: "r", platformId: "p" },
    tools: {},
    commands: [],
    qc: {},
    blockers: [],
    warnings: [],
    lineage: {},
    footage: [{ sceneIndex: 1, assetType: "stock-footage", license: "", sha256: "b".repeat(64), provenance: {} }],
    artifacts: [{ name: "a.mp4", type: "video/mp4", bytes: 10, sha256: "a".repeat(64) }]
  }), /without a license/);
});

test("composed render args mix a ducked music bed when music is provided", () => {
  const args = buildArgs({ music: { path: "/tmp/run/music.m4a", gainDb: -13 } });
  assert.ok(args.includes("/tmp/run/music.m4a"));
  const filterComplex = args[args.indexOf("-filter_complex") + 1];
  assert.match(filterComplex, /volume=-13dB,asetnsamples=n=1024:p=0\[mg\]/);
  assert.match(filterComplex, /\[mg\]\[nsc\]sidechaincompress=/);
  assert.match(filterComplex, /\[nv\]\[duck\]amix=inputs=2:duration=first:dropout_transition=0:normalize=0\[mix\]/);
  assert.match(filterComplex, /\[mix\]asetnsamples=n=1024:p=0,loudnorm=I=-16:TP=-1\.5:LRA=11\[aout\]$/);
  assert.equal(args[args.lastIndexOf("-map") + 1], "[aout]");
  assert.ok(!args.includes("-af"));
  assert.throws(() => buildArgs({ music: { path: "../evil.m4a" } }), TypeError);
  assert.throws(() => buildArgs({ music: { path: "/tmp/run/music.m4a", gainDb: 20 } }), RangeError);
});

test("manifest accepts the music composed schema and music provenance", () => {
  const args = buildArgs({ music: { path: "/tmp/run/music.m4a", gainDb: -13 } });
  const manifest = buildRenderManifest({
    project: { cards: [] },
    storyboard: { schemaVersion: 1, scenes: [] },
    recipe: { id: "youtube-16x9-1080p", platformId: "youtube_video" },
    tools: { ffmpeg: "8.0.1", ffprobe: "8.0.1", renderer: "hermest-board-media-r1" },
    commands: [{ id: "render-composed", tool: "ffmpeg", argv: args }],
    qc: { passed: true, checks: ["music_bed_ducking"] },
    blockers: [],
    warnings: [],
    lineage: { parents: [], children: [] },
    music: {
      id: "calm-ambient-pad",
      title: "Calm Ambient Pad",
      mood: "calm",
      license: "CC0",
      source: "procedural ffmpeg synthesis",
      sha256: "c".repeat(64)
    },
    artifacts: [{ name: "a.mp4", type: "video/mp4", bytes: 10, sha256: "a".repeat(64) }]
  });
  assert.equal(manifest.music.id, "calm-ambient-pad");
  assert.equal(manifest.music.license, "CC0");
  assert.throws(() => buildRenderManifest({
    project: { cards: [] },
    storyboard: { schemaVersion: 1, scenes: [] },
    recipe: { id: "r", platformId: "p" },
    tools: {},
    commands: [],
    qc: {},
    blockers: [],
    warnings: [],
    lineage: {},
    music: { id: "x", license: "", sha256: "c".repeat(64) },
    artifacts: [{ name: "a.mp4", type: "video/mp4", bytes: 10, sha256: "a".repeat(64) }]
  }), /without a license/);
});

test("manifest rejects tampered music mix graphs", () => {
  const args = buildArgs({ music: { path: "/tmp/run/music.m4a", gainDb: -13 } });
  const filterIndex = args.indexOf("-filter_complex") + 1;
  const unDucked = [...args];
  unDucked[filterIndex] = unDucked[filterIndex].replace("normalize=0", "normalize=1");
  assert.throws(() => manifestWith([{
    id: "render-composed",
    tool: "ffmpeg",
    argv: unDucked
  }]), /schema mismatch/);
  const unsafeMusic = [...args];
  unsafeMusic[unsafeMusic.indexOf("/tmp/run/music.m4a")] = "https://evil.example/music.m4a";
  assert.throws(() => manifestWith([{
    id: "render-composed",
    tool: "ffmpeg",
    argv: unsafeMusic
  }]), /schema mismatch/);
});

test("manifest rejects composed render drift", () => {
  const args = buildArgs();
  const tampered = [...args];
  tampered[tampered.indexOf("-filter_complex") + 1] += ";[vout]drawtext=text=x[v2]";
  assert.throws(() => manifestWith([{
    id: "render-composed",
    tool: "ffmpeg",
    argv: tampered
  }]), /schema mismatch/);
});

test("animated frame sequences hold, then cut by frame count with rebuilt timestamps", () => {
  const args = buildArgs({
    sceneFrames: [
      {
        path: "/tmp/run/scene-001-f0083.png",
        sequencePattern: "/tmp/run/scene-001-f%04d.png",
        sequenceFrameCount: 84,
        sequenceFps: 30,
        durationSeconds: 4.2
      },
      {
        path: "/tmp/run/scene-002-f0083.png",
        sequencePattern: "/tmp/run/scene-002-f%04d.png",
        sequenceFrameCount: 84,
        sequenceFps: 30,
        durationSeconds: 5.1,
        brollPath: "/tmp/run/broll-002.mp4"
      }
    ]
  });
  assert.ok(args.includes("/tmp/run/scene-001-f%04d.png"));
  assert.ok(args.includes("-start_number"));
  const filterComplex = args[args.indexOf("-filter_complex") + 1];
  // plain-сцена: hold последнего кадра и всё. Камера теперь рисуется в
  // браузере в исходном разрешении, а zoompan здесь только мылил мелкий текст.
  assert.match(filterComplex, /\[0:v\]fps=30,tpad=stop_mode=clone:stop_duration=1\.400,trim=end_frame=126,setpts=N\/FRAME_RATE\/TB,setsar=1,format=yuv420p\[v0\]/);
  assert.ok(!filterComplex.includes("zoompan"), "камера не должна возвращаться в ffmpeg для секвенций");
  // b-roll сцена: оверлейная секвенция с hold, фон как раньше
  assert.match(filterComplex, /\[2:v\]fps=30,tpad=stop_mode=clone:stop_duration=2\.300,trim=end_frame=153,setpts=N\/FRAME_RATE\/TB,setsar=1\[f1\]/);
  assert.match(filterComplex, /\[b1\]\[f1\]overlay=0:0,format=yuv420p\[v1\]/);

  const manifest = manifestWith([{ id: "render-composed", tool: "ffmpeg", argv: args }]);
  assert.equal(manifest.commands[0].id, "render-composed");
});

test("sequence patterns are validated and tampered holds are rejected", () => {
  assert.throws(() => buildArgs({
    sceneFrames: [{
      path: "/tmp/run/s.png",
      sequencePattern: "/tmp/run/../evil-f%04d.png",
      sequenceFrameCount: 10,
      sequenceFps: 30,
      durationSeconds: 2
    }]
  }), TypeError);

  const args = buildArgs({
    sceneFrames: [
      {
        path: "/tmp/run/scene-001-f0011.png",
        sequencePattern: "/tmp/run/scene-001-f%04d.png",
        sequenceFrameCount: 12,
        sequenceFps: 30,
        durationSeconds: 2,
        backgroundImagePath: "/tmp/run/bg-001.png"
      },
      { path: "/tmp/run/scene-002.png", durationSeconds: 2 }
    ],
    durationSeconds: 4
  });
  const filterIndex = args.indexOf("-filter_complex") + 1;
  const tampered = [...args];
  tampered[filterIndex] = tampered[filterIndex].replace("stop_mode=clone", "stop_mode=add");
  assert.notEqual(tampered[filterIndex], args[filterIndex]);
  assert.throws(() => manifestWith([{
    id: "render-composed",
    tool: "ffmpeg",
    argv: tampered
  }]), /schema mismatch/);
});
