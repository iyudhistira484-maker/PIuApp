/**
 * Reading the photo's own pixels, in the browser.
 *
 * The server cannot decode PNG/JPEG by itself (no image library, and adding one
 * is not worth it), but the browser already has a decoder. So the photo is
 * reduced here — once, on attach — to a small grid of average colours, and that
 * grid travels with the request. The server then gives each generated surface
 * the colour of the region the model pointed at.
 *
 * What this is: surface colours taken from the attached photo.
 * What this is not: a UV-mapped texture. A 16×16 grid cannot carry wood grain,
 * and the scene file could never hold a photo. Saying so is the whole point of
 * the label shown in the chat next to the model.
 */
export const PALETTE_COLUMNS = 16;
export const PALETTE_ROWS = 16;

export interface PhotoPalette {
  columns: number;
  rows: number;
  /** Row-major hex colours, `columns × rows` of them. */
  colors: string[];
}

const hex = (n: number) =>
  Math.min(255, Math.max(0, Math.round(n)))
    .toString(16)
    .padStart(2, "0");

/**
 * Averages the pixels of each cell. Alpha is ignored on purpose: the photo is
 * opaque by the time it reaches here, and a transparent pixel's colour is still
 * the colour the object has.
 */
export function samplePalette(
  pixels: Uint8ClampedArray | number[],
  width: number,
  height: number,
  columns = PALETTE_COLUMNS,
  rows = PALETTE_ROWS,
): PhotoPalette {
  if (!width || !height || pixels.length < width * height * 4)
    throw new Error("Ukuran gambar tidak terbaca.");
  const colors: string[] = [];
  for (let row = 0; row < rows; row++) {
    const y0 = Math.floor((row * height) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((row + 1) * height) / rows));
    for (let column = 0; column < columns; column++) {
      const x0 = Math.floor((column * width) / columns);
      const x1 = Math.max(x0 + 1, Math.floor(((column + 1) * width) / columns));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let y = y0; y < y1 && y < height; y++)
        for (let x = x0; x < x1 && x < width; x++) {
          const at = (y * width + x) * 4;
          r += pixels[at];
          g += pixels[at + 1];
          b += pixels[at + 2];
          n++;
        }
      colors.push(n ? `#${hex(r / n)}${hex(g / n)}${hex(b / n)}` : "#ffffff");
    }
  }
  return { columns, rows, colors };
}

/** Smallest redraw kept in the photo list, in pixels on its long edge. */
export const THUMBNAIL_EDGE = 160;

export interface PhotoSamples {
  palette: PhotoPalette | null;
  /** A downscaled redraw, for listing photos without decoding them again. */
  thumbnail: string | null;
}

/**
 * One decode gives both products a photo needs: the colour grid the server
 * consumes, and a thumbnail the photo list can show. Returns nulls instead of
 * throwing — an unreadable photo is reported by the caller, not guessed at.
 */
export async function photoSamples(file: {
  name: string;
  mime: string;
  data: string;
}): Promise<PhotoSamples> {
  if (typeof document === "undefined")
    return { palette: null, thumbnail: null };
  try {
    const image = new Image();
    image.decoding = "async";
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("gambar tidak terbaca"));
    });
    image.src = `data:${file.mime};base64,${file.data}`;
    await loaded;
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (!width || !height) return { palette: null, thumbnail: null };
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return { palette: null, thumbnail: null };
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, width, height);
    const palette = samplePalette(pixels.data, width, height);

    // The thumbnail is a redraw, not the file: scaled down and flattened onto
    // white, because a JPEG cannot carry the transparency a PNG has. It is only
    // ever shown as a small preview, and the panel says so.
    const scale = Math.min(1, THUMBNAIL_EDGE / Math.max(width, height));
    const small = document.createElement("canvas");
    small.width = Math.max(1, Math.round(width * scale));
    small.height = Math.max(1, Math.round(height * scale));
    const smallContext = small.getContext("2d");
    if (!smallContext) return { palette, thumbnail: null };
    smallContext.fillStyle = "#ffffff";
    smallContext.fillRect(0, 0, small.width, small.height);
    smallContext.drawImage(image, 0, 0, small.width, small.height);
    return { palette, thumbnail: small.toDataURL("image/jpeg", 0.7) };
  } catch {
    return { palette: null, thumbnail: null };
  }
}
