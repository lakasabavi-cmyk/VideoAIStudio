import type {
  RemoveSilenceRequest,
  AdjustVolumeRequest,
  GetLastFrameRequest,
  MergeVideosRequest,
  UpscaleRequest,
  RenderProgressUpdate,
  SystemStats,
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
  mergeVideos: (request: MergeVideosRequest) => Promise<ProcessResult>
  upscaleVideo: (request: UpscaleRequest) => Promise<ProcessResult>
  getSystemStats: () => Promise<SystemStats>
  /** Kill the processes of the currently running job. */
  cancelActiveProcessing: () => Promise<number>
  addMusic: (request: AddMusicRequest) => Promise<ProcessResult>
  exportVideo: (request: ExportRequest) => Promise<ProcessResult>
  
  onRenderProgress: (callback: (update: RenderProgressUpdate) => void) => void
  onRenderComplete: (callback: () => void) => void
  onRenderError: (callback: (error: string) => void) => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
