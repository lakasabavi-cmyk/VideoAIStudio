import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface TimelineVideoClip {
  id: string
  path: string
  name: string
  duration: number
  width: number
  height: number
  /** Keep only [trimStart, trimEnd] of the source clip. */
  trimStart: number
  trimEnd: number
}

export interface TimelineAudioClip {
  id: string
  path: string
  name: string
  duration: number
  /** Playback volume of this clip, 0-100 percent. */
  volume: number
}

interface TimelineState {
  videoClips: TimelineVideoClip[]
  audioClips: TimelineAudioClip[]
  /** Seconds into the timeline where the added-audio track starts. */
  audioStartOffset: number
  /** Volume of the video clips' own audio, 0-100 percent. */
  originalVolume: number
  addVideoClip: (clip: TimelineVideoClip) => void
  addAudioClip: (clip: TimelineAudioClip) => void
  updateVideoClip: (id: string, patch: Partial<TimelineVideoClip>) => void
  updateAudioClip: (id: string, patch: Partial<TimelineAudioClip>) => void
  removeVideoClip: (id: string) => void
  removeAudioClip: (id: string) => void
  moveVideoClip: (from: number, to: number) => void
  moveAudioClip: (from: number, to: number) => void
  setAudioStartOffset: (seconds: number) => void
  setOriginalVolume: (percent: number) => void
  clearTimeline: () => void
}

function move<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) {
    return list
  }
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

// Persisted: a timeline is a project the user builds up over time,
// unlike the render queue it must survive a restart.
export const useTimelineStore = create<TimelineState>()(
  persist(
    (set) => ({
      videoClips: [],
      audioClips: [],
      audioStartOffset: 0,
      originalVolume: 100,
      addVideoClip: (clip) =>
        set((state) => ({ videoClips: [...state.videoClips, clip] })),
      addAudioClip: (clip) =>
        set((state) => ({ audioClips: [...state.audioClips, clip] })),
      updateVideoClip: (id, patch) =>
        set((state) => ({
          videoClips: state.videoClips.map((c) =>
            c.id === id ? { ...c, ...patch } : c
          ),
        })),
      updateAudioClip: (id, patch) =>
        set((state) => ({
          audioClips: state.audioClips.map((c) =>
            c.id === id ? { ...c, ...patch } : c
          ),
        })),
      removeVideoClip: (id) =>
        set((state) => ({
          videoClips: state.videoClips.filter((c) => c.id !== id),
        })),
      removeAudioClip: (id) =>
        set((state) => ({
          audioClips: state.audioClips.filter((c) => c.id !== id),
        })),
      moveVideoClip: (from, to) =>
        set((state) => ({ videoClips: move(state.videoClips, from, to) })),
      moveAudioClip: (from, to) =>
        set((state) => ({ audioClips: move(state.audioClips, from, to) })),
      setAudioStartOffset: (seconds) => set({ audioStartOffset: seconds }),
      setOriginalVolume: (percent) => set({ originalVolume: percent }),
      clearTimeline: () =>
        set({ videoClips: [], audioClips: [], audioStartOffset: 0 }),
    }),
    {
      name: 'videoai-timeline',
      partialize: ({
        videoClips,
        audioClips,
        audioStartOffset,
        originalVolume,
      }) => ({ videoClips, audioClips, audioStartOffset, originalVolume }),
    }
  )
)

/** Total composed duration: the sum of the kept ranges. */
export function timelineDuration(clips: TimelineVideoClip[]): number {
  return clips.reduce(
    (sum, c) => sum + Math.max(0, c.trimEnd - c.trimStart),
    0
  )
}
