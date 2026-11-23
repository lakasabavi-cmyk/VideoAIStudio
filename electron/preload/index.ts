import { contextBridge, ipcRenderer } from 'electron'
import type {
  RemoveSilenceRequest,
  AdjustVolumeRequest,
  GetLastFrameRequest,
  MergeVideosRequest,
  UpscaleRequest,
  AddMusicRequest,
  ExportRequest,
} from '@/types/ipc'

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

  adjustVolume: (request: AdjustVolumeRequest) =>
    ipcRenderer.invoke('ffmpeg:adjustVolume', request),

  getLastFrame: (request: GetLastFrameRequest) =>
    ipcRenderer.invoke('ffmpeg:getLastFrame', request),

  mergeVideos: (request: MergeVideosRequest) =>
    ipcRenderer.invoke('ffmpeg:merge', request),

  upscaleVideo: (request: UpscaleRequest) =>
    ipcRenderer.invoke('ffmpeg:upscale', request),

  addMusic: (request: AddMusicRequest) =>
    ipcRenderer.invoke('ffmpeg:addMusic', request),

  exportVideo: (request: ExportRequest) =>
    ipcRenderer.invoke('ffmpeg:export', request),

  // Progress tracking
  onRenderProgress: (callback: (update: { progress: number; stage?: string }) => void) =>
    ipcRenderer.on('render:progress', (_, payload) =>
      callback(
        typeof payload === 'number' ? { progress: payload } : payload
      )
    ),

  onRenderComplete: (callback: () => void) =>
    ipcRenderer.on('render:complete', () => callback()),

  onRenderError: (callback: (error: string) => void) =>
    ipcRenderer.on('render:error', (_, error) => callback(error)),
}

contextBridge.exposeInMainWorld('electronAPI', preload)

// Note: the Window.electronAPI type for the renderer is declared once
// in src/types/electron.ts. Declaring it here too (as typeof preload)
// conflicts with that declaration when both files are type-checked.
