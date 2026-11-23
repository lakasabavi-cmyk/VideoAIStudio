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
  window.electronAPI.onRenderProgress((progress) => {
    if (!activeJobId) return
    const { jobs, updateJob } = useRenderQueue.getState()
    const job = jobs.find((j) => j.id === activeJobId)
    if (job && job.status === 'processing') {
      const pct = Math.max(0, Math.min(100, Math.round(progress)))
      if (Number.isFinite(pct) && pct !== job.progress) {
        updateJob({ ...job, progress: pct, updatedAt: new Date() })
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
    case 'export':
      return api.exportVideo({
        videoPath: job.inputPath,
        outputPath: withSuffix(job.inputPath, '.export'),
        format: job.params?.format ?? 'mp4',
        quality: job.params?.quality ?? 'medium',
      })
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
    updatedAt: new Date(),
  }
  updateJob(job)
  activeJobId = job.id

  try {
    const result = await execute(job)
    updateJob({
      ...job,
      status: result.success ? 'completed' : 'failed',
      progress: result.success ? 100 : job.progress,
      outputPath: result.outputPath,
      error: result.success ? undefined : result.error ?? 'Unknown error',
      updatedAt: new Date(),
    })
  } catch (error) {
    updateJob({
      ...job,
      status: 'failed',
      error: (error as Error).message,
      updatedAt: new Date(),
    })
  } finally {
    activeJobId = null
    running = false
    void processQueue()
  }
}
