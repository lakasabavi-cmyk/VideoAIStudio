import { v4 as uuidv4 } from 'uuid'
import { useRenderQueue } from '@/stores/renderQueue'
import { useSettingsStore } from '@/stores/settingsStore'
import type { ProcessResult } from '@/types/ipc'
import type { RenderJob, RenderJobKind, VideoFile } from '@/types'
import { withSuffix, lastFramePath, partsDirPath } from './files'

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
  4: 'realesrgan-x4plus',
} as const

export function enqueueUpscale(video: VideoFile): string | null {
  const settings = useSettingsStore.getState()
  if (settings.upscaleMethod === 'realesrgan') {
    if (!settings.esrganPath.trim()) {
      return 'Set the Real-ESRGAN executable path in Settings first.'
    }
    const rife = settings.rifeEnabled
      ? {
          exePath: settings.rifePath,
          modelPath: settings.rifeModelPath,
          multiplier: settings.rifeMultiplier,
        }
      : undefined
    if (settings.rifeEnabled && !settings.rifePath.trim()) {
      return 'RIFE is enabled but its executable path is not set in Settings.'
    }
    enqueue(
      baseJob('upscale', video, {
        upscale: {
          method: 'realesrgan',
          scale: settings.esrganScale,
          model: ESRGAN_MODELS[settings.esrganScale],
          exePath: settings.esrganPath,
          modelsPath: settings.esrganModelsPath,
          tileSize: settings.esrganTileSize,
          rife,
          outputSuffix:
            `_${settings.esrganScale}x` +
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
 * Export the timeline composition: trimmed video clips in order,
 * their own audio at originalVolume, and the added-audio clips
 * mixed over the top. Returns an error message instead of
 * enqueueing when the timeline is empty.
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
  }[]
  audioClips: { path: string; volume: number }[]
  audioStartOffset: number
  originalVolume: number
}): string | null {
  if (timeline.videoClips.length === 0) {
    return 'Add at least one video clip to the timeline first.'
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
  const job = baseJob('compose', pseudo, {
    compose: {
      clips: timeline.videoClips.map((c) => ({
        path: c.path,
        startSeconds: c.trimStart,
        endSeconds: c.trimEnd,
      })),
      audioClips: timeline.audioClips.map((a) => ({
        path: a.path,
        volume: a.volume / 100,
      })),
      audioStartOffset: timeline.audioStartOffset,
      originalVolume: timeline.originalVolume / 100,
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
        audioStartOffset: compose.audioStartOffset,
        originalVolume: compose.originalVolume,
        outputPath: withSuffix(job.inputPath, '.timeline'),
      })
    }
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
