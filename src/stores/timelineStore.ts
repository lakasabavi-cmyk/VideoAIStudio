import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type AudioKind = 'voice' | 'music' | 'sfx'

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
  /** Absolute start time of this clip on the timeline (seconds). */
  offset: number
  /** Smart Concat: start one frame in (drops the duplicated
   * last frame of the previous clip in a last-frame chain). */
  dropFirstFrame: boolean
  /** Source frame rate, when known (frame-accurate splitting). */
  fps?: number
}

export interface TimelineAudioClip {
  id: string
  path: string
  name: string
  duration: number
  /** Playback volume of this clip, 0-100 percent. */
  volume: number
  /** Which lane the clip lives on: Voice, Music or SFX. */
  kind: AudioKind
  trimStart: number
  trimEnd: number
}

export type LaneOffsets = Record<AudioKind, number>
export type LaneVolumes = Record<AudioKind, number>
export interface LaneFade {
  fadeIn: number
  fadeOut: number
}
export type LaneFades = Record<AudioKind, LaneFade>

export const defaultLaneVolumes = (): LaneVolumes => ({
  voice: 100,
  music: 100,
  sfx: 100,
})
export const defaultLaneFades = (): LaneFades => ({
  voice: { fadeIn: 0, fadeOut: 0 },
  music: { fadeIn: 0, fadeOut: 0 },
  sfx: { fadeIn: 0, fadeOut: 0 },
})

interface TimelineState {
  videoClips: TimelineVideoClip[]
  audioClips: TimelineAudioClip[]
  /** Start time of each audio lane (seconds into the timeline). */
  laneOffsets: LaneOffsets
  /** Volume of the video clips' own audio, 0-100 percent. */
  originalVolume: number
  /** Video-track audio fades, seconds. */
  videoFadeIn: number
  videoFadeOut: number
  /** Per-lane (track) volume, 0-100 percent. */
  laneVolumes: LaneVolumes
  /** Per-lane (track) audio fades, seconds. */
  laneFades: LaneFades
  /** Ripple edit: trims/deletes pull later clips along. */
  ripple: boolean
  addVideoClip: (clip: TimelineVideoClip) => void
  addAudioClip: (clip: TimelineAudioClip) => void
  updateVideoClip: (id: string, patch: Partial<TimelineVideoClip>) => void
  updateAudioClip: (id: string, patch: Partial<TimelineAudioClip>) => void
  removeVideoClip: (id: string) => void
  removeAudioClip: (id: string) => void
  moveVideoClip: (from: number, to: number) => void
  moveAudioClip: (from: number, to: number) => void
  setLaneOffset: (kind: AudioKind, seconds: number) => void
  setLaneVolume: (kind: AudioKind, percent: number) => void
  setLaneFade: (kind: AudioKind, which: 'fadeIn' | 'fadeOut', seconds: number) => void
  setVideoFades: (patch: { fadeIn?: number; fadeOut?: number }) => void
  splitVideoClip: (id: string, atSeconds: number) => boolean
  splitAudioClip: (id: string, atSeconds: number) => boolean
  setOriginalVolume: (percent: number) => void
  setRipple: (on: boolean) => void
  reflowVideo: () => void
  clearTimeline: () => void
}

export const keptVideo = (c: TimelineVideoClip) =>
  Math.max(0, c.trimEnd - c.trimStart)
export const keptAudio = (c: TimelineAudioClip) =>
  Math.max(0, c.trimEnd - c.trimStart)

/** Recompute offsets so clips sit end to end in array order. */
export function flowOffsets(clips: TimelineVideoClip[]): TimelineVideoClip[] {
  let cursor = 0
  return clips.map((c) => {
    const next = { ...c, offset: cursor }
    cursor += keptVideo(c)
    return next
  })
}

/** End of the video track (last clip's offset + kept length). */
export function videoTrackEnd(clips: TimelineVideoClip[]): number {
  return clips.reduce((max, c) => Math.max(max, c.offset + keptVideo(c)), 0)
}

/** How far a clip may grow (trimEnd) without overlapping the next. */
export function maxKeptWithoutOverlap(
  clips: TimelineVideoClip[],
  clip: TimelineVideoClip
): number {
  const later = clips
    .filter((c) => c.id !== clip.id && c.offset > clip.offset)
    .sort((a, b) => a.offset - b.offset)[0]
  if (!later) return clip.duration - clip.trimStart
  return Math.max(0.1, later.offset - clip.offset)
}

/** Absolute start of an audio clip: its lane offset plus the kept
 * lengths of the clips before it in the same lane. */
export function audioStartAbs(
  clip: TimelineAudioClip,
  all: TimelineAudioClip[],
  laneOffsets: LaneOffsets
): number {
  let start = laneOffsets[clip.kind] ?? 0
  for (const other of all) {
    if (other.id === clip.id) break
    if (other.kind === clip.kind) start += keptAudio(other)
  }
  return start
}

/**
 * Fill in fields that older saved timelines (v1) do not have, so a
 * state saved before the pro upgrade keeps working.
 */
export function normalizeTimeline(state: {
  videoClips: TimelineVideoClip[]
  audioClips: TimelineAudioClip[]
  laneOffsets?: LaneOffsets
  audioStartOffset?: number
}): {
  videoClips: TimelineVideoClip[]
  audioClips: TimelineAudioClip[]
  laneOffsets: LaneOffsets
  laneVolumes: LaneVolumes
  laneFades: LaneFades
  videoFadeIn: number
  videoFadeOut: number
} {
  let videoClips = state.videoClips.map((c) => ({
    ...c,
    dropFirstFrame: c.dropFirstFrame ?? false,
    offset: typeof c.offset === 'number' ? c.offset : Number.NaN,
  }))
  if (videoClips.some((c) => !Number.isFinite(c.offset))) {
    videoClips = flowOffsets(videoClips)
  }
  const audioClips = state.audioClips.map((c) => ({
    ...c,
    kind: c.kind ?? 'music',
    trimStart: c.trimStart ?? 0,
    trimEnd: c.trimEnd ?? c.duration,
  }))
  const laneOffsets: LaneOffsets = state.laneOffsets ?? {
    voice: 0,
    music: state.audioStartOffset ?? 0,
    sfx: 0,
  }
  const partial = state as unknown as {
    laneVolumes?: LaneVolumes
    laneFades?: LaneFades
    videoFadeIn?: number
    videoFadeOut?: number
  }
  return {
    videoClips,
    audioClips,
    laneOffsets,
    laneVolumes: { ...defaultLaneVolumes(), ...(partial.laneVolumes ?? {}) },
    laneFades: {
      voice: { ...defaultLaneFades().voice, ...(partial.laneFades?.voice ?? {}) },
      music: { ...defaultLaneFades().music, ...(partial.laneFades?.music ?? {}) },
      sfx: { ...defaultLaneFades().sfx, ...(partial.laneFades?.sfx ?? {}) },
    },
    videoFadeIn: partial.videoFadeIn ?? 0,
    videoFadeOut: partial.videoFadeOut ?? 0,
  }
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
    (set, get) => ({
      videoClips: [],
      audioClips: [],
      laneOffsets: { voice: 0, music: 0, sfx: 0 },
      originalVolume: 100,
      videoFadeIn: 0,
      videoFadeOut: 0,
      laneVolumes: defaultLaneVolumes(),
      laneFades: defaultLaneFades(),
      ripple: true,
      addVideoClip: (clip) =>
        set((state) => {
          const atEnd = { ...clip, offset: videoTrackEnd(state.videoClips) }
          return { videoClips: [...state.videoClips, atEnd] }
        }),
      addAudioClip: (clip) =>
        set((state) => ({ audioClips: [...state.audioClips, clip] })),
      updateVideoClip: (id, patch) =>
        set((state) => {
          const videoClips = state.videoClips.map((c) =>
            c.id === id ? { ...c, ...patch } : c
          )
          return {
            videoClips: state.ripple ? flowOffsets(videoClips) : videoClips,
          }
        }),
      updateAudioClip: (id, patch) =>
        set((state) => ({
          audioClips: state.audioClips.map((c) =>
            c.id === id ? { ...c, ...patch } : c
          ),
        })),
      removeVideoClip: (id) =>
        set((state) => {
          const videoClips = state.videoClips.filter((c) => c.id !== id)
          return {
            videoClips: state.ripple ? flowOffsets(videoClips) : videoClips,
          }
        }),
      removeAudioClip: (id) =>
        set((state) => ({
          audioClips: state.audioClips.filter((c) => c.id !== id),
        })),
      moveVideoClip: (from, to) =>
        set((state) => {
          const moved = move(state.videoClips, from, to)
          if (state.ripple) return { videoClips: flowOffsets(moved) }
          // Without ripple, the two clips swap places in time.
          const a = moved[to]
          const b = moved[from]
          if (a && b && a.id !== b.id) {
            const swapped = moved.map((c) => {
              if (c.id === a.id) return { ...c, offset: b.offset }
              if (c.id === b.id) return { ...c, offset: a.offset }
              return c
            })
            return { videoClips: swapped }
          }
          return { videoClips: moved }
        }),
      moveAudioClip: (from, to) =>
        set((state) => ({ audioClips: move(state.audioClips, from, to) })),
      setLaneOffset: (kind, seconds) =>
        set((state) => ({
          laneOffsets: { ...state.laneOffsets, [kind]: Math.max(0, seconds) },
        })),
      setLaneVolume: (kind, percent) =>
        set((state) => ({
          laneVolumes: {
            ...(state.laneVolumes ?? defaultLaneVolumes()),
            [kind]: Math.max(0, Math.min(100, percent)),
          },
        })),
      setLaneFade: (kind, which, seconds) =>
        set((state) => {
          const fades = state.laneFades ?? defaultLaneFades()
          return {
            laneFades: {
              ...fades,
              [kind]: {
                ...fades[kind],
                [which]: Math.max(0, seconds),
              },
            },
          }
        }),
      setVideoFades: (patch) =>
        set((state) => ({
          videoFadeIn:
            patch.fadeIn !== undefined
              ? Math.max(0, patch.fadeIn)
              : state.videoFadeIn ?? 0,
          videoFadeOut:
            patch.fadeOut !== undefined
              ? Math.max(0, patch.fadeOut)
              : state.videoFadeOut ?? 0,
        })),
      splitVideoClip: (id, at) => {
        const state = get()
        const clip = state.videoClips.find((c) => c.id === id)
        if (!clip) return false
        const kept = keptVideo(clip)
        const local = at - clip.offset
        if (local <= 0.05 || local >= kept - 0.05) return false
        let sourceT = clip.trimStart + local
        if (clip.dropFirstFrame && clip.fps) sourceT += 1 / clip.fps
        sourceT = Math.min(sourceT, clip.trimEnd - 0.05)
        const round3 = (n: number) => Math.round(n * 1000) / 1000
        const right: TimelineVideoClip = {
          ...clip,
          id: `${id}-split-${Date.now()}`,
          trimStart: round3(sourceT),
          offset: clip.offset + local,
          dropFirstFrame: false,
        }
        const left = { ...clip, trimEnd: round3(sourceT) }
        const next = state.videoClips.flatMap((c) =>
          c.id === id ? [left, right] : [c]
        )
        set({
          videoClips: state.ripple ? flowOffsets(next) : next,
        })
        return true
      },
      splitAudioClip: (id, at) => {
        const state = get()
        const clip = state.audioClips.find((c) => c.id === id)
        if (!clip) return false
        const start = audioStartAbs(
          clip,
          state.audioClips,
          state.laneOffsets
        )
        const local = at - start
        const kept = keptAudio(clip)
        if (local <= 0.05 || local >= kept - 0.05) return false
        const round3 = (n: number) => Math.round(n * 1000) / 1000
        const sourceT = round3(clip.trimStart + local)
        const right: TimelineAudioClip = {
          ...clip,
          id: `${id}-split-${Date.now()}`,
          trimStart: sourceT,
        }
        const left = { ...clip, trimEnd: sourceT }
        set({
          audioClips: state.audioClips.flatMap((c) =>
            c.id === id ? [left, right] : [c]
          ),
        })
        return true
      },
      setOriginalVolume: (percent) => set({ originalVolume: percent }),
      setRipple: (on) => {
        set({ ripple: on })
        if (on) get().reflowVideo()
      },
      reflowVideo: () =>
        set((state) => ({ videoClips: flowOffsets(state.videoClips) })),
      clearTimeline: () =>
        set({
          videoClips: [],
          audioClips: [],
          laneOffsets: { voice: 0, music: 0, sfx: 0 },
        }),
    }),
    {
      name: 'videoai-timeline',
      partialize: ({
        videoClips,
        audioClips,
        laneOffsets,
        originalVolume,
        videoFadeIn,
        videoFadeOut,
        laneVolumes,
        laneFades,
        ripple,
      }) => ({
        videoClips,
        audioClips,
        laneOffsets,
        originalVolume,
        videoFadeIn,
        videoFadeOut,
        laneVolumes,
        laneFades,
        ripple,
      }),
    }
  )
)

/** Total composed duration = end of the video track. */
export function timelineDuration(clips: TimelineVideoClip[]): number {
  return videoTrackEnd(clips)
}
