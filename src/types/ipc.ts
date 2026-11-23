export interface IpcMessage<T = any> {
  type: string
  payload: T
  id?: string
}

export interface VideoImportRequest {
  filePath: string
}

export interface VideoImportResponse {
  id: string
  name: string
  path: string
  metadata: {
    duration: number
    width: number
    height: number
    fps: number
    codec: string
    bitrate: string
  }
}

export interface RemoveSilenceRequest {
  videoPath: string
  threshold?: number
  outputPath?: string
}

export interface AdjustVolumeRequest {
  videoPath: string
  /** Volume of the original audio track, 0-1 (0 = fully muted). */
  volume: number
  outputPath?: string
}

export interface GetLastFrameRequest {
  videoPath: string
  outputPath?: string
}

export interface MergeVideosRequest {
  videoPaths: string[]
  outputPath: string
}

export interface UpscaleRequest {
  videoPath: string
  outputPath: string
  method: 'lanczos' | 'realesrgan'
  /** Lanczos: target height in pixels (1080, 1440, 2160, 4320). */
  targetHeight?: number
  /** Real-ESRGAN: scale factor and model name for the ncnn binary. */
  scale?: number
  model?: string
  exePath?: string
  modelsPath?: string
  /** Tile size in px for the ncnn binary (0/undefined = auto). */
  tileSize?: number
  /** Optional RIFE interpolation stage (runs before the upscale). */
  rife?: { exePath: string; modelPath: string; multiplier: number }
}

/** Progress event payload; stage is set by multi-stage jobs. */
export interface RenderProgressUpdate {
  progress: number
  stage?: string
}

export interface SystemStats {
  cpuPercent: number
  ramUsedGB: number
  ramTotalGB: number
  ramPercent: number
  /** Present when nvidia-smi answered (NVIDIA GPU + driver). */
  gpu?: {
    name: string
    utilPercent: number
    vramUsedMB: number
    vramTotalMB: number
    tempC: number
  }
  /** CPU temperature when the OS exposes it (WMI thermal zone). */
  cpuTempC?: number
}

export interface TrimRequest {
  videoPath: string
  outputPath: string
  startSeconds: number
  endSeconds: number
}

export interface SplitRequest {
  videoPath: string
  /** Folder the parts are written into. */
  partsDir: string
  mode: 'at' | 'segments'
  atSeconds?: number
  segmentSeconds?: number
}

export interface CropRequest {
  videoPath: string
  outputPath: string
  x: number
  y: number
  width: number
  height: number
}

export interface SpeedRequest {
  videoPath: string
  outputPath: string
  /** >1 is faster, <1 is slower (0.5 = half speed). */
  factor: number
}

export type TransformKind = 'rot90' | 'rot-90' | 'rot180' | 'flipH' | 'flipV'

export interface TransformRequest {
  videoPath: string
  outputPath: string
  transform: TransformKind
}

export interface TimelineThumbsRequest {
  videoPath: string
  outputPath: string
  columns?: number
  rows?: number
}

export interface AddMusicRequest {
  videoPath: string
  musicPath: string
  musicVolume: number
  /** Volume of the original track in the mix, 0-1 (0 = muted). */
  originalVolume?: number
  outputPath: string
}

export interface ExportRequest {
  videoPath: string
  outputPath: string
  format: 'mp4' | 'webm' | 'mov'
  quality: 'low' | 'medium' | 'high'
}

/** Result returned by every ffmpeg processing handler. */
export interface ProcessResult {
  success: boolean
  outputPath?: string
  error?: string
}

export interface ComposeRequest {
  /** Video clips with absolute timeline offsets (seconds). */
  clips: {
    path: string
    startSeconds: number
    endSeconds: number
    offsetSeconds: number
    dropFirstFrame?: boolean
  }[]
  /** Added audio clips at absolute start times, pre-trimmed. */
  audioClips: {
    path: string
    volume: number
    startAtSeconds: number
    startSeconds: number
    endSeconds: number
    lane?: string
  }[]
  /** Per-lane (track) fade durations in seconds. */
  audioLaneFades?: Record<
    string,
    { fadeInSeconds: number; fadeOutSeconds: number }
  >
  /** Volume of the clips' own audio, 0-1 (0 = muted). */
  originalVolume: number
  /** Video-track audio fades in seconds. */
  originalFadeInSeconds?: number
  originalFadeOutSeconds?: number
  outputPath: string
}

export interface WaveformRequest {
  path: string
  startSeconds: number
  endSeconds: number
  buckets: number
}

export interface FrameExtractRequest {
  path: string
  timeSeconds: number
  which: 'first' | 'last'
  rangeStartSeconds: number
}

export interface ThumbnailsRequest {
  videoPath: string
  startSeconds: number
  endSeconds: number
  count: number
}
