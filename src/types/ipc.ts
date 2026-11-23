export interface IpcMessage<T = any> {
  type: string
  payload: T
  id?: string
}

export interface VideoImportRequest {
  filePath: string
}

export interface VideoImportResponse {
  id: string
  name: string
  path: string
  metadata: {
    duration: number
    width: number
    height: number
    fps: number
    codec: string
    bitrate: string
  }
}

export interface RemoveSilenceRequest {
  videoPath: string
  threshold?: number
  outputPath?: string
}

export interface AdjustVolumeRequest {
  videoPath: string
  /** Volume of the original audio track, 0-1 (0 = fully muted). */
  volume: number
  outputPath?: string
}

export interface GetLastFrameRequest {
  videoPath: string
  outputPath?: string
}

export interface MergeVideosRequest {
  videoPaths: string[]
  outputPath: string
}

export interface AddMusicRequest {
  videoPath: string
  musicPath: string
  musicVolume: number
  /** Volume of the original track in the mix, 0-1 (0 = muted). */
  originalVolume?: number
  outputPath: string
}

export interface ExportRequest {
  videoPath: string
  outputPath: string
  format: 'mp4' | 'webm' | 'mov'
  quality: 'low' | 'medium' | 'high'
}

/** Result returned by every ffmpeg processing handler. */
export interface ProcessResult {
  success: boolean
  outputPath?: string
  error?: string
}
