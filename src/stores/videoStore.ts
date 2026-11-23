import { create } from 'zustand'
import type { VideoFile, Project } from '@/types'

interface VideoState {
  videos: VideoFile[]
  currentVideo: VideoFile | null
  addVideo: (video: VideoFile) => void
  removeVideo: (id: string) => void
  setCurrentVideo: (video: VideoFile | null) => void
  clearVideos: () => void
}

export const useVideoStore = create<VideoState>((set) => ({
  videos: [],
  currentVideo: null,
  addVideo: (video) =>
    set((state) => ({
      videos: [...state.videos, video],
    })),
  removeVideo: (id) =>
    set((state) => ({
      videos: state.videos.filter((v) => v.id !== id),
    })),
  setCurrentVideo: (video) =>
    set({
      currentVideo: video,
    }),
  clearVideos: () =>
    set({
      videos: [],
      currentVideo: null,
    }),
}))
