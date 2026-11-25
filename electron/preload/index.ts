import { contextBridge, ipcRenderer } from 'electron'
import type {
  RemoveSilenceRequest,
  AdjustVolumeRequest,
  GetLastFrameRequest,
  MergeVideosRequest,
  UpscaleRequest,
  AddMusicRequest,
  ExportRequest,
  TrimRequest,
  SplitRequest,
  CropRequest,
  SpeedRequest,
  TransformRequest,
  TimelineThumbsRequest,
  ComposeRequest,
  ThumbnailsRequest,
  WaveformRequest,
  FrameExtractRequest,
  TranscribeRequest,
  TranscriptData,
  SubtitleExportRequest,
  TranscriptCutsRequest,
  BurnSubtitlesRequest,
  ColorGradeRequest,
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

  trimVideo: (request: TrimRequest) =>
    ipcRenderer.invoke('ffmpeg:trim', request),
  splitVideo: (request: SplitRequest) =>
    ipcRenderer.invoke('ffmpeg:split', request),
  cropVideo: (request: CropRequest) =>
    ipcRenderer.invoke('ffmpeg:crop', request),
  changeSpeed: (request: SpeedRequest) =>
    ipcRenderer.invoke('ffmpeg:speed', request),
  transformVideo: (request: TransformRequest) =>
    ipcRenderer.invoke('ffmpeg:transform', request),
  timelineThumbnails: (request: TimelineThumbsRequest) =>
    ipcRenderer.invoke('ffmpeg:timelineThumbs', request),

  composeTimeline: (request: ComposeRequest) =>
    ipcRenderer.invoke('ffmpeg:compose', request),

  selectFiles: (kind: 'video' | 'audio') =>
    ipcRenderer.invoke('dialog:selectFiles', kind),

  getMediaDuration: (filePath: string) =>
    ipcRenderer.invoke('media:duration', { filePath }),

  extractThumbnails: (request: ThumbnailsRequest) =>
    ipcRenderer.invoke('media:thumbnails', request),
  extractWaveformPeaks: (request: WaveformRequest) =>
    ipcRenderer.invoke('media:waveform', request),

  extractFrameAt: (request: FrameExtractRequest) =>
    ipcRenderer.invoke('media:extractFrame', request),

  openFolder: (filePath: string) =>
    ipcRenderer.invoke('shell:openFolder', filePath),

  deleteFile: (filePath: string) =>
    ipcRenderer.invoke('file:deleteFile', filePath),

  getLogTail: () => ipcRenderer.invoke('log:getTail'),

  transcribeVideo: (request: TranscribeRequest) =>
    ipcRenderer.invoke('transcript:transcribe', request),

  loadTranscript: (request: { videoPath: string }) =>
    ipcRenderer.invoke('transcript:load', request),

  saveTranscript: (request: { videoPath: string; data: TranscriptData }) =>
    ipcRenderer.invoke('transcript:save', request),

  exportSubtitles: (request: SubtitleExportRequest) =>
    ipcRenderer.invoke('transcript:exportSubtitles', request),

  applyTranscriptCuts: (request: TranscriptCutsRequest) =>
    ipcRenderer.invoke('transcript:applyCuts', request),

  burnSubtitles: (request: BurnSubtitlesRequest) =>
    ipcRenderer.invoke('transcript:burnSubtitles', request),

  colorGrade: (request: ColorGradeRequest) =>
    ipcRenderer.invoke('ffmpeg:colorGrade', request),

  selectLutFile: () => ipcRenderer.invoke('dialog:selectLut'),

  openLogFile: () => ipcRenderer.invoke('log:openFile'),

  getSystemStats: () => ipcRenderer.invoke('system:stats'),
  cancelActiveProcessing: () => ipcRenderer.invoke('ffmpeg:cancelActive'),

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
