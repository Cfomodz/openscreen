/**
 * FFmpeg annotation overlay generator.
 *
 * Generates FFmpeg drawtext and drawbox filters for text annotations,
 * and overlay filters for arrow/image annotations.
 *
 * Usage from auto-broll:
 *   import { generateAnnotationFilters } from 'openscreen-cli/annotations';
 *   const filters = generateAnnotationFilters(annotations, 1920, 1080);
 */

import type { AnnotationRegion, ArrowDirection } from './types.js';

/**
 * Escape text for FFmpeg drawtext filter.
 */
function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, '\\\\\\\\')
    .replace(/'/g, "'\\''")
    .replace(/:/g, '\\:')
    .replace(/%/g, '%%')
    .replace(/\n/g, '\\n');
}

/**
 * Convert hex color to FFmpeg color format.
 * FFmpeg uses format like 0xRRGGBB or color names.
 */
function toFFmpegColor(hex: string): string {
  if (hex === 'transparent') return '0x00000000';
  if (hex.startsWith('#')) {
    return `0x${hex.slice(1)}`;
  }
  return hex;
}

/**
 * Generate FFmpeg drawtext filter for a text annotation.
 */
function textAnnotationFilter(
  annotation: AnnotationRegion,
  canvasWidth: number,
  canvasHeight: number
): string {
  const x = Math.round((annotation.x / 100) * canvasWidth);
  const y = Math.round((annotation.y / 100) * canvasHeight);
  const fontSize = annotation.fontSize ?? 32;
  const fontColor = toFFmpegColor(annotation.fontColor ?? '#ffffff');
  const fontFamily = annotation.fontFamily ?? 'sans-serif';
  const text = escapeDrawtext(annotation.text ?? '');
  const startSec = annotation.startMs / 1000;
  const endSec = annotation.endMs / 1000;

  const parts = [
    `drawtext=text='${text}'`,
    `x=${x}`,
    `y=${y}`,
    `fontsize=${fontSize}`,
    `fontcolor=${fontColor}`,
    `fontfile=''`,
    `font='${fontFamily}'`,
    `enable='between(t,${startSec.toFixed(3)},${endSec.toFixed(3)})'`,
  ];

  // Background box
  if (annotation.backgroundColor && annotation.backgroundColor !== 'transparent') {
    const bgColor = toFFmpegColor(annotation.backgroundColor);
    parts.push(`box=1`);
    parts.push(`boxcolor=${bgColor}`);
    parts.push(`boxborderw=8`);
  }

  return parts.join(':');
}

/**
 * Generate FFmpeg filter for an arrow annotation.
 * Arrows are rendered using drawbox/drawline combinations.
 */
function arrowAnnotationFilter(
  annotation: AnnotationRegion,
  canvasWidth: number,
  canvasHeight: number
): string {
  const cx = Math.round((annotation.x / 100) * canvasWidth);
  const cy = Math.round((annotation.y / 100) * canvasHeight);
  const size = annotation.arrowSize ?? 60;
  const color = toFFmpegColor(annotation.arrowColor ?? '#34B27B');
  const direction = annotation.arrowDirection ?? 'right';
  const startSec = annotation.startMs / 1000;
  const endSec = annotation.endMs / 1000;
  const enable = `enable='between(t,${startSec.toFixed(3)},${endSec.toFixed(3)})'`;

  // Arrow is approximated with drawbox for the shaft + two angled lines for the head
  // FFmpeg doesn't have a native "draw arrow" filter, so we use drawbox for a thick line
  const { shaftX1, shaftY1, shaftX2, shaftY2 } = getArrowCoords(direction, cx, cy, size);
  const thickness = Math.max(3, Math.round(size / 15));

  // Use drawbox to approximate the arrow shaft
  const shaftW = Math.abs(shaftX2 - shaftX1) || thickness;
  const shaftH = Math.abs(shaftY2 - shaftY1) || thickness;
  const shaftX = Math.min(shaftX1, shaftX2);
  const shaftY = Math.min(shaftY1, shaftY2);

  return `drawbox=x=${shaftX}:y=${shaftY}:w=${shaftW}:h=${shaftH}:color=${color}:t=fill:${enable}`;
}

/**
 * Get arrow shaft coordinates based on direction.
 */
function getArrowCoords(
  direction: ArrowDirection,
  cx: number,
  cy: number,
  size: number
): { shaftX1: number; shaftY1: number; shaftX2: number; shaftY2: number } {
  const half = Math.round(size / 2);
  switch (direction) {
    case 'right':
      return { shaftX1: cx - half, shaftY1: cy, shaftX2: cx + half, shaftY2: cy };
    case 'left':
      return { shaftX1: cx + half, shaftY1: cy, shaftX2: cx - half, shaftY2: cy };
    case 'up':
      return { shaftX1: cx, shaftY1: cy + half, shaftX2: cx, shaftY2: cy - half };
    case 'down':
      return { shaftX1: cx, shaftY1: cy - half, shaftX2: cx, shaftY2: cy + half };
    case 'up-right':
      return { shaftX1: cx - half, shaftY1: cy + half, shaftX2: cx + half, shaftY2: cy - half };
    case 'up-left':
      return { shaftX1: cx + half, shaftY1: cy + half, shaftX2: cx - half, shaftY2: cy - half };
    case 'down-right':
      return { shaftX1: cx - half, shaftY1: cy - half, shaftX2: cx + half, shaftY2: cy + half };
    case 'down-left':
      return { shaftX1: cx + half, shaftY1: cy - half, shaftX2: cx - half, shaftY2: cy + half };
    default:
      return { shaftX1: cx - half, shaftY1: cy, shaftX2: cx + half, shaftY2: cy };
  }
}

/**
 * Generate FFmpeg filter string for all annotations.
 * Returns a comma-separated chain of drawtext/drawbox filters.
 */
export function generateAnnotationFilters(
  annotations: AnnotationRegion[],
  canvasWidth: number,
  canvasHeight: number
): string {
  if (annotations.length === 0) return '';

  const filters: string[] = [];

  for (const ann of annotations) {
    switch (ann.type) {
      case 'text':
        if (ann.text) {
          filters.push(textAnnotationFilter(ann, canvasWidth, canvasHeight));
        }
        break;
      case 'arrow':
        filters.push(arrowAnnotationFilter(ann, canvasWidth, canvasHeight));
        break;
    }
  }

  return filters.join(',');
}

/**
 * Build a complete FFmpeg command for adding annotations to a video.
 */
export function buildAnnotationCommand(
  inputPath: string,
  outputPath: string,
  annotations: AnnotationRegion[],
  canvasWidth: number,
  canvasHeight: number
): string[] {
  const filter = generateAnnotationFilters(annotations, canvasWidth, canvasHeight);

  if (!filter) {
    // No annotations, just copy
    return ['ffmpeg', '-y', '-i', inputPath, '-c', 'copy', outputPath];
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
