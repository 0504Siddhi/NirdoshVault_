/**
 * qualityService.test.ts
 *
 * Tests the revised quality-gate thresholds by generating synthetic images
 * with Sharp and asserting the expected status from checkDocumentQuality.
 *
 * Three cases:
 *   (a) Normal sharp synthetic image        → 'pass' or 'warn', NEVER 'fail'
 *   (b) Blurry double-compressed image      → 'warn', NEVER 'fail'
 *       (simulates WhatsApp-style degradation)
 *   (c) Near-solid 50×50 tiny image         → 'fail'
 *       (genuinely unusable — proves the tightened threshold still catches it)
 */

import assert from 'assert';
import path from 'path';
import fs from 'fs';
import os from 'os';
import sharp from 'sharp';
import { checkDocumentQuality } from './qualityService';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'quality-test-'));

function tmpPath(name: string): string {
  return path.join(TMP, name);
}

async function cleanup(): Promise<void> {
  for (const file of fs.readdirSync(TMP)) {
    try { fs.unlinkSync(path.join(TMP, file)); } catch { /* ignore */ }
  }
  try { fs.rmdirSync(TMP); } catch { /* ignore */ }
}

/**
 * Build a 600×800 checkerboard pattern (clear edges, high contrast).
 * Each tile is 20×20 px alternating black/white — gives variance ~16000.
 */
async function makeSharpImage(outPath: string): Promise<void> {
  const width = 600;
  const height = 800;
  const tileSize = 20;
  const pixels = Buffer.alloc(width * height * 3);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tileX = Math.floor(x / tileSize) % 2;
      const tileY = Math.floor(y / tileSize) % 2;
      const isWhite = (tileX + tileY) % 2 === 0;
      const val = isWhite ? 255 : 0;
      const idx = (y * width + x) * 3;
      pixels[idx] = val;
      pixels[idx + 1] = val;
      pixels[idx + 2] = val;
    }
  }

  await sharp(pixels, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 85 })
    .toFile(outPath);
}

/**
 * Build a blurry, double-compressed version of the same pattern:
 *   1. Apply a strong gaussian blur (sigma 8) to kill edges.
 *   2. Encode at JPEG quality 15 (heavy quantization, WhatsApp-tier).
 *   3. Re-decode and re-encode at quality 20 (the "second compression").
 * This mimics the pipeline: original → WhatsApp → user saves → app preprocesses.
 */
async function makeBlurryDoubleCompressedImage(outPath: string): Promise<void> {
  const width = 600;
  const height = 800;
  const tileSize = 20;
  const pixels = Buffer.alloc(width * height * 3);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tileX = Math.floor(x / tileSize) % 2;
      const tileY = Math.floor(y / tileSize) % 2;
      const isWhite = (tileX + tileY) % 2 === 0;
      const val = isWhite ? 255 : 0;
      const idx = (y * width + x) * 3;
      pixels[idx] = val;
      pixels[idx + 1] = val;
      pixels[idx + 2] = val;
    }
  }

  // First pass: blur + low-quality JPEG
  const pass1 = await sharp(pixels, { raw: { width, height, channels: 3 } })
    .blur(8)
    .jpeg({ quality: 15 })
    .toBuffer();

  // Second pass: re-encode (double compression)
  await sharp(pass1)
    .jpeg({ quality: 20 })
    .toFile(outPath);
}

/**
 * Build a near-solid 50×50 image with tiny pixel noise.
 * Almost no variance — represents a completely unreadable input.
 */
async function makeTinyNearSolidImage(outPath: string): Promise<void> {
  const width = 50;
  const height = 50;
  const pixels = Buffer.alloc(width * height * 3);

  for (let i = 0; i < pixels.length; i++) {
    // Mostly white with ±2 noise — variance will be ~1–2
    pixels[i] = 250 + Math.floor(Math.random() * 5);
  }

  await sharp(pixels, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 90 })
    .toFile(outPath);
}

async function runQualityTests(): Promise<void> {
  console.log('--- Running Quality Service Threshold Tests ---');

  const sharpPath   = tmpPath('sharp_synthetic.jpg');
  const blurryPath  = tmpPath('blurry_double_compressed.jpg');
  const tinyPath    = tmpPath('tiny_solid.jpg');

  // ── Generate test images ──────────────────────────────────────────────────
  await makeSharpImage(sharpPath);
  await makeBlurryDoubleCompressedImage(blurryPath);
  await makeTinyNearSolidImage(tinyPath);

  // ── (a) Sharp synthetic ───────────────────────────────────────────────────
  // A normal document photo should never be hard-rejected before extraction.
  const resultSharp = await checkDocumentQuality(sharpPath, 'image/jpeg');
  console.log(`  (a) sharp synthetic  → status: ${resultSharp.status}, blurScore: ${resultSharp.blurScore}`);
  assert.ok(
    resultSharp.status === 'pass' || resultSharp.status === 'warn',
    `Expected 'pass' or 'warn' for sharp synthetic image, got '${resultSharp.status}' (blurScore: ${resultSharp.blurScore})`
  );

  // ── (b) Blurry double-compressed ─────────────────────────────────────────
  // A WhatsApp-compressed photo is degraded but not unusable — the extraction
  // engine should still get a chance. The key invariant is NOT 'fail'.
  // Whether it comes back 'pass' or 'warn' depends on just how much variance
  // survives after the sharpen-corrected scoring; either is acceptable here.
  // We also confirm the blurry image scored strictly *lower* than the sharp
  // one, proving the metric actually differentiates image quality.
  const resultBlurry = await checkDocumentQuality(blurryPath, 'image/jpeg');
  console.log(`  (b) blurry/double-compressed → status: ${resultBlurry.status}, blurScore: ${resultBlurry.blurScore}`);
  assert.ok(
    resultBlurry.status === 'pass' || resultBlurry.status === 'warn',
    `Expected 'pass' or 'warn' for blurry double-compressed image, got '${resultBlurry.status}' (blurScore: ${resultBlurry.blurScore}). ` +
    'A degraded-but-legible document must never be hard-rejected before extraction attempts.'
  );
  assert.ok(
    resultBlurry.blurScore < resultSharp.blurScore,
    `Expected blurry image (${resultBlurry.blurScore}) to score lower than sharp image (${resultSharp.blurScore}) — sharpness metric is not differentiating quality.`
  );

  // ── (c) Near-solid tiny image ─────────────────────────────────────────────
  // 50×50 near-blank — well below the 150px dimension hard-fail floor.
  // This MUST come back as 'fail' to prove the guard still catches junk.
  const resultTiny = await checkDocumentQuality(tinyPath, 'image/jpeg');
  console.log(`  (c) tiny near-solid  → status: ${resultTiny.status}, blurScore: ${resultTiny.blurScore}`);
  assert.strictEqual(
    resultTiny.status,
    'fail',
    `Expected 'fail' for 50×50 near-solid image, got '${resultTiny.status}' (blurScore: ${resultTiny.blurScore}). ` +
    'The hard-fail guard appears to be missing or misconfigured.'
  );

  console.log('✅ Quality service threshold tests passed.');
}

runQualityTests()
  .catch((err) => {
    console.error('❌ Quality service test failed:', err);
    process.exit(1);
  })
  .finally(cleanup);
