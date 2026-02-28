/**
 * Library exports for programmatic use from auto-broll or other Node.js projects.
 *
 * import { generateZoomFilter, buildPipeline, CropPresets, ... } from 'openscreen-cli';
 */

// Types
export type {
  ZoomDepth,
  ZoomFocus,
  ZoomRegion,
  CropRegion,
  TrimRegion,
  AnnotationType,
  ArrowDirection,
  AnnotationRegion,
  BackgroundType,
  BackgroundConfig,
  VideoInfo,
  ProcessingConfig,
} from './types.js';

export { ZOOM_DEPTH_SCALES, DEFAULT_CROP_REGION } from './types.js';

// Zoom
export {
  generateZoomFilter,
  generateStaticZoomFilter,
  sampleZoomKeyframes,
  computeRegionStrength,
  findDominantRegion,
  ZoomPresets,
} from './zoom.js';
export type { ZoomKeyframe } from './zoom.js';

// Background
export {
  generateBackgroundFilter,
  buildBackgroundCommand,
} from './background.js';

// Annotations
export {
  generateAnnotationFilters,
  buildAnnotationCommand,
} from './annotations.js';

// Crop
export {
  generateCropFilter,
  generateCropAndScaleFilter,
  buildCropCommand,
  CropPresets,
} from './crop.js';

// Trim
export {
  generateTrimFilter,
  buildTrimCommand,
  computeKeptSegments,
  computeEffectiveDuration,
} from './trim.js';

// Pipeline
export {
  buildPipeline,
  pipelineToShellCommands,
} from './pipeline.js';
export type { PipelineStep } from './pipeline.js';
