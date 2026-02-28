/**
 * FFmpeg background/wallpaper compositing.
 *
 * Generates FFmpeg filter chains that place a video recording on top of
 * a background (solid color, gradient, blurred copy of the video, or image).
 * Supports padding and border radius.
 *
 * Usage from auto-broll:
 *   import { generateBackgroundFilter, buildBackgroundCommand } from 'openscreen-cli/background';
 *   const filter = generateBackgroundFilter({ type: 'color', color: '#1a1a2e', padding: 10 }, 1920, 1080);
 */

import type { BackgroundConfig } from './types.js';

/**
 * Generate FFmpeg filter for placing video on a solid color background with padding.
 */
function colorBackgroundFilter(
  color: string,
  videoWidth: number,
  videoHeight: number,
  padding: number,
  borderRadius: number
): string {
  const padPx = Math.round((padding / 100) * Math.min(videoWidth, videoHeight));
  const canvasW = videoWidth;
  const canvasH = videoHeight;
  const innerW = canvasW - padPx * 2;
  const innerH = canvasH - padPx * 2;

  // Hex to FFmpeg color format
  const ffColor = color.startsWith('#') ? `0x${color.slice(1)}` : color;

  const filters: string[] = [];

  // Scale video down to fit inside padding
  filters.push(`[0:v]scale=${innerW}:${innerH}:flags=lanczos[vid]`);

  // Create color background
  filters.push(
    `color=c=${ffColor}:s=${canvasW}x${canvasH}:d=1[bg]`
  );

  if (borderRadius > 0) {
    // Apply rounded corners via alpha mask
    const r = borderRadius;
    filters.push(
      `[vid]format=yuva420p,` +
      `geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':` +
      `a='if(gt(pow(min(X,W-X)-${r},2)+pow(min(Y,H-Y)-${r},2),pow(${r},2))*` +
      `lt(min(X,W-X),${r})*lt(min(Y,H-Y),${r}),0,255)'[rounded]`
    );
    filters.push(`[bg][rounded]overlay=${padPx}:${padPx}:format=auto`);
  } else {
    filters.push(`[bg][vid]overlay=${padPx}:${padPx}:format=auto`);
  }

  return filters.join('; ');
}

/**
 * Generate FFmpeg filter for blurred video background (like macOS window screenshots).
 */
function blurBackgroundFilter(
  blurRadius: number,
  videoWidth: number,
  videoHeight: number,
  padding: number,
  borderRadius: number
): string {
  const padPx = Math.round((padding / 100) * Math.min(videoWidth, videoHeight));
  const innerW = videoWidth - padPx * 2;
  const innerH = videoHeight - padPx * 2;

  const filters: string[] = [];

  // Blurred background from the video itself
  filters.push(
    `[0:v]scale=${videoWidth}:${videoHeight}:flags=lanczos,boxblur=${blurRadius}:${blurRadius}[bg]`
  );

  // Scaled-down foreground
  filters.push(`[0:v]scale=${innerW}:${innerH}:flags=lanczos[vid]`);

  if (borderRadius > 0) {
    const r = borderRadius;
    filters.push(
      `[vid]format=yuva420p,` +
      `geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':` +
      `a='if(gt(pow(min(X,W-X)-${r},2)+pow(min(Y,H-Y)-${r},2),pow(${r},2))*` +
      `lt(min(X,W-X),${r})*lt(min(Y,H-Y),${r}),0,255)'[rounded]`
    );
    filters.push(`[bg][rounded]overlay=${padPx}:${padPx}:format=auto`);
  } else {
    filters.push(`[bg][vid]overlay=${padPx}:${padPx}:format=auto`);
  }

  return filters.join('; ');
}

/**
 * Generate FFmpeg filter for image background.
 */
function imageBackgroundFilter(
  videoWidth: number,
  videoHeight: number,
  padding: number,
  borderRadius: number
): string {
  const padPx = Math.round((padding / 100) * Math.min(videoWidth, videoHeight));
  const innerW = videoWidth - padPx * 2;
  const innerH = videoHeight - padPx * 2;

  const filters: string[] = [];

  // Input [1] is the background image, [0] is the video
  filters.push(`[1:v]scale=${videoWidth}:${videoHeight}:flags=lanczos:force_original_aspect_ratio=increase,crop=${videoWidth}:${videoHeight}[bg]`);
  filters.push(`[0:v]scale=${innerW}:${innerH}:flags=lanczos[vid]`);

  if (borderRadius > 0) {
    const r = borderRadius;
    filters.push(
      `[vid]format=yuva420p,` +
      `geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':` +
      `a='if(gt(pow(min(X,W-X)-${r},2)+pow(min(Y,H-Y)-${r},2),pow(${r},2))*` +
      `lt(min(X,W-X),${r})*lt(min(Y,H-Y),${r}),0,255)'[rounded]`
    );
    filters.push(`[bg][rounded]overlay=${padPx}:${padPx}:format=auto`);
  } else {
    filters.push(`[bg][vid]overlay=${padPx}:${padPx}:format=auto`);
  }

  return filters.join('; ');
}

/**
 * Generate the complete FFmpeg filter_complex string for background compositing.
 */
export function generateBackgroundFilter(
  config: BackgroundConfig,
  videoWidth: number,
  videoHeight: number
): string {
  const padding = config.padding ?? 0;
  const borderRadius = config.borderRadius ?? 0;

  if (padding === 0 && borderRadius === 0) {
    // No background needed, pass through
    return `scale=${videoWidth}:${videoHeight}`;
  }

  switch (config.type) {
    case 'color':
      return colorBackgroundFilter(
        config.color ?? '#000000',
        videoWidth,
        videoHeight,
        padding,
        borderRadius
      );

    case 'blur':
      return blurBackgroundFilter(
        config.blurRadius ?? 20,
        videoWidth,
        videoHeight,
        padding,
        borderRadius
      );

    case 'image':
      return imageBackgroundFilter(videoWidth, videoHeight, padding, borderRadius);

    case 'gradient':
      // FFmpeg doesn't natively support CSS gradients.
      // Fall back to a dark color or generate a gradient image first.
      return colorBackgroundFilter(
        '#1a1a2e',
        videoWidth,
        videoHeight,
        padding,
        borderRadius
      );

    default:
      return `scale=${videoWidth}:${videoHeight}`;
  }
}

/**
 * Build a complete FFmpeg command for applying a background.
 */
export function buildBackgroundCommand(
  inputPath: string,
  outputPath: string,
  config: BackgroundConfig,
  videoWidth: number,
  videoHeight: number
): string[] {
  const filter = generateBackgroundFilter(config, videoWidth, videoHeight);
  const args: string[] = ['ffmpeg', '-y'];

  args.push('-i', inputPath);

  // Add background image input if needed
  if (config.type === 'image' && config.imagePath) {
    args.push('-i', config.imagePath);
  }

  args.push('-filter_complex', filter);
  args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '18');
  args.push('-c:a', 'copy');
  args.push(outputPath);

  return args;
}
