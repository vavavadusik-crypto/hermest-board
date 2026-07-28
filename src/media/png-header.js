const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IHDR_LENGTH = 13;
const IHDR_CHUNK_OFFSET = 8;
const IHDR_DIMENSIONS_OFFSET = 16;
const PNG_HEADER_BYTES = 24;

// Хвост PNG: длина 0, тип IEND и его неизменная CRC. Файл, у которого этого
// хвоста нет, — обрезанный: заголовок и первые строки на месте, конца нет.
const PNG_TRAILER = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

/**
 * Кадр дописан до конца, а не только начат?
 *
 * Проверять сигнатуру недостаточно. Обрезанный скриншот начинается теми же
 * восемью байтами, что и целый, и `stat` показывает ненулевой размер — но
 * декодер ffmpeg спотыкается на нём и **молча заканчивает секвенцию**: image2
 * не считает это ошибкой всего входа, он просто перестаёт отдавать кадры.
 * Сцена выходит короче заказанной, ролик — короче раскадровки, и единственный
 * след этого — итоговое число секунд, из которого причину не выведешь.
 */
export function isCompletePng(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < PNG_SIGNATURE.length + PNG_TRAILER.length) return false;
  if (!buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return false;
  return buffer.subarray(buffer.length - PNG_TRAILER.length).equals(PNG_TRAILER);
}

// ffprobe не отдаёт `format.duration` для одиночного PNG, поэтому обложку
// нельзя проверить общим `probeMediaFile` — он на таком файле падает. Заголовок
// PNG самодостаточен: сигнатура плюс IHDR доказывают и формат, и размеры кадра.
export function readPngHeader(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < PNG_HEADER_BYTES) {
    throw new TypeError("Cover frame is not a valid PNG: header is truncated");
  }
  if (!buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new TypeError("Cover frame is not a valid PNG: signature mismatch");
  }
  if (
    buffer.readUInt32BE(IHDR_CHUNK_OFFSET) !== IHDR_LENGTH ||
    buffer.toString("latin1", IHDR_CHUNK_OFFSET + 4, IHDR_CHUNK_OFFSET + 8) !== "IHDR"
  ) {
    throw new TypeError("Cover frame is not a valid PNG: IHDR chunk is missing");
  }
  const width = buffer.readUInt32BE(IHDR_DIMENSIONS_OFFSET);
  const height = buffer.readUInt32BE(IHDR_DIMENSIONS_OFFSET + 4);
  if (width <= 0 || height <= 0) {
    throw new TypeError("Cover frame is not a valid PNG: IHDR declares an empty image");
  }
  return { width, height };
}
