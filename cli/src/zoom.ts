/**
 * FFmpeg zoom/pan filter generator.
 *
 * Converts ZoomRegion[] (normalized coordinates + depth levels) into
 * FFmpeg crop+scale filter expressions with smooth easing transitions.
 *
 * Usage from auto-broll:
 *   import { generateZoomFilter } from 'openscreen-cli/zoom';
 *   const filter = generateZoomFilter(regions, 1920, 1080, 30);
 *   // → "crop=w=...:h=...:x=...:y=...,scale=1920:1080"
 */

import type { ZoomRegion, ZoomDepth, ZoomFocus } from './types.js';
import { ZOOM_DEPTH_SCALES } from './types.js';

const TRANSITION_MS = 320;

function smoothStep(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

function clamp(v: number, min: number, max: number): number {
  if (Number.isNaN(v)) return (min + max) / 2;
  return Math.min(max, Math.max(min, v));
}

/**
 * Compute the strength (0-1) of a zoom region at a given time,
 * with smooth lead-in/lead-out transitions.
 */
export function computeRegionStrength(region: ZoomRegion, timeMs: number): number {
  const leadInStart = region.startMs - TRANSITION_MS;
  const leadOutEnd = region.endMs + TRANSITION_MS;

  if (timeMs < leadInStart || timeMs > leadOutEnd) return 0;

  const fadeIn = smoothStep((timeMs - leadInStart) / TRANSITION_MS);
  const fadeOut = smoothStep((leadOutEnd - timeMs) / TRANSITION_MS);
  return Math.min(fadeIn, fadeOut);
}

/**
 * Find the dominant zoom region at a given time.
 */
export function findDominantRegion(
  regions: ZoomRegion[],
  timeMs: number
): { region: ZoomRegion | null; strength: number } {
  let best: ZoomRegion | null = null;
  let bestStrength = 0;

  for (const r of regions) {
    const s = computeRegionStrength(r, timeMs);
    if (s > bestStrength) {
      bestStrength = s;
      best = r;
    }
  }

  return { region: best, strength: bestStrength };
}

/**
 * Clamp focus so the zoom window doesn't go out of frame.
 */
function clampFocus(focus: ZoomFocus, depth: ZoomDepth): ZoomFocus {
  const scale = ZOOM_DEPTH_SCALES[depth];
  const margin = 1 / (2 * scale);
  return {
    cx: clamp(focus.cx, margin, 1 - margin),
    cy: clamp(focus.cy, margin, 1 - margin),
  };
}

export interface ZoomKeyframe {
  timeMs: number;
  /** Crop width as fraction of input (1.0 = full frame) */
  cropWidth: number;
  /** Crop height as fraction of input */
  cropHeight: number;
  /** Crop center X as fraction of input */
  centerX: number;
  /** Crop center Y as fraction of input */
  centerY: number;
}

/**
 * Sample zoom keyframes at regular intervals for the given regions.
 * Returns keyframes that can be used to build FFmpeg filter expressions.
 */
export function sampleZoomKeyframes(
  regions: ZoomRegion[],
  durationMs: number,
  sampleIntervalMs: number = 33 // ~30fps
): ZoomKeyframe[] {
  const keyframes: ZoomKeyframe[] = [];

  for (let t = 0; t <= durationMs; t += sampleIntervalMs) {
    const { region, strength } = findDominantRegion(regions, t);

    let cropW = 1;
    let cropH = 1;
    let cx = 0.5;
    let cy = 0.5;

    if (region && strength > 0) {
      const scale = ZOOM_DEPTH_SCALES[region.depth];
      const clamped = clampFocus(region.focus, region.depth);

      // Interpolate between no-zoom (1.0) and full zoom (1/scale)
      const zoomFraction = 1 / (1 + (scale - 1) * strength);
      cropW = zoomFraction;
      cropH = zoomFraction;
      cx = 0.5 + (clamped.cx - 0.5) * strength;
      cy = 0.5 + (clamped.cy - 0.5) * strength;
    }

    keyframes.push({ timeMs: t, cropWidth: cropW, cropHeight: cropH, centerX: cx, centerY: cy });
  }

  return keyframes;
}

/**
 * Generate an FFmpeg crop+scale filter string for a single static zoom.
 * Useful for clips that need a fixed zoom applied.
 */
export function generateStaticZoomFilter(
  focus: ZoomFocus,
  depth: ZoomDepth,
  inputWidth: number,
  inputHeight: number
): string {
  const scale = ZOOM_DEPTH_SCALES[depth];
  const clamped = clampFocus(focus, depth);

  const cropW = Math.round(inputWidth / scale);
  const cropH = Math.round(inputHeight / scale);
  const cropX = Math.round(clamped.cx * inputWidth - cropW / 2);
  const cropY = Math.round(clamped.cy * inputHeight - cropH / 2);

  return `crop=${cropW}:${cropH}:${cropX}:${cropY},scale=${inputWidth}:${inputHeight}:flags=lanczos`;
}

/**
 * Generate an FFmpeg filter string with animated zoom using sendcmd or
 * expression-based crop filter.
 *
 * Uses FFmpeg's expression engine for smooth animated crop.
 * The crop dimensions and position are computed as time-based expressions.
 */
export function generateZoomFilter(
  regions: ZoomRegion[],
  inputWidth: number,
  inputHeight: number,
  fps: number = 30
): string {
  if (regions.length === 0) {
    return `scale=${inputWidth}:${inputHeight}`;
  }

  // For a single region, generate expression-based crop
  // For multiple regions, we build a piecewise expression
  const parts = buildCropExpressions(regions, inputWidth, inputHeight);

  return `crop=w=${parts.w}:h=${parts.h}:x=${parts.x}:y=${parts.y},scale=${inputWidth}:${inputHeight}:flags=lanczos`;
}

/**
 * Build FFmpeg crop expressions that animate between zoom regions.
 * Uses FFmpeg's `if(between(t,...),...)` for piecewise definitions.
 */
function buildCropExpressions(
  regions: ZoomRegion[],
  w: number,
  h: number
): { w: string; h: string; x: string; y: string } {
  if (regions.length === 0) {
    return { w: `${w}`, h: `${h}`, x: '0', y: '0' };
  }

  // Sort regions by start time
  const sorted = [...regions].sort((a, b) => a.startMs - b.startMs);

  // Build piecewise crop width expression
  const wExprs: string[] = [];
  const hExprs: string[] = [];
  const xExprs: string[] = [];
  const yExprs: string[] = [];

  for (const region of sorted) {
    const scale = ZOOM_DEPTH_SCALES[region.depth];
    const focus = clampFocus(region.focus, region.depth);

    const cropW = Math.round(w / scale);
    const cropH = Math.round(h / scale);
    const cropX = Math.round(focus.cx * w - cropW / 2);
    const cropY = Math.round(focus.cy * h - cropH / 2);

    // Time range with transition windows (in seconds for FFmpeg)
    const startSec = (region.startMs - TRANSITION_MS) / 1000;
    const endSec = (region.endMs + TRANSITION_MS) / 1000;
    const activeStart = region.startMs / 1000;
    const activeEnd = region.endMs / 1000;
    const transDur = TRANSITION_MS / 1000;

    // Lead-in: lerp from full to zoomed
    const leadInExpr = (full: number, zoomed: number) => {
      const range = `between(t,${startSec.toFixed(3)},${activeStart.toFixed(3)})`;
      const progress = `(t-${startSec.toFixed(3)})/${transDur.toFixed(3)}`;
      // smoothstep approximation: 3*p^2 - 2*p^3
      const ss = `(3*pow(${progress},2)-2*pow(${progress},3))`;
      return `if(${range}, ${full}+(${zoomed}-${full})*${ss}, `;
    };

    // Active: hold at zoomed value
    const activeExpr = (zoomed: number) => {
      const range = `between(t,${activeStart.toFixed(3)},${activeEnd.toFixed(3)})`;
      return `if(${range}, ${zoomed}, `;
    };

    // Lead-out: lerp from zoomed back to full
    const leadOutExpr = (full: number, zoomed: number) => {
      const range = `between(t,${activeEnd.toFixed(3)},${endSec.toFixed(3)})`;
      const progress = `(${endSec.toFixed(3)}-t)/${transDur.toFixed(3)}`;
      const ss = `(3*pow(${progress},2)-2*pow(${progress},3))`;
      return `if(${range}, ${full}+(${zoomed}-${full})*${ss}, `;
    };

    const centerX = Math.round(w / 2 - w / 2); // 0 when full
    const centerY = Math.round(h / 2 - h / 2);

    wExprs.push(leadInExpr(w, cropW) + activeExpr(cropW) + leadOutExpr(w, cropW));
    hExprs.push(leadInExpr(h, cropH) + activeExpr(cropH) + leadOutExpr(h, cropH));
    xExprs.push(leadInExpr(0, cropX) + activeExpr(cropX) + leadOutExpr(0, cropX));
    yExprs.push(leadInExpr(0, cropY) + activeExpr(cropY) + leadOutExpr(0, cropY));
  }

  // Combine all regions - last fallback is full frame
  const closeParens = (count: number) => ')'.repeat(count);
  const numExprs = sorted.length * 3; // 3 expressions per region (lead-in, active, lead-out)

  const combine = (exprs: string[], defaultVal: number) =>
    exprs.join('') + `${defaultVal}` + closeParens(numExprs);

  return {
    w: combine(wExprs, w),
    h: combine(hExprs, h),
    x: combine(xExprs, 0),
    y: combine(yExprs, 0),
  };
}

/**
 * Preset focus positions (normalized 0-1 coordinates).
 * These match common UI targets in a browser window.
 */
export const ZoomPresets = {
  /** Center of the viewport */
  center: (): ZoomFocus => ({ cx: 0.5, cy: 0.5 }),
  /** Browser search/URL bar area */
  searchBar: (): ZoomFocus => ({ cx: 0.5, cy: 0.06 }),
  /** Top-left area (tabs) */
  tabBar: (): ZoomFocus => ({ cx: 0.3, cy: 0.02 }),
  /** Main content area, upper portion */
  searchResults: (): ZoomFocus => ({ cx: 0.5, cy: 0.35 }),
  /** Knowledge panel / definition card (right side) */
  definitionCard: (): ZoomFocus => ({ cx: 0.75, cy: 0.35 }),
  /** Image grid area */
  imageGrid: (): ZoomFocus => ({ cx: 0.5, cy: 0.5 }),
  /** Arbitrary element position */
  element: (x: number, y: number): ZoomFocus => ({
    cx: clamp(x, 0, 1),
    cy: clamp(y, 0, 1),
  }),
} as const;
