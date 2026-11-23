import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import path from 'path'
import { FFmpegService, SystemService } from '../services'
import type {
  VideoImportRequest,
  RemoveSilenceRequest,
  AdjustVolumeRequest,
  GetLastFrameRequest,
  MergeVideosRequest,
  UpscaleRequest,
  AddMusicRequest,
  ExportRequest,
  ProcessResult,
} from '@/types/ipc'

/**
 * Forward ffmpeg progress to the window that started the job.
 * The renderer listens on 'render:progress' (see preload); jobs run
 * one at a time in the renderer queue, so a single progress stream
 * is unambiguous.
 */
function progressFor(event: IpcMainInvokeEvent) {
  return (progress: number, stage?: string) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send('render:progress', { progress, stage })
    }
  }
}

function fail(event: IpcMainInvokeEvent, error: unknown): ProcessResult {
  const message = (error as Error).message
  if (!event.sender.isDestroyed()) {
    event.sender.send('render:error', message)
  }
  return { success: false, error: message }
}

function done(event: IpcMainInvokeEvent, outputPath: string): ProcessResult {
  if (!event.sender.isDestroyed()) {
    event.sender.send('render:complete')
  }
  return { success: true, outputPath }
}

export function setupFFmpegWorkers() {
  // One implementation behind both channels: 'video:import' (called by
  // preload.importVideo with { filePath }) and 'video:metadata' (called
  // by preload.getMetadata with { videoPath }) used to duplicate the
  // same getVideoMetadata call. Both channels stay — preload and the
  // renderer already use both — but they now share this helper.
  async function loadVideoMetadata(videoPath: string) {
    try {
      const metadata = await FFmpegService.getVideoMetadata(videoPath)
      return {
        success: true,
        data: metadata,
      }
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
      }
    }
  }

  // Import and get metadata
  ipcMain.handle('video:import', async (_, request: VideoImportRequest) => {
    return loadVideoMetadata(request.filePath)
  })

  ipcMain.handle('video:metadata', async (_, { videoPath }: { videoPath: string }) => {
    return loadVideoMetadata(videoPath)
  })

  // Remove silence
  ipcMain.handle(
    'ffmpeg:removeSilence',
    async (event, request: RemoveSilenceRequest): Promise<ProcessResult> => {
      try {
        // "clip.mp4" -> "clip.nosil.mp4" next to the source file,
        // unless the caller chose the output path itself.
        const parsed = path.parse(request.videoPath)
        const outputPath =
          request.outputPath ??
          path.join(parsed.dir, `${parsed.name}.nosil.mp4`)
        await FFmpegService.removeSilence(
          request.videoPath,
          outputPath,
          request.threshold,
          progressFor(event)
        )
        return done(event, outputPath)
      } catch (error) {
        return fail(event, error)
      }
    }
  )

  // Adjust the original track's volume (0 = mute)
  ipcMain.handle(
    'ffmpeg:adjustVolume',
    async (event, request: AdjustVolumeRequest): Promise<ProcessResult> => {
      try {
        const parsed = path.parse(request.videoPath)
        const outputPath =
          request.outputPath ??
          path.join(parsed.dir, `${parsed.name}.vol.mp4`)
        await FFmpegService.adjustVolume(
          request.videoPath,
          outputPath,
          request.volume,
          progressFor(event)
        )
        return done(event, outputPath)
      } catch (error) {
        return fail(event, error)
      }
    }
  )

  // Get last frame (saved into a "first frame" folder)
  ipcMain.handle(
    'ffmpeg:getLastFrame',
    async (event, request: GetLastFrameRequest): Promise<ProcessResult> => {
      try {
        const parsed = path.parse(request.videoPath)
        const outputPath =
          request.outputPath ??
          path.join(
            parsed.dir,
            'first frame',
            `${parsed.name}_lastframe.png`
          )
        await FFmpegService.extractLastFrame(
          request.videoPath,
          outputPath,
          progressFor(event)
        )
        return done(event, outputPath)
      } catch (error) {
        return fail(event, error)
      }
    }
  )

  // Merge videos (first frame of each following clip is dropped)
  ipcMain.handle(
    'ffmpeg:merge',
    async (event, request: MergeVideosRequest): Promise<ProcessResult> => {
      try {
        await FFmpegService.mergeVideos(
          request.videoPaths,
          request.outputPath,
          progressFor(event)
        )
        return done(event, request.outputPath)
      } catch (error) {
        return fail(event, error)
      }
    }
  )

  // Cancel the currently running job's processes
  ipcMain.handle('ffmpeg:cancelActive', async () => FFmpegService.cancelActive())

  // System monitor (CPU / RAM / GPU / temperatures)
  ipcMain.handle('system:stats', async () => SystemService.getStats())

  // Upscale (Lanczos quick, or Real-ESRGAN ncnn-vulkan pipeline)
  ipcMain.handle(
    'ffmpeg:upscale',
    async (event, request: UpscaleRequest): Promise<ProcessResult> => {
      try {
        if (request.method === 'realesrgan') {
          await FFmpegService.upscaleRealEsrgan(request, progressFor(event))
        } else {
          await FFmpegService.upscaleLanczos(
            request.videoPath,
            request.outputPath,
            request.targetHeight ?? 1080,
            progressFor(event)
          )
        }
        return done(event, request.outputPath)
      } catch (error) {
        return fail(event, error)
      }
    }
  )

  // Add music
  ipcMain.handle(
    'ffmpeg:addMusic',
    async (event, request: AddMusicRequest): Promise<ProcessResult> => {
      try {
        await FFmpegService.addBackgroundMusic(
          request.videoPath,
          request.musicPath,
          request.outputPath,
          request.musicVolume,
          request.originalVolume ?? 1,
          progressFor(event)
        )
        return done(event, request.outputPath)
      } catch (error) {
        return fail(event, error)
      }
    }
  )

  // Export
  ipcMain.handle(
    'ffmpeg:export',
    async (event, request: ExportRequest): Promise<ProcessResult> => {
      try {
        await FFmpegService.exportVideo(
          request.videoPath,
          request.outputPath,
          request.quality,
          progressFor(event)
        )
        return done(event, request.outputPath)
      } catch (error) {
        return fail(event, error)
      }
    }
  )
}
