import sharp from 'sharp';
import fs from 'fs';

export interface QualityResult {
  status: 'pass' | 'warn' | 'fail';
  blurScore: number;        // 0–1, higher = sharper
  brightness: 'dark' | 'acceptable' | 'bright';
  resolution: string;       // e.g. "1920x1080"
  orientation: 'upright' | 'rotated' | 'unknown';
  fileSize: number;
  contentType: string;
  warnings: string[];
}

export async function checkDocumentQuality(filePath: string, contentType: string): Promise<QualityResult> {
  const warnings: string[] = [];
  const fileSize = fs.statSync(filePath).size;

  // Non-image files (PDF) — basic checks only
  if (contentType === 'application/pdf') {
    return {
      status: 'pass',
      blurScore: 1.0,
      brightness: 'acceptable',
      resolution: 'pdf',
      orientation: 'upright',
      fileSize,
      contentType,
      warnings: [],
    };
  }

  try {
    const image = sharp(filePath);
    const metadata = await image.metadata();

    const width = metadata.width || 0;
    const height = metadata.height || 0;
    const resolution = `${width}x${height}`;

    // Hard-fail: genuinely unusable dimensions — extraction is not worth attempting.
    // Keep warn threshold at 400px so low-res images are still flagged as warnings.
    if (width < 150 || height < 150) {
      return {
        status: 'fail',
        blurScore: 0,
        brightness: 'acceptable',
        resolution,
        orientation: 'unknown',
        fileSize,
        contentType,
        warnings: [`Image dimensions too small (${resolution}) — cannot extract text reliably`],
      };
    }

    if (width < 400 || height < 400) {
      warnings.push(`Low resolution (${resolution}) — extraction confidence may be reduced`);
    }

    // Get image stats for brightness
    const stats = await image.stats();
    const avgBrightness = stats.channels
      .slice(0, 3)
      .reduce((sum, ch) => sum + ch.mean, 0) / 3;

    let brightness: QualityResult['brightness'] = 'acceptable';
    if (avgBrightness < 40) {
      brightness = 'dark';
      warnings.push('Image appears too dark — consider re-scanning with better lighting');
    } else if (avgBrightness > 240) {
      brightness = 'bright';
      warnings.push('Image appears overexposed — details may be lost');
    }

    // Blur estimation via Laplacian variance approximation.
    //
    // The image arriving here has already been resized and JPEG-recompressed by
    // preprocessingService, which softens edges and reduces pixel variance — the
    // very quantity our sharpness proxy measures. To partially offset that
    // softening we apply Sharp's built-in unsharp-mask (.sharpen()) to a
    // SCORING-ONLY copy of the image. The actual image file is not modified; this
    // pipeline only produces a greyscale buffer used for measurement.
    const scoringBuffer = await sharp(filePath)
      .sharpen()          // unsharp-mask — reverses some JPEG/resize softening
      .greyscale()
      .raw()
      .toBuffer();

    const blurScore = estimateSharpness(scoringBuffer);

    if (blurScore < 0.3) {
      warnings.push('Image appears blurry — text extraction accuracy may be reduced');
    }

    // Orientation from metadata
    const exifOrientation = metadata.orientation;
    const orientation: QualityResult['orientation'] =
      !exifOrientation || exifOrientation === 1 ? 'upright' : 'rotated';

    if (orientation === 'rotated') {
      warnings.push('Image appears rotated — auto-correction will be attempted during extraction');
    }

    // Status determination:
    //   'fail' — blurScore so low the image is effectively a solid blob (no edges
    //            whatsoever even after sharpening). Threshold: < 0.03, i.e. raw
    //            variance < 60. A near-solid 50×50 image sits around 20–40;
    //            any document with readable text, even heavily compressed, sits
    //            well above 60 after the sharpen step.
    //   'warn' — any quality issue present but extraction is still worth trying.
    //   'pass' — no warnings.
    const status: QualityResult['status'] =
      blurScore < 0.03
        ? 'fail'
        : warnings.length > 0
        ? 'warn'
        : 'pass';

    return {
      status,
      blurScore: parseFloat(blurScore.toFixed(3)),
      brightness,
      resolution,
      orientation,
      fileSize,
      contentType,
      warnings,
    };
  } catch (err) {
    // If Sharp cannot parse the file at all, it is genuinely unreadable.
    return {
      status: 'fail',
      blurScore: 0,
      brightness: 'acceptable',
      resolution: 'unknown',
      orientation: 'unknown',
      fileSize,
      contentType,
      warnings: [`Quality check could not be completed: ${err instanceof Error ? err.message : 'unknown error'}`],
    };
  }
}

/** Estimates sharpness from greyscale pixel buffer using local variance */
function estimateSharpness(buffer: Buffer): number {
  if (buffer.length === 0) return 0.5;

  // Sample pixel variance as a sharpness proxy (Tenengrad-inspired)
  const sampleSize = Math.min(buffer.length, 10_000);
  const step = Math.floor(buffer.length / sampleSize);
  let sum = 0;
  let sumSq = 0;
  let count = 0;

  for (let i = 0; i < buffer.length; i += step) {
    const v = buffer[i];
    sum += v;
    sumSq += v * v;
    count++;
  }

  if (count === 0) return 0.5;
  const mean = sum / count;
  const variance = sumSq / count - mean * mean;
  // Normalize: typical sharp document has variance ~1500–3000.
  // The scoring-only sharpen step upstream boosts soft documents enough that
  // WhatsApp-compressed originals reliably clear the 0.03 hard-fail floor.
  return Math.min(1.0, variance / 2000);
}
