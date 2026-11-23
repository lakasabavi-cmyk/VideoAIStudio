import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import path from 'path'
import { FFmpegService } from '../services'
import type {
  VideoImportRequest,
  RemoveSilenceRequest,
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
  return (progress: number) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send('render:progress', progress)
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
  // Import and get metadata
  ipcMain.handle('video:import', async (_, request: VideoImportRequest) => {
    try {
      const metadata = await FFmpegService.getVideoMetadata(request.filePath)
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
  })

  ipcMain.handle('video:metadata', async (_, { videoPath }: { videoPath: string }) => {
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
