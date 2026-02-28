/**
 * FFmpeg trim/concat generator.
 *
 * Converts TrimRegion[] (sections to REMOVE) into FFmpeg filter chains
 * that keep only the non-trimmed segments and concatenate them.
 *
 * Usage from auto-broll:
 *   import { generateTrimFilter, buildTrimCommand } from 'openscreen-cli/trim';
 */

import type { TrimRegion } from './types.js';

interface Segment {
  startSec: number;
  endSec: number;
}

/**
 * Compute the kept segments from trim regions (which specify what to REMOVE).
 */
export function computeKeptSegments(
  trimRegions: TrimRegion[],
  totalDurationMs: number
): Segment[] {
  if (trimRegions.length === 0) {
    return [{ startSec: 0, endSec: totalDurationMs / 1000 }];
  }

  const sorted = [...trimRegions].sort((a, b) => a.startMs - b.startMs);
  const segments: Segment[] = [];
  let cursor = 0;

  for (const trim of sorted) {
    const trimStart = trim.startMs / 1000;
    const trimEnd = trim.endMs / 1000;

    if (cursor < trimStart) {
      segments.push({ startSec: cursor, endSec: trimStart });
    }
    cursor = trimEnd;
  }

  const totalSec = totalDurationMs / 1000;
  if (cursor < totalSec) {
    segments.push({ startSec: cursor, endSec: totalSec });
  }

  return segments;
}

/**
 * Compute effective duration after trimming.
 */
export function computeEffectiveDuration(
  trimRegions: TrimRegion[],
  totalDurationMs: number
): number {
  const trimmedMs = trimRegions.reduce(
    (sum, r) => sum + (r.endMs - r.startMs),
    0
  );
  return totalDurationMs - trimmedMs;
}

/**
 * Generate FFmpeg filter_complex for trimming (removing segments and concatenating).
 *
 * Uses the trim/atrim + setpts/asetpts + concat approach.
 */
export function generateTrimFilter(
  trimRegions: TrimRegion[],
  totalDurationMs: number,
  hasAudio: boolean = true
): string {
  const segments = computeKeptSegments(trimRegions, totalDurationMs);

  if (segments.length === 0) {
    return '';
  }

  if (segments.length === 1 && segments[0].startSec === 0) {
    // Only need a simple trim from the end
    const seg = segments[0];
    const filters = [`[0:v]trim=start=${seg.startSec}:end=${seg.endSec},setpts=PTS-STARTPTS[outv]`];
    if (hasAudio) {
      filters.push(
        `[0:a]atrim=start=${seg.startSec}:end=${seg.endSec},asetpts=PTS-STARTPTS[outa]`
      );
    }
    return filters.join('; ');
  }

  const filters: string[] = [];
  const vLabels: string[] = [];
  const aLabels: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const vLabel = `[v${i}]`;
    const aLabel = `[a${i}]`;

    filters.push(
      `[0:v]trim=start=${seg.startSec.toFixed(3)}:end=${seg.endSec.toFixed(3)},setpts=PTS-STARTPTS${vLabel}`
    );
    vLabels.push(vLabel);

    if (hasAudio) {
      filters.push(
        `[0:a]atrim=start=${seg.startSec.toFixed(3)}:end=${seg.endSec.toFixed(3)},asetpts=PTS-STARTPTS${aLabel}`
      );
      aLabels.push(aLabel);
    }
  }

  // Concat all segments
  const n = segments.length;
  if (hasAudio) {
    filters.push(
      `${vLabels.join('')}${aLabels.join('')}concat=n=${n}:v=1:a=1[outv][outa]`
    );
  } else {
    filters.push(
      `${vLabels.join('')}concat=n=${n}:v=1:a=0[outv]`
    );
  }

  return filters.join('; ');
}

/**
 * Build a complete FFmpeg command for trimming.
 */
export function buildTrimCommand(
  inputPath: string,
  outputPath: string,
  trimRegions: TrimRegion[],
  totalDurationMs: number,
  hasAudio: boolean = true
): string[] {
  if (trimRegions.length === 0) {
    // No trimming needed, just copy
    return ['ffmpeg', '-y', '-i', inputPath, '-c', 'copy', outputPath];
  }

  // For a single contiguous trim at the start or end, use -ss/-to for speed
  const segments = computeKeptSegments(trimRegions, totalDurationMs);
  if (segments.length === 1) {
    const seg = segments[0];
    return [
      'ffmpeg', '-y',
      '-ss', seg.startSec.toFixed(3),
      '-to', seg.endSec.toFixed(3),
      '-i', inputPath,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
      ...(hasAudio ? ['-c:a', 'aac'] : ['-an']),
      outputPath,
    ];
  }

  // Multiple segments need filter_complex
  const filter = generateTrimFilter(trimRegions, totalDurationMs, hasAudio);
  const args = [
    'ffmpeg', '-y',
    '-i', inputPath,
    '-filter_complex', filter,
    '-map', '[outv]',
  ];

  if (hasAudio) {
    args.push('-map', '[outa]');
  }

  args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '18');
  if (hasAudio) {
    args.push('-c:a', 'aac');
  }
  args.push(outputPath);

  return args;
}
