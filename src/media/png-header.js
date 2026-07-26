const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IHDR_LENGTH = 13;
const IHDR_CHUNK_OFFSET = 8;
const IHDR_DIMENSIONS_OFFSET = 16;
const PNG_HEADER_BYTES = 24;

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
