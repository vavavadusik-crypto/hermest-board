#!/usr/bin/env python3
"""Режет лист персонажа на кадры атласа с прозрачным фоном.

Лист приходит от генератора картинок сеткой: цикл ходьбы 2×6, жесты 2×4 и так
далее. Каждая ячейка обрезается по фигуре, но **общей рамкой на весь лист**, а
не своей на каждый кадр: если обрезать покадрово, фигура прыгает между кадрами,
потому что у поднятой ноги габарит другой.

Фон снимается по яркости и насыщенности, а не сравнением с чистым белым:
генератор кладёт мягкие тени и лёгкий градиент, и точное сравнение оставляет
серую кайму по контуру.
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

# Пиксель считается фоном, если он почти белый и почти серый одновременно.
# Порог по яркости мягкий — иначе светлая кожа на бликах пробивается в дыры.
BACKGROUND_MIN_LUMINANCE = 232
BACKGROUND_MAX_CHROMA = 18
# Полупрозрачный ободок в один пиксель: без него край выглядит вырезанным ножницами.
EDGE_FEATHER_LUMINANCE = 244


def build_alpha(rgb: np.ndarray) -> np.ndarray:
    luminance = rgb.mean(axis=2)
    chroma = rgb.max(axis=2).astype(np.int16) - rgb.min(axis=2).astype(np.int16)
    background = (luminance >= BACKGROUND_MIN_LUMINANCE) & (chroma <= BACKGROUND_MAX_CHROMA)
    alpha = np.where(background, 0, 255).astype(np.uint8)
    edge = (~background) & (luminance >= EDGE_FEATHER_LUMINANCE)
    alpha[edge] = 170
    return alpha


def content_bounds(alpha: np.ndarray):
    rows = np.any(alpha > 0, axis=1)
    cols = np.any(alpha > 0, axis=0)
    if not rows.any() or not cols.any():
        return None
    top, bottom = np.where(rows)[0][[0, -1]]
    left, right = np.where(cols)[0][[0, -1]]
    return int(left), int(top), int(right) + 1, int(bottom) + 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sheet", type=Path)
    parser.add_argument("outdir", type=Path)
    parser.add_argument("--rows", type=int, required=True)
    parser.add_argument("--cols", type=int, required=True)
    parser.add_argument("--prefix", default="f")
    parser.add_argument("--skip", type=int, default=0,
                        help="сколько ячеек с конца пропустить (в последнем ряду бывает пусто)")
    parser.add_argument("--pad", type=int, default=6)
    parser.add_argument("--inset", type=int, default=0,
                        help="сузить ячейку с боков перед разбором: на плотных листах "
                             "нога соседней фигуры залезает в кадр")
    args = parser.parse_args()

    source = Image.open(args.sheet)
    # Генератор отдаёт листы уже с прозрачностью. Своё ключевание применяем
    # только к плоским листам — иначе оно съело бы готовую мягкую кромку.
    has_alpha = source.mode in ("RGBA", "LA") or "transparency" in source.info
    sheet = source.convert("RGBA" if has_alpha else "RGB")
    width, height = sheet.size
    if width % args.cols or height % args.rows:
        print(f"лист {width}x{height} не делится на сетку {args.cols}x{args.rows} нацело; "
              f"ячейки будут округлены", file=sys.stderr)
    cell_w, cell_h = width // args.cols, height // args.rows

    cells = []
    for row in range(args.rows):
        for col in range(args.cols):
            box = (col * cell_w + args.inset, row * cell_h,
                   (col + 1) * cell_w - args.inset, (row + 1) * cell_h)
            cell = np.asarray(sheet.crop(box), dtype=np.uint8)
            if has_alpha:
                rgb, alpha = cell[:, :, :3], cell[:, :, 3]
            else:
                rgb, alpha = cell, build_alpha(cell)
            cells.append((box, rgb, alpha))

    if args.skip:
        cells = cells[: len(cells) - args.skip]

    bounds = [content_bounds(alpha) for _, _, alpha in cells]
    kept = [(cell, bound) for cell, bound in zip(cells, bounds) if bound is not None]
    if not kept:
        print("на листе не нашлось ни одной фигуры — проверь пороги фона", file=sys.stderr)
        return 1

    # Общая рамка: минимальный прямоугольник, вмещающий фигуру во всех кадрах.
    left = max(0, min(b[0] for _, b in kept) - args.pad)
    top = max(0, min(b[1] for _, b in kept) - args.pad)
    usable_w = cell_w - 2 * args.inset
    right = min(usable_w, max(b[2] for _, b in kept) + args.pad)
    bottom = min(cell_h, max(b[3] for _, b in kept) + args.pad)

    args.outdir.mkdir(parents=True, exist_ok=True)
    frames = []
    for index, ((_, rgb, alpha), _) in enumerate(kept, start=1):
        rgba = np.dstack([rgb, alpha])[top:bottom, left:right]
        name = f"{args.prefix}{index:02d}.png"
        Image.fromarray(rgba, mode="RGBA").save(args.outdir / name)
        frames.append(name)

    manifest = {
        "sheet": args.sheet.name,
        "grid": {"rows": args.rows, "cols": args.cols},
        "frameWidth": right - left,
        "frameHeight": bottom - top,
        "frames": frames,
    }
    (args.outdir / f"{args.prefix}-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf8")
    print(f"{len(frames)} кадров по {right - left}x{bottom - top} → {args.outdir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
