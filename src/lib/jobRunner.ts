import { v4 as uuidv4 } from 'uuid'
import { useRenderQueue } from '@/stores/renderQueue'
import { useSettingsStore } from '@/stores/settingsStore'
import type { ProcessResult } from '@/types/ipc'
import type { RenderJob, RenderJobKind, VideoFile } from '@/types'
import {
  withSuffix,
  lastFramePath,
  partsDirPath,
  sanitizeFolderName,
  projectOutputPath,
} from './files'

/**
 * Sequential render-queue runner.
 *
 * Jobs are executed one at a time: ffmpeg progress events arrive on a
 * single 'render:progress' stream with no job id attached, so running
 * jobs in parallel would make progress attribution ambiguous.
 */

let running = false
let activeJobId: string | null = null
let progressHooked = false

function hookProgress() {
  if (progressHooked) return
  progressHooked = true
  window.electronAPI.onRenderProgress((update) => {
    if (!activeJobId) return
    const { jobs, updateJob } = useRenderQueue.getState()
    const job = jobs.find((j) => j.id === activeJobId)
    if (job && job.status === 'processing') {
      const pct = Math.max(0, Math.min(100, Math.round(update.progress)))
      const stageChanged = update.stage !== undefined && update.stage !== job.stage
      if (Number.isFinite(pct) && (pct !== job.progress || stageChanged)) {
        updateJob({
          ...job,
          progress: Number.isFinite(pct) ? pct : job.progress,
          stage: update.stage ?? job.stage,
          updatedAt: new Date(),
        })
      }
    }
  })
}

function enqueue(job: RenderJob) {
  useRenderQueue.getState().addJob(job)
  void processQueue()
}

function baseJob(
  kind: RenderJobKind,
  video: VideoFile,
  params: RenderJob['params']
): RenderJob {
  const now = new Date()
  return {
    id: uuidv4(),
    kind,
    videoName: video.name,
    inputPath: video.path,
    params,
    status: 'pending',
    progress: 0,
    createdAt: now,
    updatedAt: now,
  }
}

/** Returns an error message instead of enqueueing when setup is missing. */
export function enqueueTranscribe(video: VideoFile): string | null {
  const { whisperPythonPath, whisperModel, whisperLanguage } =
    useSettingsStore.getState()
  if (!whisperPythonPath) {
    return (
      'faster-whisper python is not set. Run tools/setup-whisper.bat ' +
      'once, then set the python path in Settings > Transcript.'
    )
  }
  enqueue(
    baseJob('transcribe', video, {
      transcribe: {
        pythonPath: whisperPythonPath,
        model: whisperModel,
        language: whisperLanguage,
      },
    })
  )
  return null
}

export function enqueueTranscriptCuts(video: VideoFile) {
  enqueue(baseJob('transcript-cuts', video, undefined))
}

export function enqueueBurnSubtitles(video: VideoFile) {
  enqueue(baseJob('burn-subtitles', video, undefined))
}

export function enqueueRemoveSilence(video: VideoFile) {
  const { silenceThreshold } = useSettingsStore.getState()
  enqueue(baseJob('remove-silence', video, { threshold: silenceThreshold }))
}

export function enqueueAdjustVolume(video: VideoFile) {
  const { originalVolume } = useSettingsStore.getState()
  enqueue(
    baseJob('adjust-volume', video, {
      // Settings store volume as 0-100 percent; the service wants 0-1.
      volume: originalVolume / 100,
    })
  )
}

export function enqueueGetLastFrame(video: VideoFile) {
  enqueue(baseJob('get-last-frame', video, undefined))
}

/**
 * Merge all given videos in list order. The first frame of every
 * clip after the first is dropped (see the merge service), so the
 * job needs at least two videos.
 */
export function enqueueMerge(videos: VideoFile[]) {
  if (videos.length < 2) return
  const job = baseJob('merge', videos[0], {
    inputPaths: videos.map((v) => v.path),
  })
  job.videoName = `${videos[0].name} + ${videos.length - 1} more`
  enqueue(job)
}

const LANCZOS_TARGETS = { '1080p': 1080, '2k': 1440, '4k': 2160, '8k': 4320 } as const
const ESRGAN_MODELS = {
  2: 'realesr-animevideov3-x2',
  3: 'realesr-animevideov3-x3',
} as const

// 4x has two models in the standard pack: the light video
// model (fast, same family as 2x/3x) and the heavy photo
// model (quality). Hung found the photo model far too slow
// on his laptop, so fast is the default.
function esrganModel(
  scale: 2 | 3 | 4,
  model4x: 'fast' | 'quality'
): string {
  if (scale === 4) {
    return model4x === 'quality'
      ? 'realesrgan-x4plus'
      : 'realesr-animevideov3-x4'
  }
  return ESRGAN_MODELS[scale]
}

/** Built-in models from the standard realesrgan-ncnn-vulkan
 * pack, with the scale each model is built for. The service
 * checks the model file exists before a job starts, so a
 * name missing from the user's pack fails fast and clearly. */
export const ESRGAN_MODEL_SCALES: Record<string, 2 | 3 | 4> = {
  'realesr-animevideov3-x2': 2,
  'realesr-animevideov3-x3': 3,
  'realesr-animevideov3-x4': 4,
  'realesrgan-x4plus': 4,
  'realesrgan-x4plus-anime': 4,
  'realesrnet-x4plus': 4,
}

/** Resolve the Settings model choice to a concrete model
 * name + scale: a built-in model fixes its own scale, a
 * custom name uses the scale buttons, and Auto follows the
 * scale (with the fast/quality pick at 4x). */
export function resolveEsrganModel(settings: {
  esrganModel: string
  esrganCustomModel: string
  esrganScale: 2 | 3 | 4
  esrgan4xModel: 'fast' | 'quality'
}): { model: string; scale: 2 | 3 | 4 } {
  const chosen = settings.esrganModel
  if (chosen === 'custom') {
    const name = settings.esrganCustomModel.trim()
    if (name) return { model: name, scale: settings.esrganScale }
  } else if (chosen && ESRGAN_MODEL_SCALES[chosen]) {
    return { model: chosen, scale: ESRGAN_MODEL_SCALES[chosen] }
  }
  return {
    model: esrganModel(settings.esrganScale, settings.esrgan4xModel),
    scale: settings.esrganScale,
  }
}

export function enqueueUpscale(
  video: VideoFile,
  forceRife = false
): string | null {
  const settings = useSettingsStore.getState()
  const wantRife = settings.rifeEnabled || forceRife
  if (settings.upscaleMethod === 'realesrgan' || forceRife) {
    if (!settings.esrganPath.trim()) {
      return 'Set the Real-ESRGAN executable path in Settings first.'
    }
    if (
      settings.esrganModel === 'custom' &&
      !settings.esrganCustomModel.trim()
    ) {
      return 'Type the custom ESRGAN model name in Settings first.'
    }
    const rife = wantRife
      ? {
          exePath: settings.rifePath,
          modelPath: settings.rifeModelPath,
          multiplier: settings.rifeMultiplier,
        }
      : undefined
    if (wantRife && !settings.rifePath.trim()) {
      return 'RIFE is enabled but its executable path is not set in Settings.'
    }
    const resolved = resolveEsrganModel(settings)
    enqueue(
      baseJob('upscale', video, {
        upscale: {
          method: 'realesrgan',
          scale: resolved.scale,
          model: resolved.model,
          exePath: settings.esrganPath,
          modelsPath: settings.esrganModelsPath,
          tileSize: settings.esrganTileSize,
          sharpen: settings.esrganSharpen,
          rife,
          outputSuffix:
            `_${resolved.scale}x` +
            (rife ? `_rife${settings.rifeMultiplier}x` : ''),
        },
      })
    )
  } else {
    enqueue(
      baseJob('upscale', video, {
        upscale: {
          method: 'lanczos',
          targetHeight: LANCZOS_TARGETS[settings.lanczosTarget],
          outputSuffix: `_${settings.lanczosTarget}`,
        },
      })
    )
  }
  return null
}

export function enqueueTrim(
  video: VideoFile,
  startSeconds: number,
  endSeconds: number
) {
  enqueue(baseJob('trim', video, { trim: { startSeconds, endSeconds } }))
}

export function enqueueSplit(
  video: VideoFile,
  split: { mode: 'at' | 'segments'; atSeconds?: number; segmentSeconds?: number }
) {
  enqueue(baseJob('split', video, { split }))
}

export function enqueueCrop(
  video: VideoFile,
  crop: { x: number; y: number; width: number; height: number }
) {
  enqueue(baseJob('crop', video, { crop }))
}

export function enqueueSpeed(video: VideoFile, factor: number) {
  enqueue(baseJob('speed', video, { speed: { factor } }))
}

export function enqueueTransform(
  video: VideoFile,
  transform: 'rot90' | 'rot-90' | 'rot180' | 'flipH' | 'flipV'
) {
  enqueue(baseJob('transform', video, { transform }))
}

export function enqueueTimeline(video: VideoFile) {
  enqueue(baseJob('timeline', video, undefined))
}

/**
 * Build a movie from the timeline: video clips at their timeline
 * offsets (gaps render black), Smart Concat flags passed through,
 * and every audio-lane clip resolved to an absolute start time.
 * Returns an error message instead of enqueueing when the timeline
 * has no video clips.
 */
export function enqueueCompose(timeline: {
  videoClips: {
    id: string
    path: string
    name: string
    duration: number
    width: number
    height: number
    trimStart: number
    trimEnd: number
    offset: number
    dropFirstFrame: boolean
    transition?: string
  }[]
  audioClips: {
    path: string
    volume: number
    kind: 'voice' | 'music' | 'sfx'
    trimStart: number
    trimEnd: number
    duration: number
  }[]
  laneOffsets: Record<'voice' | 'music' | 'sfx', number>
  laneVolumes?: Record<'voice' | 'music' | 'sfx', number>
  laneFades?: Record<
    'voice' | 'music' | 'sfx',
    { fadeIn: number; fadeOut: number }
  >
  videoFadeIn?: number
  videoFadeOut?: number
  ducking?: boolean
  projectName?: string
  originalVolume: number
}): string | null {
  if (timeline.videoClips.length === 0) {
    return 'Add at least one video clip to the timeline first.'
  }
  const projectName = sanitizeFolderName(timeline.projectName ?? '')
  if (!projectName) {
    return 'Enter a project name first — every build renders into its own project folder next to the first clip.'
  }
  const first = timeline.videoClips[0]
  const pseudo: VideoFile = {
    id: first.id,
    path: first.path,
    name: first.name,
    duration: first.duration,
    width: first.width,
    height: first.height,
    fps: 0,
    codec: '',
    bitrate: '',
    size: 0,
    createdAt: new Date(),
  }
  // Resolve each audio clip to an absolute start: its lane offset
  // plus the kept lengths of the clips before it in the same lane.
  const laneCursor = { ...timeline.laneOffsets }
  const audioClips = timeline.audioClips.map((a) => {
    const startAt = laneCursor[a.kind] ?? 0
    laneCursor[a.kind] = startAt + Math.max(0, a.trimEnd - a.trimStart)
    // Clip volume x its lane (track) volume.
    const laneVolume = (timeline.laneVolumes?.[a.kind] ?? 100) / 100
    return {
      path: a.path,
      volume: (a.volume / 100) * laneVolume,
      startAtSeconds: startAt,
      startSeconds: a.trimStart,
      endSeconds: a.trimEnd,
      lane: a.kind,
    }
  })
  const audioLaneFades: Record<
    string,
    { fadeInSeconds: number; fadeOutSeconds: number }
  > = {}
  for (const kind of ['voice', 'music', 'sfx'] as const) {
    const fade = timeline.laneFades?.[kind]
    if (fade && (fade.fadeIn > 0 || fade.fadeOut > 0)) {
      audioLaneFades[kind] = {
        fadeInSeconds: fade.fadeIn,
        fadeOutSeconds: fade.fadeOut,
      }
    }
  }
  const job = baseJob('compose', pseudo, {
    compose: {
      clips: timeline.videoClips.map((c) => ({
        path: c.path,
        startSeconds: c.trimStart,
        endSeconds: c.trimEnd,
        offsetSeconds: c.offset,
        dropFirstFrame: c.dropFirstFrame,
        transition: c.transition,
      })),
      audioClips,
      audioLaneFades,
      ducking: timeline.ducking ?? false,
      projectName,
      originalVolume: timeline.originalVolume / 100,
      originalFadeInSeconds: timeline.videoFadeIn ?? 0,
      originalFadeOutSeconds: timeline.videoFadeOut ?? 0,
    },
  })
  job.videoName =
    timeline.videoClips.length > 1
      ? `${first.name} + ${timeline.videoClips.length - 1} more (timeline)`
      : `${first.name} (timeline)`
  enqueue(job)
  return null
}

export function enqueueExport(video: VideoFile) {
  const { exportFormat, exportQuality } = useSettingsStore.getState()
  enqueue(
    baseJob('export', video, { format: exportFormat, quality: exportQuality })
  )
}

/** Returns an error message instead of enqueueing when setup is missing. */
export function enqueueAddMusic(video: VideoFile): string | null {
  const { backgroundMusic, musicVolume, originalVolume } =
    useSettingsStore.getState()
  if (!backgroundMusic) {
    return 'No background music selected. Pick a music file in Settings first.'
  }
  enqueue(
    baseJob('add-music', video, {
      musicPath: backgroundMusic,
      // Settings store volumes as 0-100 percent; ffmpeg wants 0-1.
      musicVolume: musicVolume / 100,
      originalVolume: originalVolume / 100,
    })
  )
  return null
}

async function execute(job: RenderJob): Promise<ProcessResult> {
  const api = window.electronAPI
  switch (job.kind) {
    case 'remove-silence':
      return api.removeSilence({
        videoPath: job.inputPath,
        outputPath: withSuffix(job.inputPath, '.nosil'),
        threshold: job.params?.threshold,
      })
    case 'adjust-volume':
      return api.adjustVolume({
        videoPath: job.inputPath,
        outputPath: withSuffix(job.inputPath, '.vol'),
        volume: job.params?.volume ?? 1,
      })
    case 'add-music':
      return api.addMusic({
        videoPath: job.inputPath,
        musicPath: job.params?.musicPath ?? '',
        outputPath: withSuffix(job.inputPath, '.music'),
        musicVolume: job.params?.musicVolume ?? 0.5,
        originalVolume: job.params?.originalVolume,
      })
    case 'get-last-frame':
      return api.getLastFrame({
        videoPath: job.inputPath,
        outputPath: lastFramePath(job.inputPath),
      })
    case 'merge':
      return api.mergeVideos({
        videoPaths: job.params?.inputPaths ?? [job.inputPath],
        outputPath: withSuffix(job.inputPath, '.merged'),
      })
    case 'upscale': {
      const upscale = job.params?.upscale
      if (!upscale) throw new Error('Missing upscale settings')
      return api.upscaleVideo({
        videoPath: job.inputPath,
        outputPath: withSuffix(job.inputPath, upscale.outputSuffix),
        method: upscale.method,
        targetHeight: upscale.targetHeight,
        scale: upscale.scale,
        model: upscale.model,
        exePath: upscale.exePath,
        modelsPath: upscale.modelsPath,
        tileSize: upscale.tileSize,
        sharpen: upscale.sharpen,
        rife: upscale.rife,
      })
    }
    case 'trim':
      return api.trimVideo({
        videoPath: job.inputPath,
        outputPath: withSuffix(job.inputPath, '.trim'),
        startSeconds: job.params?.trim?.startSeconds ?? 0,
        endSeconds: job.params?.trim?.endSeconds ?? 0,
      })
    case 'split':
      return api.splitVideo({
        videoPath: job.inputPath,
        partsDir: partsDirPath(job.inputPath),
        mode: job.params?.split?.mode ?? 'segments',
        atSeconds: job.params?.split?.atSeconds,
        segmentSeconds: job.params?.split?.segmentSeconds,
      })
    case 'crop':
      return api.cropVideo({
        videoPath: job.inputPath,
        outputPath: withSuffix(job.inputPath, '.crop'),
        x: job.params?.crop?.x ?? 0,
        y: job.params?.crop?.y ?? 0,
        width: job.params?.crop?.width ?? 0,
        height: job.params?.crop?.height ?? 0,
      })
    case 'speed':
      return api.changeSpeed({
        videoPath: job.inputPath,
        outputPath: withSuffix(
          job.inputPath,
          `.speed${job.params?.speed?.factor ?? 1}x`
        ),
        factor: job.params?.speed?.factor ?? 1,
      })
    case 'transform':
      return api.transformVideo({
        videoPath: job.inputPath,
        outputPath: withSuffix(job.inputPath, `.${job.params?.transform ?? 'rot90'}`),
        transform: job.params?.transform ?? 'rot90',
      })
    case 'timeline':
      return api.timelineThumbnails({
        videoPath: job.inputPath,
        outputPath: withSuffix(job.inputPath, '.timeline.png'),
        columns: 5,
        rows: 2,
      })
    case 'compose': {
      const compose = job.params?.compose
      if (!compose) throw new Error('Missing timeline data')
      return api.composeTimeline({
        clips: compose.clips,
        audioClips: compose.audioClips,
        audioLaneFades: compose.audioLaneFades,
        originalVolume: compose.originalVolume,
        originalFadeInSeconds: compose.originalFadeInSeconds,
        originalFadeOutSeconds: compose.originalFadeOutSeconds,
        ducking: compose.ducking,
        outputPath: compose.projectName
          ? projectOutputPath(job.inputPath, compose.projectName, '.timeline')
          : withSuffix(job.inputPath, '.timeline'),
      })
    }
    case 'transcribe': {
      const transcribe = job.params?.transcribe
      if (!transcribe) throw new Error('Missing whisper settings')
      return api.transcribeVideo({
        videoPath: job.inputPath,
        pythonPath: transcribe.pythonPath,
        model: transcribe.model,
        language: transcribe.language,
      })
    }
    case 'transcript-cuts':
      return api.applyTranscriptCuts({
        videoPath: job.inputPath,
        outputPath: withSuffix(job.inputPath, '.edited'),
      })
    case 'burn-subtitles':
      return api.burnSubtitles({
        videoPath: job.inputPath,
        outputPath: withSuffix(job.inputPath, '.karaoke'),
      })
    case 'export':
      return api.exportVideo({
        videoPath: job.inputPath,
        outputPath: withSuffix(job.inputPath, '.export'),
        format: job.params?.format ?? 'mp4',
        quality: job.params?.quality ?? 'medium',
      })
  }
}

let cancelRequested = false

/**
 * Cancel the job that is currently processing: kill its
 * processes in the main process and flag the runner so the job
 * is recorded as cancelled (not failed) when it settles.
 */
export function cancelCurrentJob() {
  if (!activeJobId) return
  cancelRequested = true
  try {
    void window.electronAPI?.cancelActiveProcessing?.()
  } catch {
    /* the job will settle as failed instead */
  }
}

async function processQueue() {
  if (running) return
  const next = useRenderQueue
    .getState()
    .jobs.find((j) => j.status === 'pending')
  if (!next) return

  running = true
  hookProgress()
  const { updateJob } = useRenderQueue.getState()
  const job: RenderJob = {
    ...next,
    status: 'processing',
    progress: 0,
    startedAt: new Date(),
    updatedAt: new Date(),
  }
  updateJob(job)
  activeJobId = job.id

  try {
    const result = await execute(job)
    if (!result.success && cancelRequested) {
      updateJob({
        ...job,
        status: 'cancelled',
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
    } else {
      updateJob({
        ...job,
        status: result.success ? 'completed' : 'failed',
        progress: result.success ? 100 : job.progress,
        outputPath: result.outputPath,
        error: result.success ? undefined : result.error ?? 'Unknown error',
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
    }
  } catch (error) {
    const message = (error as Error).message
    updateJob({
      ...job,
      status: cancelRequested || /cancel/i.test(message) ? 'cancelled' : 'failed',
      error: cancelRequested || /cancel/i.test(message) ? undefined : message,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
  } finally {
    cancelRequested = false
    activeJobId = null
    running = false
    void processQueue()
  }
}
