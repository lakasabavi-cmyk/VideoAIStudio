export interface VideoFile {
  id: string
  path: string
  name: string
  duration: number
  width: number
  height: number
  fps: number
  codec: string
  bitrate: string
  size: number
  createdAt: Date
}

export interface Project {
  id: string
  name: string
  description?: string
  videos: VideoFile[]
  settings: ProjectSettings
  createdAt: Date
  updatedAt: Date
}

export interface ProjectSettings {
  removeSilence: boolean
  silenceThreshold: number
  backgroundMusic?: string
  musicVolume: number
  /** Volume of the ORIGINAL audio track, 0-100 percent (0 = muted). */
  originalVolume: number
  exportFormat: 'mp4' | 'webm' | 'mov'
  exportQuality: 'low' | 'medium' | 'high'
  /** Upscale method: quick Lanczos scaling or Real-ESRGAN. */
  upscaleMethod: 'lanczos' | 'realesrgan'
  /** Lanczos target resolution (output height follows the label). */
  lanczosTarget: '1080p' | '2k' | '4k' | '8k'
  /** Real-ESRGAN scale factor; the model follows from it. */
  esrganScale: 2 | 3 | 4
  /** 4x model: 'fast' = realesr-animevideov3-x4 (the same
   * light video model as 2x/3x); 'quality' = realesrgan-x4plus
   * (heavy photo model — sharper on real photos, several
   * times slower). */
  esrgan4xModel: 'fast' | 'quality'
  /** Real-ESRGAN tile size in px (0 = auto). Lower it (e.g. 256)
   * when a job dies with out-of-memory on large frames. */
  esrganTileSize: number
  /** Path to the realesrgan-ncnn-vulkan executable. */
  esrganPath: string
  /** Folder with the Real-ESRGAN model files (blank = "models" next to the executable). */
  esrganModelsPath: string
  /** Run RIFE frame interpolation inside the Real-ESRGAN pipeline. */
  rifeEnabled: boolean
  /** RIFE frame-rate multiplier (2 = double fps, 4 = quadruple). */
  rifeMultiplier: 2 | 4
  /** Path to the rife-ncnn-vulkan executable. */
  rifePath: string
  /** RIFE model folder (blank = "rife-v4.6" next to the executable). */
  rifeModelPath: string
}

export type RenderJobKind =
  | 'remove-silence'
  | 'add-music'
  | 'export'
  | 'adjust-volume'
  | 'get-last-frame'
  | 'merge'
  | 'upscale'
  | 'trim'
  | 'split'
  | 'crop'
  | 'speed'
  | 'transform'
  | 'timeline'
  | 'compose'

export interface RenderJobParams {
  threshold?: number
  musicPath?: string
  musicVolume?: number
  /** Original-track volume, 0-1 (converted from the settings percent). */
  volume?: number
  originalVolume?: number
  /** All input paths for a merge job, in merge order. */
  inputPaths?: string[]
  /** Upscale job snapshot (settings are copied at enqueue time). */
  upscale?: {
    method: 'lanczos' | 'realesrgan'
    targetHeight?: number
    scale?: number
    model?: string
    exePath?: string
    modelsPath?: string
    rife?: { exePath: string; modelPath: string; multiplier: number }
    tileSize?: number
    outputSuffix: string
  }
  format?: 'mp4' | 'webm' | 'mov'
  trim?: { startSeconds: number; endSeconds: number }
  split?: {
    mode: 'at' | 'segments'
    atSeconds?: number
    segmentSeconds?: number
  }
  crop?: { x: number; y: number; width: number; height: number }
  speed?: { factor: number }
  transform?: 'rot90' | 'rot-90' | 'rot180' | 'flipH' | 'flipV'
  /** Timeline composition snapshot (see composeTimeline). */
  compose?: {
    clips: {
      path: string
      startSeconds: number
      endSeconds: number
      offsetSeconds: number
      dropFirstFrame?: boolean
      transition?: string
    }[]
    audioClips: {
      path: string
      volume: number
      startAtSeconds: number
      startSeconds: number
      endSeconds: number
      lane?: string
    }[]
    audioLaneFades?: Record<
      string,
      { fadeInSeconds: number; fadeOutSeconds: number }
    >
    originalVolume: number
    ducking?: boolean
    /** Build Movie renders into a new folder with this name. */
    projectName?: string
    originalFadeInSeconds?: number
    originalFadeOutSeconds?: number
  }
  quality?: 'low' | 'medium' | 'high'
}

export interface RenderJob {
  id: string
  projectId?: string
  kind: RenderJobKind
  videoName: string
  inputPath: string
  params?: RenderJobParams
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
  progress: number
  /** Current pipeline stage label (e.g. "Extract Frames"), when the
   * running job reports stages. Shown in the Render Queue. */
  stage?: string
  /** When the job actually started / finished processing. */
  startedAt?: Date
  finishedAt?: Date
  outputPath?: string
  error?: string
  createdAt: Date
  updatedAt: Date
}

export interface VideoMetadata {
  format: string
  duration: number
  bitrate: number
  width: number
  height: number
  fps: number
  codec: string
  audioCodec?: string
}
