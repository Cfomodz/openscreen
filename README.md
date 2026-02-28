# OpenScreen CLI

Bare-bones CLI tools for video post-processing. Generates FFmpeg filter strings and commands for zoom/pan, backgrounds, annotations, crop, and trim.

Designed to be used as a library or standalone CLI within video pipelines (e.g., [auto-broll](./CLAUDE.md)).

## Install

```bash
cd cli && npm install
npm run build
```

## CLI Usage

```bash
# Show all commands
node cli/dist/index.js --help

# Generate a zoom filter for FFmpeg
node cli/dist/index.js zoom static --cx 0.5 --cy 0.06 -d 3 -w 1920 -h 1080
# → crop=1067:600:427:0,scale=1920:1080:flags=lanczos

# Animated zoom with regions
node cli/dist/index.js zoom filter \
  -r '[{"id":"z1","startMs":1000,"endMs":3000,"depth":3,"focus":{"cx":0.5,"cy":0.06}}]' \
  -w 1920 -h 1080

# Apply background (dry-run to see command)
node cli/dist/index.js background \
  -i input.mp4 -o output.mp4 -w 1920 -h 1080 \
  -t blur -p 10 --border-radius 12 --dry-run

# Crop video (filter only)
node cli/dist/index.js crop apply -w 1920 -h 1080 --y 0.05 --ch 0.95 --filter-only -i x -o x
# → crop=1920:1026:0:54

# Trim video (remove sections)
node cli/dist/index.js trim \
  -i input.mp4 -o output.mp4 --duration 60000 \
  --regions '[{"id":"t1","startMs":5000,"endMs":10000}]' --dry-run

# Add text annotation
node cli/dist/index.js annotate \
  -i input.mp4 -o output.mp4 -w 1920 -h 1080 \
  --annotations '[{"id":"a1","startMs":0,"endMs":3000,"type":"text","text":"Hello","x":50,"y":10,"fontSize":48,"fontColor":"#ffffff"}]' \
  --dry-run

# Full pipeline from config file
node cli/dist/index.js process -c config.json --dry-run
```

## Library Usage

```typescript
import {
  generateZoomFilter,
  generateStaticZoomFilter,
  generateBackgroundFilter,
  generateCropFilter,
  generateTrimFilter,
  generateAnnotationFilters,
  buildPipeline,
  ZoomPresets,
  CropPresets,
  ZOOM_DEPTH_SCALES,
} from './cli/dist/lib.js';

// Generate FFmpeg filter for animated zoom
const zoomFilter = generateZoomFilter(
  [{ id: 'z1', startMs: 1000, endMs: 3000, depth: 3, focus: { cx: 0.5, cy: 0.06 } }],
  1920, 1080, 30
);

// Generate crop filter
const cropFilter = generateCropFilter(CropPresets.noBrowserChrome(), 1920, 1080);

// Build full pipeline
const steps = buildPipeline({
  inputPath: 'input.mp4',
  outputPath: 'output.mp4',
  video: { width: 1920, height: 1080, durationMs: 60000, fps: 30 },
  zoom: {
    regions: [{ id: 'z1', startMs: 1000, endMs: 3000, depth: 3, focus: ZoomPresets.searchBar() }],
  },
  crop: CropPresets.noBrowserChrome(),
  background: { type: 'blur', blurRadius: 20, padding: 10, borderRadius: 12 },
});

// steps is an array of { description, args } — execute with child_process
```

## Commands

| Command | Description |
|---------|-------------|
| `zoom filter` | Animated zoom from region JSON -> FFmpeg crop expression |
| `zoom static` | Static zoom at a focus point -> FFmpeg crop filter |
| `zoom presets` | List focus point presets and depth scales |
| `background` | Place video on color/blur/image background |
| `crop apply` | Crop using normalized coordinates |
| `crop presets` | List common crop presets |
| `trim` | Remove time ranges and concatenate |
| `annotate` | Add text/arrow overlays |
| `process` | Run full pipeline from config JSON |

## Flags

All commands support:
- `--filter-only` — Print just the FFmpeg filter string (for piping into your own FFmpeg commands)
- `--dry-run` — Print the full FFmpeg command without executing
- Standard execution — Runs FFmpeg directly

## Requirements

- Node.js >= 18
- FFmpeg + ffprobe in PATH

## License

[MIT License](./LICENSE)
