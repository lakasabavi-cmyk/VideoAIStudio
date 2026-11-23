import { ipcMain } from 'electron'
import { FFmpegService } from '../services'
import type {
  VideoImportRequest,
  RemoveSilenceRequest,
  AddMusicRequest,
  ExportRequest,
} from '@/types/ipc'

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
    async (_, request: RemoveSilenceRequest) => {
      try {
        const outputPath = `${request.videoPath}.nosil.mp4`
        await FFmpegService.removeSilence(
          request.videoPath,
          outputPath,
          request.threshold,
          (progress) => {
            // Send progress to renderer
          }
        )
        return { success: true }
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
        }
      }
    }
  )

  // Add music
  ipcMain.handle(
    'ffmpeg:addMusic',
    async (_, request: AddMusicRequest) => {
      try {
        await FFmpegService.addBackgroundMusic(
          request.videoPath,
          request.musicPath,
          request.outputPath,
          request.musicVolume,
          (progress) => {
            // Send progress
          }
        )
        return { success: true }
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
        }
      }
    }
  )

  // Export
  ipcMain.handle(
    'ffmpeg:export',
    async (_, request: ExportRequest) => {
      try {
        await FFmpegService.exportVideo(
          request.videoPath,
          request.outputPath,
          request.quality,
          (progress) => {
            // Send progress
          }
        )
        return { success: true }
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
        }
      }
    }
  )
}
