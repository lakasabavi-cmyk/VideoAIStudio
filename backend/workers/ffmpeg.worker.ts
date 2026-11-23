import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import path from 'path'
import { shell } from 'electron'
import { FFmpegService, SystemService, LogService } from '../services'
import type {
  VideoImportRequest,
  RemoveSilenceRequest,
  AdjustVolumeRequest,
  GetLastFrameRequest,
  MergeVideosRequest,
  UpscaleRequest,
  AddMusicRequest,
  ExportRequest,
  TrimRequest,
  SplitRequest,
  CropRequest,
  SpeedRequest,
  TransformRequest,
  TimelineThumbsRequest,
  ComposeRequest,
  ThumbnailsRequest,
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
  LogService.log('job', `FAILED: ${message}`)
  if (!event.sender.isDestroyed()) {
    event.sender.send('render:error', message)
  }
  return { success: false, error: message }
}

function done(event: IpcMainInvokeEvent, outputPath: string): ProcessResult {
  LogService.log('job', `done -> ${outputPath}`)
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

  // Trim to [startSeconds, endSeconds]
  ipcMain.handle('ffmpeg:trim', async (event, request: TrimRequest) => {
    try {
      await FFmpegService.trimVideo(
        request.videoPath,
        request.outputPath,
        request.startSeconds,
        request.endSeconds,
        progressFor(event)
      )
      return done(event, request.outputPath)
    } catch (error) {
      return fail(event, error)
    }
  })

  // Split into a parts folder; the first part is the reported output
  ipcMain.handle('ffmpeg:split', async (event, request: SplitRequest) => {
    try {
      const parts = await FFmpegService.splitVideo(
        request.videoPath,
        request.partsDir,
        {
          mode: request.mode,
          atSeconds: request.atSeconds,
          segmentSeconds: request.segmentSeconds,
        },
        progressFor(event)
      )
      if (parts.length === 0) throw new Error('Split produced no files')
      return done(event, parts[0])
    } catch (error) {
      return fail(event, error)
    }
  })

  // Crop to a rectangle
  ipcMain.handle('ffmpeg:crop', async (event, request: CropRequest) => {
    try {
      await FFmpegService.cropVideo(
        request.videoPath,
        request.outputPath,
        { x: request.x, y: request.y, width: request.width, height: request.height },
        progressFor(event)
      )
      return done(event, request.outputPath)
    } catch (error) {
      return fail(event, error)
    }
  })

  // Change playback speed (video + audio)
  ipcMain.handle('ffmpeg:speed', async (event, request: SpeedRequest) => {
    try {
      await FFmpegService.changeSpeed(
        request.videoPath,
        request.outputPath,
        request.factor,
        progressFor(event)
      )
      return done(event, request.outputPath)
    } catch (error) {
      return fail(event, error)
    }
  })

  // Rotate / flip
  ipcMain.handle('ffmpeg:transform', async (event, request: TransformRequest) => {
    try {
      await FFmpegService.transformVideo(
        request.videoPath,
        request.outputPath,
        request.transform,
        progressFor(event)
      )
      return done(event, request.outputPath)
    } catch (error) {
      return fail(event, error)
    }
  })

  // Timeline thumbnail contact sheet (PNG)
  ipcMain.handle('ffmpeg:timelineThumbs', async (event, request: TimelineThumbsRequest) => {
    try {
      await FFmpegService.timelineThumbnails(
        request.videoPath,
        request.outputPath,
        request.columns ?? 5,
        request.rows ?? 2,
        progressFor(event)
      )
      return done(event, request.outputPath)
    } catch (error) {
      return fail(event, error)
    }
  })

  // Compose a timeline (trimmed clips + added-audio track)
  ipcMain.handle(
    'ffmpeg:compose',
    async (event, request: ComposeRequest): Promise<ProcessResult> => {
      try {
        await FFmpegService.composeTimeline(request, progressFor(event))
        return done(event, request.outputPath)
      } catch (error) {
        return fail(event, error)
      }
    }
  )

  // Filmstrip thumbnails for the timeline editor (cached)
  ipcMain.handle(
    'media:thumbnails',
    async (_, request: ThumbnailsRequest) => {
      try {
        const paths = await FFmpegService.extractThumbnails(
          request.videoPath,
          request.startSeconds,
          request.endSeconds,
          request.count
        )
        return { success: true, data: paths }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  // Duration probe that also works for audio-only files
  ipcMain.handle('media:duration', async (_, { filePath }: { filePath: string }) => {
    try {
      const duration = await FFmpegService.getMediaDuration(filePath)
      return { success: true, data: { duration } }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  // App log: tail for the in-app viewer, and open the file itself
  ipcMain.handle('log:getTail', async () => ({
    path: LogService.getFilePath(),
    text: LogService.readTail(300),
  }))

  ipcMain.handle('log:openFile', async () => {
    await shell.openPath(LogService.getFilePath())
    return { success: true }
  })

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
