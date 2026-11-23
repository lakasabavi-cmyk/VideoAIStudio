import { contextBridge, ipcRenderer } from 'electron'
import type { VideoImportResponse, RemoveSilenceRequest } from '@/types/ipc'

export const preload = {
  // File selection
  selectVideo: () =>
    ipcRenderer.invoke('dialog:selectVideo'),

  // Video operations
  importVideo: (filePath: string) =>
    ipcRenderer.invoke('video:import', { filePath }),

  getVideoMetadata: (videoPath: string) =>
    ipcRenderer.invoke('video:metadata', { videoPath }),

  // FFmpeg operations
  removeSilence: (request: RemoveSilenceRequest) =>
    ipcRenderer.invoke('ffmpeg:removeSilence', request),

  addMusic: (videoPath: string, musicPath: string, outputPath: string) =>
    ipcRenderer.invoke('ffmpeg:addMusic', { videoPath, musicPath, outputPath }),

  exportVideo: (videoPath: string, outputPath: string, format: string, quality: string) =>
    ipcRenderer.invoke('ffmpeg:export', { videoPath, outputPath, format, quality }),

  // Progress tracking
  onRenderProgress: (callback: (progress: number) => void) =>
    ipcRenderer.on('render:progress', (_, progress) => callback(progress)),

  onRenderComplete: (callback: () => void) =>
    ipcRenderer.on('render:complete', () => callback()),

  onRenderError: (callback: (error: string) => void) =>
    ipcRenderer.on('render:error', (_, error) => callback(error)),
}

contextBridge.exposeInMainWorld('electronAPI', preload)

declare global {
  interface Window {
    electronAPI: typeof preload
  }
}
