import type {
  RemoveSilenceRequest,
  AdjustVolumeRequest,
  GetLastFrameRequest,
  AddMusicRequest,
  ExportRequest,
  ProcessResult,
} from './ipc'

export interface ElectronAPI {
  selectVideo: () => Promise<{
    success: boolean
    data?: {
      filePath: string
      fileSize: number
      fileName: string
    }
    error?: string
  }>
  
  importVideo: (filePath: string) => Promise<{
    success: boolean
    data?: any
    error?: string
  }>
  
  getVideoMetadata: (videoPath: string) => Promise<{
    success: boolean
    data?: {
      format: string
      duration: number
      bitrate: number
      width: number
      height: number
      fps: number
      codec: string
      audioCodec?: string
    }
    error?: string
  }>
  
  removeSilence: (request: RemoveSilenceRequest) => Promise<ProcessResult>
  adjustVolume: (request: AdjustVolumeRequest) => Promise<ProcessResult>
  getLastFrame: (request: GetLastFrameRequest) => Promise<ProcessResult>
  addMusic: (request: AddMusicRequest) => Promise<ProcessResult>
  exportVideo: (request: ExportRequest) => Promise<ProcessResult>
  
  onRenderProgress: (callback: (progress: number) => void) => void
  onRenderComplete: (callback: () => void) => void
  onRenderError: (callback: (error: string) => void) => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
