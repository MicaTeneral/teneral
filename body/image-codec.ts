// One-time ingestion transform for static pictures. Bun's built-in codecs keep this independent
// of an external executable or npm package. Animated GIF/WebP and APNG are returned unchanged:
// Bun.Image decodes only the first GIF frame, and silently flattening a picture would be worse
// than retaining its bytes.

const MAX_SIDE = 1568;
const MAX_PIXELS = 64 * 1024 * 1024;

function animated(bytes: Uint8Array, format: string): boolean {
  if (format === 'gif') return true;
  const at = (offset: number, text: string): boolean => Buffer.from(bytes.subarray(offset, offset + 4)).toString('latin1') === text;
  if (format === 'png') {
    // A PNG animation has an acTL chunk before its first IDAT.
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = Buffer.from(bytes.subarray(offset, offset + 4)).readUInt32BE();
      if (at(offset + 4, 'acTL')) return true;
      if (at(offset + 4, 'IDAT') || length > bytes.length - offset - 12) return false;
      offset += length + 12;
    }
  }
  if (format === 'webp') {
    for (let offset = 12; offset + 8 <= bytes.length;) {
      if (at(offset, 'ANIM')) return true;
      const length = Buffer.from(bytes.subarray(offset + 4, offset + 8)).readUInt32LE();
      if (length > bytes.length - offset - 8) return false;
      offset += 8 + length + (length & 1);
    }
  }
  return false;
}

/** Keep a static image within the model's useful input box; otherwise preserve the source bytes. */
export async function fitImage(bytes: Uint8Array): Promise<Uint8Array> {
  try {
    const source = new Bun.Image(bytes, { maxPixels: MAX_PIXELS });
    const metadata = await source.metadata();
    if (metadata.width <= MAX_SIDE && metadata.height <= MAX_SIDE) return bytes;
    if (animated(bytes, metadata.format)) return bytes;
    // Bun's fit:'inside' did not preserve the aspect ratio in the live 1.4.4 probe. Compute the
    // inside box ourselves; rounding may differ by one pixel, but never distorts the picture.
    const scale = MAX_SIDE / Math.max(metadata.width, metadata.height);
    const width = Math.max(1, Math.floor(metadata.width * scale));
    const height = Math.max(1, Math.floor(metadata.height * scale));
    const fitted = source.resize(width, height);
    if (metadata.format === 'jpeg') fitted.jpeg({ quality: 85 });
    else if (metadata.format === 'webp') fitted.webp({ quality: 85 });
    else if (metadata.format === 'png') fitted.png({ compressionLevel: 6 });
    else return bytes;
    return await fitted.bytes();
  } catch {
    // Header-only test pictures and damaged files remain governed by the existing sniff/size
    // validation. A failed optional optimization must never discard an otherwise usable upload.
    return bytes;
  }
}
