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
  TrimRequest,
  SplitRequest,
  CropRequest,
  SpeedRequest,
  TransformRequest,
  TimelineThumbsRequest,
  ComposeRequest,
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
  trimVideo: (request: TrimRequest) => Promise<ProcessResult>
  splitVideo: (request: SplitRequest) => Promise<ProcessResult>
  cropVideo: (request: CropRequest) => Promise<ProcessResult>
  changeSpeed: (request: SpeedRequest) => Promise<ProcessResult>
  transformVideo: (request: TransformRequest) => Promise<ProcessResult>
  timelineThumbnails: (request: TimelineThumbsRequest) => Promise<ProcessResult>
  composeTimeline: (request: ComposeRequest) => Promise<ProcessResult>
  selectFiles: (kind: 'video' | 'audio') => Promise<{
    success: boolean
    data?: { filePath: string; fileName: string; fileSize: number }[]
    error?: string
  }>
  getMediaDuration: (filePath: string) => Promise<{
    success: boolean
    data?: { duration: number }
    error?: string
  }>
  getLogTail: () => Promise<{ path: string; text: string }>
  openLogFile: () => Promise<{ success: boolean }>
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
