# Declarative timeline engine (director layer)

A scene's motion is a pure function of time: `evaluateTimeline(timeline, timeMs)`
returns the exact frame at `timeMs` with no hidden state. Nothing accumulates,
so seeking backwards costs the same as seeking forwards and two runs of the same
timeline are byte-identical.

This is the **director**, not a renderer. It decides what moves and when; it does
not decide how pixels are drawn. Today two consumers read the same timeline:

- `createTimelineRenderer(root, timeline).seek(ms)` — writes inline styles onto
  DOM/SVG nodes. This is the path the headless frame capture uses.
- `compileTimelineCss(timeline)` — emits `@keyframes` so a page plays itself in a
  browser with zero JavaScript.

Both paths must agree. The measured divergence between `seek(t)` and what a
browser actually paints is **0.1769 %** against a 0.5 % bar (opacity 0.019,
translateX 0.045, translateY 0.023, rotate 0.000, scale 0.177), sampled on a
10 ms grid across three presets.

## Why the equivalence is measured per browser cascade, not per track

Two `animation:` declarations in one CSS rule are not additive — the browser
applies only the last one. Measuring per track hid a 99–110 % defect for three
iterations. The compiler therefore emits **one `animation` declaration per rule
and one animation per CSS property**, and the test models the cascade rather than
the tracks.

## Supported properties

```
opacity  translateX  translateY  scale  scaleX  scaleY
rotate   blur        clipReveal  letterSpacing      numberValue
```

`scaleX`/`scaleY` multiply `scale` per axis, so `scale` alone stays uniform and
older timelines are unaffected. They exist for squash & stretch, blinks
(`scaleY` of an eye group), and breathing — none of which uniform scale can
express.

## Camera safe zone

Camera moves are authored as directions in −1…1, and the actual offset is a
fraction (0.75) of the safe zone available at that scale: `slack(s) = (s−1)/2`
of the frame side. Where the scale is 1 the slack is 0, so the offset is 0 and a
frame edge can never be exposed — no special case needed. Verified on a 401-point
grid across five moves and three presets: worst safe-zone usage is exactly 0.75.

## Layout

```
src/animation/    engine (timeline, director, css-compiler, easing, renderer, presets)
test/unit/        58 tests
demo/             typographic demo: self-playing HTML + deterministic MP4 render
demo-cartoon/     puppet-rig experiment (character parts driven by the timeline)
```

Render outputs (`out/`, frames, MP4) are deliberately untracked — they are
reproducible from the sources.

## Running

```bash
node --test animation-engine/timeline/test/unit/timeline.test.mjs
node animation-engine/timeline/demo/build-demo.mjs     # writes demo/out/demo.html
node animation-engine/timeline/demo/render-mp4.mjs     # writes demo/out/demo.mp4
```

The render drives one headless Chrome through CDP, seeking frame by frame, then
hands the PNG sequence to FFmpeg. It is CPU-heavy by design and belongs in CI,
not on a laptop.
