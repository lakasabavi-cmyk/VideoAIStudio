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
  threshold: number
  projectId: string
}

export interface AddMusicRequest {
  videoPath: string
  musicPath: string
  musicVolume: number
  outputPath: string
}

export interface ExportRequest {
  videoPath: string
  outputPath: string
  format: 'mp4' | 'webm' | 'mov'
  quality: 'low' | 'medium' | 'high'
}
