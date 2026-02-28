/**
 * Core types for OpenScreen CLI tools.
 * These mirror the concepts from the GUI but are stripped to what's needed
 * for FFmpeg filter generation.
 */

// --- Zoom/Pan ---

export type ZoomDepth = 1 | 2 | 3 | 4 | 5 | 6;

export interface ZoomFocus {
  /** Normalized horizontal center (0-1) */
  cx: number;
  /** Normalized vertical center (0-1) */
  cy: number;
}

export interface ZoomRegion {
  id: string;
  startMs: number;
  endMs: number;
  depth: ZoomDepth;
  focus: ZoomFocus;
}

export const ZOOM_DEPTH_SCALES: Record<ZoomDepth, number> = {
  1: 1.25,
  2: 1.5,
  3: 1.8,
  4: 2.2,
  5: 3.5,
  6: 5.0,
};

// --- Crop ---

export interface CropRegion {
  /** Normalized x offset (0-1) */
  x: number;
  /** Normalized y offset (0-1) */
  y: number;
  /** Normalized width (0-1) */
  width: number;
  /** Normalized height (0-1) */
  height: number;
}

export const DEFAULT_CROP_REGION: CropRegion = {
  x: 0,
  y: 0,
  width: 1,
  height: 1,
};

// --- Trim ---

export interface TrimRegion {
  id: string;
  startMs: number;
  endMs: number;
}

// --- Annotations ---

export type AnnotationType = 'text' | 'arrow';

export type ArrowDirection =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'up-right'
  | 'up-left'
  | 'down-right'
  | 'down-left';

export interface AnnotationRegion {
  id: string;
  startMs: number;
  endMs: number;
  type: AnnotationType;
  /** For text annotations */
  text?: string;
  /** Normalized position (0-100 percentage of canvas) */
  x: number;
  y: number;
  /** For text */
  fontSize?: number;
  fontColor?: string;
  fontFamily?: string;
  backgroundColor?: string;
  /** For arrows */
  arrowDirection?: ArrowDirection;
  arrowColor?: string;
  arrowSize?: number;
}

// --- Background ---

export type BackgroundType = 'color' | 'gradient' | 'image' | 'blur';

export interface BackgroundConfig {
  type: BackgroundType;
  /** Hex color for 'color' type */
  color?: string;
  /** CSS gradient string for 'gradient' type */
  gradient?: string;
  /** Path to image file for 'image' type */
  imagePath?: string;
  /** Blur radius for 'blur' type (uses the video itself as blurred background) */
  blurRadius?: number;
  /** Padding around the video (percentage 0-100) */
  padding?: number;
  /** Border radius in pixels */
  borderRadius?: number;
}

// --- Pipeline config for CLI ---

export interface VideoInfo {
  width: number;
  height: number;
  durationMs: number;
  fps: number;
}

export interface ProcessingConfig {
  inputPath: string;
  outputPath: string;
  video: VideoInfo;
  zoom?: {
    regions: ZoomRegion[];
    transitionMs?: number;
    smoothing?: number;
  };
  crop?: CropRegion;
  trim?: TrimRegion[];
  background?: BackgroundConfig;
  annotations?: AnnotationRegion[];
  outputWidth?: number;
  outputHeight?: number;
  outputFps?: number;
}
