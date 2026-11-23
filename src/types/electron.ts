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
  
  removeSilence: (request: any) => Promise<any>
  addMusic: (videoPath: string, musicPath: string, outputPath: string) => Promise<any>
  exportVideo: (videoPath: string, outputPath: string, format: string, quality: string) => Promise<any>
  
  onRenderProgress: (callback: (progress: number) => void) => void
  onRenderComplete: (callback: () => void) => void
  onRenderError: (callback: (error: string) => void) => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
