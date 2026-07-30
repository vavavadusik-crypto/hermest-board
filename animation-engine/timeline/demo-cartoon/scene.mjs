// Единый 14-секундный интент: только данные таймлайна, без проигрывающей логики.
export const WIDTH = 1920;
export const HEIGHT = 1080;
export const FPS = 30;
export const DURATION_MS = 14_000;
export const GROUND_Y = 880;
export const SETTING_CHARACTER_HEIGHT = 400;
// renderForeground({ setting: "desk" }) определяет столешницу именно так.
export const DESK_TOP_Y = Math.round(GROUND_Y - SETTING_CHARACTER_HEIGHT * 0.45);

const k = (tMs, value, easing = "linear") => ({ tMs, value, easing });
const layer = (id, tracks) => ({ id, tracks });
const tr = (property, keys) => ({ property, keys });

// Ритм печати: 0.34 s, противоположные фазы; после 5.9 s обе руки замирают.
const typingLeft = [
  k(0, -88), k(170, -81, "inOutQuad"), k(340, -88, "inOutQuad"),
  k(510, -81, "inOutQuad"), k(680, -88, "inOutQuad"), k(850, -81, "inOutQuad"),
  k(1020, -88, "inOutQuad"), k(1190, -81, "inOutQuad"), k(1360, -88, "inOutQuad"),
  k(1530, -81, "inOutQuad"), k(1700, -88, "inOutQuad"), k(1870, -81, "inOutQuad"),
  k(2040, -88, "inOutQuad"), k(2210, -81, "inOutQuad"), k(2380, -88, "inOutQuad"),
  k(2550, -81, "inOutQuad"), k(2720, -88, "inOutQuad"), k(2890, -81, "inOutQuad"),
  k(3060, -88, "inOutQuad"), k(3230, -81, "inOutQuad"), k(3400, -88, "inOutQuad"),
  k(3570, -81, "inOutQuad"), k(3740, -88, "inOutQuad"), k(3910, -81, "inOutQuad"),
  k(4080, -88, "inOutQuad"), k(4250, -81, "inOutQuad"), k(4420, -88, "inOutQuad"),
  k(4590, -81, "inOutQuad"), k(4760, -88, "inOutQuad"), k(4930, -81, "inOutQuad"),
  k(5100, -88, "inOutQuad"), k(5270, -81, "inOutQuad"), k(5440, -88, "inOutQuad"),
  k(5610, -81, "inOutQuad"), k(5780, -88, "inOutQuad"), k(5900, 0, "outQuad"), k(14_000, 0)
];
const typingRight = typingLeft.map(key => ({ ...key, value: key.tMs < 5900 ? -key.value : 0 }));

// Хвост до походки: три запаздывающие синусоидальные фазы, потом стойка трубой,
// затем быстрый хвост сидящего кота.
const tail1 = [k(0, -14), k(700, 0, "inOutQuad"), k(1400, 14, "inOutQuad"), k(2100, 0, "inOutQuad"), k(2200, 20), k(4600, 20), k(5000, -48, "outQuad"), k(5600, -36), k(5900, -26), k(7200, -26), k(8600, -22), k(8950, 22, "inOutQuad"), k(9300, -22, "inOutQuad"), k(9650, 22, "inOutQuad"), k(10_000, -22, "inOutQuad"), k(10_350, 22, "inOutQuad"), k(10_700, -22, "inOutQuad"), k(11_000, -10, "outQuad"), k(14_000, -10)];
const tail2 = [k(0, -8), k(700, -4, "inOutQuad"), k(1400, 8, "inOutQuad"), k(2100, 4, "inOutQuad"), k(2200, 14), k(4600, 14), k(5000, -28, "outQuad"), k(5600, -20), k(5900, 18), k(7200, 18), k(8600, -15), k(8950, 15, "inOutQuad"), k(9300, -15, "inOutQuad"), k(9650, 15, "inOutQuad"), k(10_000, -15, "inOutQuad"), k(10_350, 15, "inOutQuad"), k(10_700, -15, "inOutQuad"), k(11_000, 8, "outQuad"), k(14_000, 8)];
const tail3 = [k(0, -3), k(700, -6, "inOutQuad"), k(1400, 3, "inOutQuad"), k(2100, 6, "inOutQuad"), k(2200, 8), k(4600, 8), k(5000, -14, "outQuad"), k(5600, -10), k(5900, -8), k(7200, -8), k(8600, -8), k(8950, 8, "inOutQuad"), k(9300, -8, "inOutQuad"), k(9650, 8, "inOutQuad"), k(10_000, -8, "inOutQuad"), k(10_350, 8, "inOutQuad"), k(10_700, -8, "inOutQuad"), k(11_000, -4, "outQuad"), k(14_000, -4)];

// Шаг лап: перед и зад в противофазе, 0.5 s на цикл между 2.2 и 4.6 s.
const strideA = [k(0, 0), k(2200, -20), k(2450, 20, "inOutQuad"), k(2700, -20, "inOutQuad"), k(2950, 20, "inOutQuad"), k(3200, -20, "inOutQuad"), k(3450, 20, "inOutQuad"), k(3700, -20, "inOutQuad"), k(3950, 20, "inOutQuad"), k(4200, -20, "inOutQuad"), k(4450, 20, "inOutQuad"), k(4600, 0, "outQuad"), k(14_000, 0)];
const strideB = strideA.map(key => ({ ...key, value: key.tMs >= 2200 && key.tMs <= 4450 ? -key.value : key.value }));
const bob = [k(0, 0), k(2200, 0), k(2325, -3, "inOutQuad"), k(2450, 0, "inOutQuad"), k(2575, -3, "inOutQuad"), k(2700, 0, "inOutQuad"), k(2825, -3, "inOutQuad"), k(2950, 0, "inOutQuad"), k(3075, -3, "inOutQuad"), k(3200, 0, "inOutQuad"), k(3325, -3, "inOutQuad"), k(3450, 0, "inOutQuad"), k(3575, -3, "inOutQuad"), k(3700, 0, "inOutQuad"), k(3825, -3, "inOutQuad"), k(3950, 0, "inOutQuad"), k(4075, -3, "inOutQuad"), k(4200, 0, "inOutQuad"), k(4325, -3, "inOutQuad"), k(4450, 0, "inOutQuad"), k(4600, 0), k(14_000, 0)];

export const sceneIntent = Object.freeze({
  title: "Он опять сел на пробел",
  setting: "desk",
  width: WIDTH,
  height: HEIGHT,
  fps: FPS,
  durationMs: DURATION_MS,
  groundY: GROUND_Y,
  deskTopY: DESK_TOP_Y,
  beats: [
    { fromMs: 0, toMs: 1000, action: "Ваня печатает; кот сидит на полу" },
    { fromMs: 1000, toMs: 2200, action: "Ухо и взгляд кота" },
    { fromMs: 2200, toMs: 5900, action: "Шаг, присед, прыжок и посадка на стол" },
    { fromMs: 5900, toMs: 8600, action: "Ваня замечает и закрывает лицо" },
    { fromMs: 8600, toMs: 14_000, action: "Кот машет хвостом; реплика и наезд" }
  ]
});

export const sceneTimeline = Object.freeze({
  version: 1,
  durationMs: DURATION_MS,
  fps: FPS,
  width: WIDTH,
  height: HEIGHT,
  scenes: [{
    id: "night-office",
    startMs: 0,
    durationMs: DURATION_MS,
    layers: [
      layer("camera-stage", [tr("scale", [k(0, 1), k(11_000, 1), k(14_000, 1.05, "inOutQuad")])]),
      layer("vanya-root", []),
      layer("vanya-arm-left", [tr("rotate", [k(0, 32), k(5900, 32), k(5901, 0), k(7200, 0), k(8600, -142, "inOutQuad"), k(11_000, -142), k(12_500, 0, "outBack"), k(14_000, 0)])]),
      layer("vanya-fore-left", [tr("rotate", [...typingLeft.slice(0, -1), k(5900, 0), k(7200, 0), k(8600, -92, "inOutQuad"), k(11_000, -92), k(12_500, 0, "outBack"), k(14_000, 0)])]),
      layer("vanya-arm-right", [tr("rotate", [k(0, -32), k(5900, -32), k(5901, 0), k(14_000, 0)])]),
      layer("vanya-fore-right", [tr("rotate", typingRight)]),
      layer("vanya-head", [tr("rotate", [k(0, 0), k(5900, 0), k(7200, -14, "outQuad"), k(8600, -7, "inOutQuad"), k(11_000, -7), k(12_500, 0, "outBack"), k(14_000, 0)])]),
      layer("vanya-brow-left", [tr("translateY", [k(0, 0), k(5900, 0), k(7200, -4, "outQuad"), k(14_000, -4)])]),
      layer("vanya-brow-right", [tr("translateY", [k(0, 0), k(5900, 0), k(7200, -4, "outQuad"), k(14_000, -4)])]),
      layer("vanya-eyes", [tr("scaleY", [k(0, 1), k(7200, 1), k(8600, 0.14, "inOutQuad"), k(8750, 1, "outQuad"), k(14_000, 1)])]),
      layer("vanya-mouth-closed", [tr("opacity", [k(0, 1), k(9500, 1), k(9501, 0), k(9750, 0), k(9751, 1), k(10080, 1), k(10081, 0), k(10420, 0), k(10421, 1), k(10740, 1), k(10741, 0), k(11260, 0), k(11261, 1), k(11640, 1), k(11641, 0), k(12120, 0), k(12121, 1), k(12640, 1), k(12641, 0), k(13_000, 0), k(13_001, 1), k(14_000, 1)])]),
      layer("vanya-mouth-mid", [tr("opacity", [k(0, 0), k(9500, 0), k(9501, 1), k(9750, 1), k(9751, 0), k(10080, 0), k(10081, 1), k(10420, 1), k(10421, 0), k(10740, 0), k(10741, 1), k(11260, 1), k(11261, 0), k(11640, 0), k(11641, 1), k(12120, 1), k(12121, 0), k(12640, 0), k(12641, 1), k(13_000, 1), k(13_001, 0), k(14_000, 0)])]),
      layer("vanya-mouth-open", [tr("opacity", [k(0, 0), k(9500, 0), k(9750, 0), k(9751, 1), k(10080, 1), k(10081, 0), k(10420, 0), k(10421, 1), k(10740, 1), k(10741, 0), k(11260, 0), k(11261, 1), k(11640, 1), k(11641, 0), k(12120, 0), k(12121, 1), k(12640, 1), k(12641, 0), k(13_000, 0), k(14_000, 0)])]),
      layer("speech", [tr("opacity", [k(0, 0), k(9500, 0), k(9800, 1, "outQuad"), k(13_000, 1), k(13_300, 0, "inQuad"), k(14_000, 0)])]),
      layer("cat-root", [tr("translateX", [k(0, 0), k(2200, 0), k(4600, -320, "linear"), k(14_000, -320)]), tr("translateY", [k(0, 0), k(4600, 0), k(5000, 6, "inQuad"), k(5300, -280, "outQuad"), k(5600, -180, "inQuad"), k(5900, -180), k(14_000, -180)]), tr("scaleX", [k(0, 1), k(4600, 1), k(5000, 1.10, "inQuad"), k(5300, 0.92, "outQuad"), k(5600, 1.16, "inQuad"), k(5900, 1, "outBack"), k(14_000, 1)]), tr("scaleY", [k(0, 1), k(4600, 1), k(5000, 0.86, "inQuad"), k(5300, 1.14, "outQuad"), k(5600, 0.80, "inQuad"), k(5900, 1, "outBack"), k(14_000, 1)])]),
      layer("cat-body", [tr("translateY", bob)]),
      layer("cat-head", [tr("rotate", [k(0, 0), k(1250, 0), k(1750, 12, "inOutQuad"), k(2200, 12), k(4600, 0, "outQuad"), k(14_000, 0)])]),
      layer("cat-ear-right", [tr("rotate", [k(0, 0), k(1000, 0), k(1250, 18, "outQuad"), k(1500, 0, "inQuad"), k(14_000, 0)])]),
      layer("cat-eye-left", [tr("scaleY", [k(0, 1), k(8800, 1), k(8870, 0.07, "inQuad"), k(8940, 1, "outQuad"), k(10_000, 1), k(10_070, 0.07, "inQuad"), k(10_140, 1, "outQuad"), k(14_000, 1)])]),
      layer("cat-eye-right", [tr("scaleY", [k(0, 1), k(8800, 1), k(8870, 0.07, "inQuad"), k(8940, 1, "outQuad"), k(10_000, 1), k(10_070, 0.07, "inQuad"), k(10_140, 1, "outQuad"), k(14_000, 1)])]),
      layer("cat-tail-1", [tr("rotate", tail1)]), layer("cat-tail-2", [tr("rotate", tail2)]), layer("cat-tail-3", [tr("rotate", tail3)]),
      layer("cat-leg-fl", [tr("rotate", strideA)]), layer("cat-leg-br", [tr("rotate", strideA)]),
      layer("cat-leg-fr", [tr("rotate", strideB)]), layer("cat-leg-bl", [tr("rotate", [k(0, 0), k(2200, 20), k(2450, -20, "inOutQuad"), k(2700, 20, "inOutQuad"), k(2950, -20, "inOutQuad"), k(3200, 20, "inOutQuad"), k(3450, -20, "inOutQuad"), k(3700, 20, "inOutQuad"), k(3950, -20, "inOutQuad"), k(4200, 20, "inOutQuad"), k(4450, -20, "inOutQuad"), k(4600, 0, "outQuad"), k(6500, 56, "outQuad"), k(14_000, 56)])])
    ]
  }]
});
