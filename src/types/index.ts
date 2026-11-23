export interface VideoFile {
  id: string
  path: string
  name: string
  duration: number
  width: number
  height: number
  fps: number
  codec: string
  bitrate: string
  size: number
  createdAt: Date
}

export interface Project {
  id: string
  name: string
  description?: string
  videos: VideoFile[]
  settings: ProjectSettings
  createdAt: Date
  updatedAt: Date
}

export interface ProjectSettings {
  removeSilence: boolean
  silenceThreshold: number
  backgroundMusic?: string
  musicVolume: number
  exportFormat: 'mp4' | 'webm' | 'mov'
  exportQuality: 'low' | 'medium' | 'high'
}

export interface RenderJob {
  id: string
  projectId: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  progress: number
  outputPath?: string
  error?: string
  createdAt: Date
  updatedAt: Date
}

export interface VideoMetadata {
  format: string
  duration: number
  bitrate: number
  width: number
  height: number
  fps: number
  codec: string
  audioCodec?: string
}
