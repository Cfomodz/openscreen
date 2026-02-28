#!/usr/bin/env node

/**
 * OpenScreen CLI — bare-bones video post-processing tools.
 *
 * Generates FFmpeg commands for zoom/pan, background, annotations, crop, and trim.
 * Designed to be called from the auto-broll pipeline or used standalone.
 */

import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { generateZoomFilter, generateStaticZoomFilter, ZoomPresets } from './zoom.js';
import { generateBackgroundFilter, buildBackgroundCommand } from './background.js';
import { generateAnnotationFilters, buildAnnotationCommand } from './annotations.js';
import { generateCropFilter, buildCropCommand, CropPresets } from './crop.js';
import { buildTrimCommand, computeEffectiveDuration } from './trim.js';
import { buildPipeline, pipelineToShellCommands } from './pipeline.js';
import type {
  ZoomRegion,
  CropRegion,
  TrimRegion,
  AnnotationRegion,
  BackgroundConfig,
  ProcessingConfig,
  ZoomDepth,
} from './types.js';
import { ZOOM_DEPTH_SCALES } from './types.js';

const program = new Command();

program
  .name('openscreen')
  .description('Bare-bones CLI tools for video post-processing. Generates FFmpeg filter strings and commands.')
  .version('1.0.0');

// ─── zoom ──────────────────────────────────────────────────────────────────

const zoomCmd = program
  .command('zoom')
  .description('Generate FFmpeg zoom/pan filter');

zoomCmd
  .command('filter')
  .description('Generate FFmpeg filter string for animated zoom regions')
  .requiredOption('-r, --regions <json>', 'JSON array of ZoomRegion objects or path to JSON file')
  .requiredOption('-w, --width <number>', 'Input video width', parseInt)
  .requiredOption('-h, --height <number>', 'Input video height', parseInt)
  .option('--fps <number>', 'Video FPS', parseInt, 30)
  .action((opts) => {
    const regions = parseJsonArg<ZoomRegion[]>(opts.regions);
    const filter = generateZoomFilter(regions, opts.width, opts.height, opts.fps);
    console.log(filter);
  });

zoomCmd
  .command('static')
  .description('Generate FFmpeg filter for a static (fixed) zoom')
  .requiredOption('--cx <number>', 'Focus X (0-1)', parseFloat)
  .requiredOption('--cy <number>', 'Focus Y (0-1)', parseFloat)
  .requiredOption('-d, --depth <number>', 'Zoom depth (1-6)', parseInt)
  .requiredOption('-w, --width <number>', 'Input video width', parseInt)
  .requiredOption('-h, --height <number>', 'Input video height', parseInt)
  .action((opts) => {
    const filter = generateStaticZoomFilter(
      { cx: opts.cx, cy: opts.cy },
      opts.depth as ZoomDepth,
      opts.width,
      opts.height
    );
    console.log(filter);
  });

zoomCmd
  .command('presets')
  .description('List available zoom focus presets')
  .action(() => {
    console.log('Available zoom presets:');
    console.log(`  center       ${JSON.stringify(ZoomPresets.center())}`);
    console.log(`  searchBar    ${JSON.stringify(ZoomPresets.searchBar())}`);
    console.log(`  tabBar       ${JSON.stringify(ZoomPresets.tabBar())}`);
    console.log(`  searchResults ${JSON.stringify(ZoomPresets.searchResults())}`);
    console.log(`  definitionCard ${JSON.stringify(ZoomPresets.definitionCard())}`);
    console.log(`  imageGrid    ${JSON.stringify(ZoomPresets.imageGrid())}`);
    console.log();
    console.log('Zoom depth scales:');
    for (const [depth, scale] of Object.entries(ZOOM_DEPTH_SCALES)) {
      console.log(`  depth ${depth}: ${scale}x magnification`);
    }
  });

// ─── background ────────────────────────────────────────────────────────────

program
  .command('background')
  .description('Generate FFmpeg filter or command for background/wallpaper compositing')
  .requiredOption('-i, --input <path>', 'Input video path')
  .requiredOption('-o, --output <path>', 'Output video path')
  .requiredOption('-w, --width <number>', 'Video width', parseInt)
  .requiredOption('-h, --height <number>', 'Video height', parseInt)
  .option('-t, --type <type>', 'Background type: color|blur|image', 'color')
  .option('-c, --color <hex>', 'Background color (hex)', '#1a1a2e')
  .option('--blur-radius <number>', 'Blur radius for blur type', parseInt, 20)
  .option('--image <path>', 'Background image path')
  .option('-p, --padding <number>', 'Padding percentage (0-100)', parseInt, 10)
  .option('--border-radius <number>', 'Border radius in pixels', parseInt, 0)
  .option('--filter-only', 'Only print the filter string, do not run ffmpeg')
  .option('--dry-run', 'Print the ffmpeg command without executing')
  .action((opts) => {
    const config: BackgroundConfig = {
      type: opts.type,
      color: opts.color,
      blurRadius: opts.blurRadius,
      imagePath: opts.image,
      padding: opts.padding,
      borderRadius: opts.borderRadius,
    };

    if (opts.filterOnly) {
      console.log(generateBackgroundFilter(config, opts.width, opts.height));
      return;
    }

    const cmd = buildBackgroundCommand(opts.input, opts.output, config, opts.width, opts.height);

    if (opts.dryRun) {
      console.log(cmd.join(' '));
      return;
    }

    runFfmpeg(cmd);
  });

// ─── crop ──────────────────────────────────────────────────────────────────

const cropCmd = program
  .command('crop')
  .description('Crop video using normalized coordinates');

cropCmd
  .command('apply')
  .description('Apply crop to a video')
  .requiredOption('-i, --input <path>', 'Input video path')
  .requiredOption('-o, --output <path>', 'Output video path')
  .requiredOption('-w, --width <number>', 'Input video width', parseInt)
  .requiredOption('-h, --height <number>', 'Input video height', parseInt)
  .option('--x <number>', 'Crop X offset (0-1)', parseFloat, 0)
  .option('--y <number>', 'Crop Y offset (0-1)', parseFloat, 0)
  .option('--cw <number>', 'Crop width (0-1)', parseFloat, 1)
  .option('--ch <number>', 'Crop height (0-1)', parseFloat, 1)
  .option('--scale', 'Scale back to original resolution after crop')
  .option('--filter-only', 'Only print the filter string')
  .option('--dry-run', 'Print the ffmpeg command without executing')
  .action((opts) => {
    const crop: CropRegion = { x: opts.x, y: opts.y, width: opts.cw, height: opts.ch };

    if (opts.filterOnly) {
      console.log(generateCropFilter(crop, opts.width, opts.height));
      return;
    }

    const cmd = buildCropCommand(opts.input, opts.output, crop, opts.width, opts.height, opts.scale);

    if (opts.dryRun) {
      console.log(cmd.join(' '));
      return;
    }

    runFfmpeg(cmd);
  });

cropCmd
  .command('presets')
  .description('List available crop presets')
  .action(() => {
    console.log('Available crop presets:');
    console.log(`  noBrowserChrome: ${JSON.stringify(CropPresets.noBrowserChrome())}`);
    console.log(`  contentOnly:     ${JSON.stringify(CropPresets.contentOnly())}`);
    console.log(`  centerCrop4x3:   ${JSON.stringify(CropPresets.centerCrop4x3())}`);
    console.log(`  full:            ${JSON.stringify(CropPresets.full())}`);
  });

// ─── trim ──────────────────────────────────────────────────────────────────

program
  .command('trim')
  .description('Trim video by removing specified time ranges')
  .requiredOption('-i, --input <path>', 'Input video path')
  .requiredOption('-o, --output <path>', 'Output video path')
  .requiredOption('--duration <number>', 'Total video duration in ms', parseInt)
  .requiredOption('--regions <json>', 'JSON array of TrimRegion objects (sections to REMOVE)')
  .option('--no-audio', 'Strip audio')
  .option('--dry-run', 'Print the ffmpeg command without executing')
  .action((opts) => {
    const regions = parseJsonArg<TrimRegion[]>(opts.regions);

    console.error(
      `Effective duration: ${(computeEffectiveDuration(regions, opts.duration) / 1000).toFixed(2)}s`
    );

    const cmd = buildTrimCommand(opts.input, opts.output, regions, opts.duration, opts.audio);

    if (opts.dryRun) {
      console.log(cmd.join(' '));
      return;
    }

    runFfmpeg(cmd);
  });

// ─── annotate ──────────────────────────────────────────────────────────────

program
  .command('annotate')
  .description('Add text/arrow annotations to a video')
  .requiredOption('-i, --input <path>', 'Input video path')
  .requiredOption('-o, --output <path>', 'Output video path')
  .requiredOption('-w, --width <number>', 'Video width', parseInt)
  .requiredOption('-h, --height <number>', 'Video height', parseInt)
  .requiredOption('--annotations <json>', 'JSON array of AnnotationRegion objects')
  .option('--filter-only', 'Only print the filter string')
  .option('--dry-run', 'Print the ffmpeg command without executing')
  .action((opts) => {
    const annotations = parseJsonArg<AnnotationRegion[]>(opts.annotations);

    if (opts.filterOnly) {
      console.log(generateAnnotationFilters(annotations, opts.width, opts.height));
      return;
    }

    const cmd = buildAnnotationCommand(opts.input, opts.output, annotations, opts.width, opts.height);

    if (opts.dryRun) {
      console.log(cmd.join(' '));
      return;
    }

    runFfmpeg(cmd);
  });

// ─── process ───────────────────────────────────────────────────────────────

program
  .command('process')
  .description('Run the full processing pipeline from a config file')
  .requiredOption('-c, --config <path>', 'Path to JSON processing config')
  .option('--dry-run', 'Print commands without executing')
  .action((opts) => {
    const config = parseJsonArg<ProcessingConfig>(opts.config);
    const steps = buildPipeline(config);

    if (opts.dryRun) {
      const cmds = pipelineToShellCommands(steps);
      for (const [i, cmd] of cmds.entries()) {
        console.log(`# Step ${i + 1}: ${steps[i].description}`);
        console.log(cmd);
        console.log();
      }
      return;
    }

    for (const [i, step] of steps.entries()) {
      console.error(`[${i + 1}/${steps.length}] ${step.description}`);
      runFfmpeg(step.args);
    }

    console.error('Done.');
  });

// ─── helpers ───────────────────────────────────────────────────────────────

function parseJsonArg<T>(arg: string): T {
  // If it looks like a file path, read the file
  if (arg.endsWith('.json') || arg.startsWith('/') || arg.startsWith('./')) {
    try {
      return JSON.parse(readFileSync(arg, 'utf-8'));
    } catch {
      // Fall through to parse as inline JSON
    }
  }
  return JSON.parse(arg);
}

function runFfmpeg(args: string[]): void {
  const [cmd, ...rest] = args;
  try {
    execFileSync(cmd, rest, { stdio: 'inherit' });
  } catch (err: any) {
    console.error(`FFmpeg failed with exit code ${err.status ?? 'unknown'}`);
    process.exit(err.status ?? 1);
  }
}

program.parse();
