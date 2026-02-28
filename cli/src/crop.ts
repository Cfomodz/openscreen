/**
 * FFmpeg crop filter generator.
 *
 * Converts normalized crop regions (0-1) to FFmpeg crop filter strings.
 *
 * Usage from auto-broll:
 *   import { generateCropFilter, buildCropCommand } from 'openscreen-cli/crop';
 *   const filter = generateCropFilter({ x: 0, y: 0.05, width: 1, height: 0.9 }, 1920, 1080);
 *   // → "crop=1920:972:0:54"
 */

import type { CropRegion } from './types.js';

/**
 * Generate an FFmpeg crop filter string from a normalized crop region.
 *
 * @param crop - Normalized crop region (0-1 for all values)
 * @param inputWidth - Input video width in pixels
 * @param inputHeight - Input video height in pixels
 * @returns FFmpeg crop filter string, e.g. "crop=1920:972:0:54"
 */
export function generateCropFilter(
  crop: CropRegion,
  inputWidth: number,
  inputHeight: number
): string {
  // Convert normalized to pixel values
  const x = Math.round(crop.x * inputWidth);
  const y = Math.round(crop.y * inputHeight);
  const w = Math.round(crop.width * inputWidth);
  const h = Math.round(crop.height * inputHeight);

  // Ensure even dimensions (required by many codecs)
  const evenW = w % 2 === 0 ? w : w - 1;
  const evenH = h % 2 === 0 ? h : h - 1;

  return `crop=${evenW}:${evenH}:${x}:${y}`;
}

/**
 * Generate crop filter that also scales back to a target resolution.
 */
export function generateCropAndScaleFilter(
  crop: CropRegion,
  inputWidth: number,
  inputHeight: number,
  outputWidth: number,
  outputHeight: number
): string {
  const cropFilter = generateCropFilter(crop, inputWidth, inputHeight);
  return `${cropFilter},scale=${outputWidth}:${outputHeight}:flags=lanczos`;
}

/**
 * Common crop presets for browser recordings.
 */
export const CropPresets = {
  /** Remove browser chrome (top ~5%) */
  noBrowserChrome: (): CropRegion => ({
    x: 0,
    y: 0.05,
    width: 1,
    height: 0.95,
  }),

  /** Remove browser chrome and OS taskbar */
  contentOnly: (): CropRegion => ({
    x: 0,
    y: 0.05,
    width: 1,
    height: 0.9,
  }),

  /** Center crop to 4:3 from 16:9 */
  centerCrop4x3: (): CropRegion => ({
    x: 0.125,
    y: 0,
    width: 0.75,
    height: 1,
  }),

  /** Full frame (no crop) */
  full: (): CropRegion => ({
    x: 0,
    y: 0,
    width: 1,
    height: 1,
  }),
} as const;

/**
 * Build a complete FFmpeg command for cropping.
 */
export function buildCropCommand(
  inputPath: string,
  outputPath: string,
  crop: CropRegion,
  inputWidth: number,
  inputHeight: number,
  scaleToOriginal: boolean = false
): string[] {
  let filter: string;

  if (scaleToOriginal) {
    filter = generateCropAndScaleFilter(crop, inputWidth, inputHeight, inputWidth, inputHeight);
  } else {
    filter = generateCropFilter(crop, inputWidth, inputHeight);
  }

  return [
    'ffmpeg', '-y',
    '-i', inputPath,
    '-vf', filter,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
    '-c:a', 'copy',
    outputPath,
  ];
}
