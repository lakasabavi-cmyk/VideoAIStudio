import { v4 as uuidv4 } from 'uuid'
import { useRenderQueue } from '@/stores/renderQueue'
import { useSettingsStore } from '@/stores/settingsStore'
import type { ProcessResult } from '@/types/ipc'
import type { RenderJob, RenderJobKind, VideoFile } from '@/types'
import { withSuffix, lastFramePath } from './files'

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
        rife: upscale.rife,
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
