auto-browse-screen-recording-video-for-voiceover — Full Project Description
What It Is
A Node.js/TypeScript CLI tool (auto-broll) that takes a voiceover audio file + transcript and automatically generates B-roll screen recording video to accompany the narration. It analyzes the transcript with an LLM, extracts topics, performs browser actions (Google searches, definition lookups, news searches, image searches) for each topic, records the screen via Chrome DevTools Protocol, overlays realistic SFX (keyboard typing, mouse clicks, scrolling sounds), applies dynamic camera zoom/pan, and assembles everything into a final video with FFmpeg.
How the Pipeline Works (End to End)
Transcript Parsing — Reads an SRT, VTT, or timestamped plain-text file into TranscriptSegment[] (each with startTime, endTime, text)
LLM Topic Extraction — Sends segments to an OpenAI-compatible LLM (DeepSeek or OpenAI) which returns ExtractedTopic[], each with a topic name, description, associated transcript segments, and suggested browser actions (web-search, news-search, definition-search, image-search)
Topic caching — Results cached in topics-cache.json keyed by transcript path + mtime, so re-runs skip the LLM call
Browser Launch — Puppeteer-core launches Chrome with a specific viewport (default 1920x1080)
Per-Topic Recording Loop — For each topic and each suggested action:
Checks for existing clip (skips if already recorded)
Starts CDP screencast frame capture
Starts SFX event tracking
Executes the module's browser choreography (search, scroll, click, etc.)
Stops recording, assembles PNG frames into a video-only MP4
Bakes SFX audio into the clip immediately
Writes a JSON sidecar with clip timing/metadata for debugging
Final Assembly — VideoAssembler processes all clips:
Applies zoom/pan filters per clip
Trims or pads clips to target duration
Concatenates all processed clips
Builds a global SFX track (for any clips without baked SFX)
Muxes: concatenated video + voiceover audio + SFX track → final output MP4
Architecture & Key Abstractions
Module System
All browser actions implement the BrollModule abstract class:
abstract class BrollModule {  abstract readonly name: string;  abstract readonly actionType: ModuleActionType; // 'web-search' | 'news-search' | 'definition-search' | 'image-search'  abstract execute(page: Page, browser: BrowserEngine, topic: ExtractedTopic): Promise<ModuleExecuteResult>;}interface ModuleExecuteResult {  durationSeconds: number;  zoomKeyframes: ZoomKeyframe[];  // camera movement plan  sfxEvents: SfxEvent[];          // accumulated audio events}
Modules are registered in a ModuleRegistry (simple Map<ModuleActionType, BrollModule>). Each module performs a scripted browser choreography and returns zoom keyframes + SFX events.
Current modules:
WebSearchModule — navigates to search engine, types query, scrolls results, hovers a link
DefinitionSearchModule — searches "define {topic}", looks for knowledge panel or clicks dictionary sites
NewsSearchModule — searches, clicks News tab, scrolls headlines, clicks an article
ImageSearchModule — searches, clicks Images tab, scrolls grid, hovers random images
BrowserEngine
Wraps Puppeteer-core. Key responsibilities:
Browser lifecycle (launch/close)
High-level actions: performSearch(query), humanType(text), clickAt(x, y), clickElement(selector), smoothScroll(pixels)
SFX tracking: startClipSfxTracking() / collectClipSfxEvents() / getClipTimeOffset()
Owns a TypingAnimator and MouseAnimator
TypingAnimator — Audio-Driven Cadence
Two modes:
Audio-driven (SFX enabled): calls SfxManager.buildTypingTimelineWithKeystrokes() to get audio clips with per-keystroke timestamps. Types each character at the exact timestamp from the audio, creating 1:1 visual-to-audio sync.
Fallback: Gaussian-distributed delays with configurable inconsistency, typo probability, QWERTY-adjacency mistakes, and word pause variation.
MouseAnimator
Bézier curve paths for natural movement with easing
Audio-driven scrolling: replays recorded ScrollEvent[] with original timestamps to match visual scroll velocity to trackpad gesture audio
SfxManager
Loads three categories of audio samples:
Click clips — WAV files in left/, right/, double/ subdirectories with JSON sidecars containing clickSignalMs (offset to transient)
Typing clips — WAV + JSON pairs where the JSON has typedText, wordCount, keystrokes: [{key, timestampMs}]. Selected by scoring: character count similarity, keystroke adequacy, word count match, backspace penalty.
Scroll clips — WAV + JSON with totalDeltaY, direction, events: [{deltaY, timestampMs}]
Key methods:
getClickSfx(timeOffset, clickType) — selects clip, adjusts offset by click transient position
getTypingSfxWithKeystrokes(text, timeOffset) — returns SFX event + keystroke array for visual cadence
buildTypingTimelineWithKeystrokes(text, startOffset) — chains multiple clips for long text, splits by word count
getScrollSfx(targetDeltaY, direction, timeOffset) — finds closest delta match
ScreenRecorder (CDP Screencast)
Uses Page.startScreencast({format: 'png', quality: 80}) to capture viewport frames
Each frame saved as frame_XXXXXX.png with wall-clock timestamp
Assembly uses FFmpeg concat demuxer with per-frame durations computed from wall-clock timestamps (preserves variable frame rate for accurate SFX sync)
Fallback to fixed framerate if timestamps unavailable
ZoomEngine
Converts ZoomKeyframe[] into FFmpeg crop+scale filter chains:
Keyframes use normalized coordinates (0-1): {timeOffset, region: {x, y, width, height}, label}
width/height are fraction of viewport (1.0 = full frame, 0.5 = 2x zoom)
Generates interpolated FFmpeg expressions with easing (ease-in-out, ease-in, ease-out, linear)
ZoomPresets provides common positions: searchBarFocus(), fullWindow(), searchResultsFocus(), tabBarFocus(), definitionCardFocus(), imageGridFocus(), elementFocus(x, y)
VideoAssembler
Multi-stage FFmpeg pipeline:
bakeSfxIntoClip() — per-clip SFX mixing with adelay + amix
processClips() — applies zoom filters, trims/pads duration, adds silent audio if needed
concatenateClips() — FFmpeg concat demuxer with -c copy
buildSfxTrack() — global SFX timeline via adelay + amix for un-baked segments
muxFinal() — combines concatenated video + voiceover + SFX track with amix
Configuration Schema
interface PipelineConfig {  transcriptPath: string;        // SRT, VTT, or timestamped text  audioPath: string;             // Voiceover MP3/WAV  outputDir: string;  viewport: { width: number; height: number };  browserExecutablePath?: string;  searchEngine: 'google' | 'brave' | 'duckduckgo';  llm: { provider: 'deepseek' | 'openai'; apiKey?: string; model?: string };  modules: Record<ModuleActionType, { enabled: boolean }>;  mouseStyle: 'realistic' | 'smooth' | 'instant';  video: { fps: number; resolution: { width: number; height: number }; format: 'mp4' | 'webm' };  sfx?: {    enabled: boolean;    libraryPath: string;    volume: number;    mouseClick: { enabled: boolean; samplesDir: string };    keyboardTyping: { enabled: boolean; samplesDir: string; targetLUFS?: number };    mouseScroll?: { enabled: boolean; samplesDir: string };  };  camera?: { enabled: boolean; maxZoom: number; transitionMs: number; easing: string };  typing?: { baseDelayMs: number; inconsistency: number; mistakeProbability: number; maxMistakeLength: number; thinkPause: { minMs: number; maxMs: number } };}
CLI Commands
auto-broll run -c config.json — full pipeline
auto-broll run-one -c config.json --topic "AI" --action web-search — single topic/action for debugging
auto-broll analyze -c config.json — show extracted topics without recording
auto-broll transcribe -i audio.mp3 — Whisper transcription to SRT
auto-broll record-typing — record typing audio with keystroke logging for SFX library
auto-broll record-mouse — record click/scroll SFX
auto-broll coverage / mouse-coverage — analyze SFX library completeness
auto-broll extract-typing — re-slice recorded sessions into clips
auto-broll init — generate starter config
Dependencies
puppeteer-core ^23 — browser automation
fluent-ffmpeg ^2.1.3 — FFmpeg wrapper
openai ^4.60 — LLM client (OpenAI-compatible, used for DeepSeek too)
commander ^12 — CLI framework
winston ^3.14 — logging
bezier-easing ^2.1 — animation curves
dotenv ^17 — env vars
Runtime requirements: Node >=18, FFmpeg + ffprobe, Chrome/Chromium.
What the Video Output Looks Like
The final output is an MP4 where:
The video track shows a screen recording of a Chrome browser performing searches, scrolling results, clicking links — all with human-like timing
Camera dynamically zooms into search bars, result areas, definition cards, etc. and pulls back out
Audio has the original voiceover mixed with realistic keyboard typing sounds, mouse click sounds, and scroll sounds — all synced to the visual actions
Each topic from the transcript gets one or more clips concatenated in chronological order
Key Integration Points for OpenScreen Features
The areas where OpenScreen-style features would integrate:
Post-processing effects (zoom/pan) — Currently handled by ZoomEngine generating FFmpeg crop filters. OpenScreen's PixiJS-based zoom/pan could replace or augment this with smoother, GPU-accelerated transforms.
Background/wallpaper — Currently none; clips are raw browser recordings. OpenScreen's background system (wallpapers, gradients, solid colors, custom images) could be applied as a frame around the browser recording.
Motion blur — Not currently implemented. OpenScreen has motion blur for smoother pan/zoom.
Annotations — Not currently implemented. OpenScreen supports text, arrows, and image annotations.
Cropping — Currently relies on viewport size. OpenScreen's crop tool could allow hiding parts of the recording (like browser chrome).
Trimming — Currently done by FFmpeg trim/tpad in VideoAssembler. OpenScreen has interactive trim.
Export options — Currently fixed at config resolution/fps. OpenScreen supports different aspect ratios and resolutions.
The pipeline's FFmpeg dependency — All current video processing goes through FFmpeg via CLI. Any OpenScreen features ported as CLI functions would need to either: (a) produce FFmpeg filter strings that plug into the existing processClips() / muxFinal() pipeline, or (b) operate as standalone post-processing steps that take an MP4 in and produce an MP4 out.
