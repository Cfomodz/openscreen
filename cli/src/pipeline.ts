/**
 * Pipeline builder — chains zoom, crop, background, annotations, and trim
 * into a single FFmpeg command or a sequence of commands.
 *
 * Usage from auto-broll:
 *   import { buildPipeline } from 'openscreen-cli/pipeline';
 *   const commands = buildPipeline(config);
 *   // Execute each command with child_process.execFileSync or fluent-ffmpeg
 */

import type { ProcessingConfig } from './types.js';
import { generateZoomFilter } from './zoom.js';
import { generateCropFilter } from './crop.js';
import { generateBackgroundFilter } from './background.js';
import { generateAnnotationFilters } from './annotations.js';
import { generateTrimFilter, computeKeptSegments } from './trim.js';

export interface PipelineStep {
  description: string;
  args: string[];
}

/**
 * Build a sequence of FFmpeg commands that apply all configured effects.
 *
 * Strategy: combine as many filters as possible into a single pass.
 * Falls back to multi-pass when filter_complex conflicts arise
 * (e.g., trim needs concat which can't easily combine with other filters).
 */
export function buildPipeline(config: ProcessingConfig): PipelineStep[] {
  const steps: PipelineStep[] = [];
  const { video } = config;
  let currentInput = config.inputPath;
  let stepIndex = 0;

  const needsTrim = config.trim && config.trim.length > 0;
  const needsZoom = config.zoom && config.zoom.regions.length > 0;
  const needsCrop = config.crop && (config.crop.x !== 0 || config.crop.y !== 0 || config.crop.width !== 1 || config.crop.height !== 1);
  const needsBackground = config.background && (config.background.padding ?? 0) > 0;
  const needsAnnotations = config.annotations && config.annotations.length > 0;

  // Step 1: Trim (if needed) — must be a separate pass because of concat
  if (needsTrim) {
    const segments = computeKeptSegments(config.trim!, video.durationMs);
    const trimOutput = segments.length > 1
      ? intermediateOutput(config.outputPath, stepIndex++)
      : config.outputPath;

    if (segments.length === 1) {
      // Simple trim — use -ss/-to
      const seg = segments[0];
      const isOnlyStep = !needsZoom && !needsCrop && !needsBackground && !needsAnnotations;

      if (isOnlyStep) {
        steps.push({
          description: 'Trim video',
          args: [
            'ffmpeg', '-y',
            '-ss', seg.startSec.toFixed(3),
            '-to', seg.endSec.toFixed(3),
            '-i', currentInput,
            '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
            '-c:a', 'aac',
            config.outputPath,
          ],
        });
        return steps;
      }
    }

    if (segments.length > 1) {
      const filter = generateTrimFilter(config.trim!, video.durationMs);
      steps.push({
        description: 'Trim video (remove cut sections)',
        args: [
          'ffmpeg', '-y',
          '-i', currentInput,
          '-filter_complex', filter,
          '-map', '[outv]', '-map', '[outa]',
          '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
          '-c:a', 'aac',
          trimOutput,
        ],
      });
      currentInput = trimOutput;
    }
  }

  // Step 2: Combine zoom + crop + annotations into a single -vf pass
  const vfParts: string[] = [];

  if (needsCrop) {
    vfParts.push(generateCropFilter(config.crop!, video.width, video.height));
  }

  if (needsZoom) {
    vfParts.push(
      generateZoomFilter(config.zoom!.regions, video.width, video.height, video.fps)
    );
  }

  if (needsAnnotations) {
    const annFilter = generateAnnotationFilters(
      config.annotations!,
      config.outputWidth ?? video.width,
      config.outputHeight ?? video.height
    );
    if (annFilter) {
      vfParts.push(annFilter);
    }
  }

  // Step 3: Background needs filter_complex (multiple inputs possible)
  if (needsBackground) {
    const bgFilter = generateBackgroundFilter(
      config.background!,
      config.outputWidth ?? video.width,
      config.outputHeight ?? video.height
    );

    // If we also have vf filters, apply them first, then background in a second pass
    if (vfParts.length > 0) {
      const vfOutput = intermediateOutput(config.outputPath, stepIndex++);
      steps.push({
        description: 'Apply zoom/crop/annotations',
        args: [
          'ffmpeg', '-y',
          '-i', currentInput,
          '-vf', vfParts.join(','),
          '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
          '-c:a', 'copy',
          vfOutput,
        ],
      });
      currentInput = vfOutput;
    }

    const bgArgs = ['ffmpeg', '-y', '-i', currentInput];
    if (config.background!.type === 'image' && config.background!.imagePath) {
      bgArgs.push('-i', config.background!.imagePath);
    }
    bgArgs.push(
      '-filter_complex', bgFilter,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
      '-c:a', 'copy',
      config.outputPath
    );

    steps.push({
      description: 'Apply background/wallpaper',
      args: bgArgs,
    });
  } else if (vfParts.length > 0) {
    // No background, just apply the video filters
    steps.push({
      description: 'Apply video effects (zoom/crop/annotations)',
      args: [
        'ffmpeg', '-y',
        '-i', currentInput,
        '-vf', vfParts.join(','),
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
        '-c:a', 'copy',
        config.outputPath,
      ],
    });
  } else if (steps.length === 0) {
    // Nothing to do, just copy
    steps.push({
      description: 'Copy (no effects)',
      args: ['ffmpeg', '-y', '-i', currentInput, '-c', 'copy', config.outputPath],
    });
  }

  return steps;
}

/**
 * Generate intermediate file path for multi-pass processing.
 */
function intermediateOutput(finalPath: string, stepIndex: number): string {
  const ext = finalPath.substring(finalPath.lastIndexOf('.'));
  const base = finalPath.substring(0, finalPath.lastIndexOf('.'));
  return `${base}_step${stepIndex}${ext}`;
}

/**
 * Build a single FFmpeg command string (for shell execution).
 */
export function pipelineToShellCommands(steps: PipelineStep[]): string[] {
  return steps.map((step) => {
    return step.args
      .map((arg) => {
        // Quote arguments that contain spaces or special characters
        if (/[\s;|&'"\\]/.test(arg)) {
          return `'${arg.replace(/'/g, "'\\''")}'`;
        }
        return arg;
      })
      .join(' ');
  });
}
