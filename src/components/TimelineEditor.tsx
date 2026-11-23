import { FC, useEffect, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import {
  Plus,
  X,
  Film,
  Download,
  Trash2,
  Play,
  Pause,
  Scissors,
  Magnet,
  Link2,
} from 'lucide-react'
import {
  useTimelineStore,
  keptVideo,
  keptAudio,
  videoTrackEnd,
  audioStartAbs,
  maxKeptWithoutOverlap,
  normalizeTimeline,
  type TimelineVideoClip,
  type TimelineAudioClip,
  type AudioKind,
} from '@/stores/timelineStore'
import { useVideoStore } from '@/stores/videoStore'
import { enqueueCompose } from '@/lib/jobRunner'
import { toFileUrl } from '@/lib/files'

const VIDEO_EXTS = ['mp4', 'mov', 'mkv', 'avi', 'webm', 'flv', 'wmv']
const AUDIO_EXTS = ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg']
const LANES: { kind: AudioKind; label: string; color: string; ring: string }[] = [
  { kind: 'voice', label: 'Voice', color: 'bg-emerald-600/30', ring: 'border-emerald-400' },
  { kind: 'music', label: 'Music', color: 'bg-violet-600/30', ring: 'border-violet-400' },
  { kind: 'sfx', label: 'SFX', color: 'bg-amber-600/30', ring: 'border-amber-400' },
]

function baseName(filePath: string): string {
  const parts = filePath.split(/[\\/]/)
  return parts[parts.length - 1] || filePath
}
function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}
function fmtT(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const m = Math.floor(seconds / 60)
  const s = seconds - m * 60
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`
}

/** Filmstrip of real frames across the clip's kept range. */
const Filmstrip: FC<{ clip: TimelineVideoClip }> = ({ clip }) => {
  const [urls, setUrls] = useState<string[]>([])
  const kept = keptVideo(clip)
  const count = Math.max(1, Math.min(14, Math.ceil(kept / 1.2)))
  const key = `${clip.path}|${clip.trimStart.toFixed(1)}|${clip.trimEnd.toFixed(1)}|${count}`
  useEffect(() => {
    let alive = true
    const timer = setTimeout(async () => {
      try {
        const result = await window.electronAPI.extractThumbnails({
          videoPath: clip.path,
          startSeconds: clip.trimStart,
          endSeconds: clip.trimEnd,
          count,
        })
        if (alive && result.success && result.data) {
          setUrls(result.data.map((p) => toFileUrl(p)))
        }
      } catch {
        /* thumbnails are decorative; the editor works without them */
      }
    }, 350)
    return () => {
      alive = false
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  if (urls.length === 0) {
    return <div className="absolute inset-0 bg-gray-800" />
  }
  return (
    <div className="absolute inset-0 flex overflow-hidden">
      {urls.map((u, i) => (
        <img
          key={i}
          src={u}
          alt=""
          draggable={false}
          className="h-full flex-1 min-w-0 object-cover"
        />
      ))}
    </div>
  )
}

interface DragState {
  track: 'video' | 'audio'
  id: string
  mode: 'move' | 'trim-left' | 'trim-right'
  startX: number
  origStart: number
  origEnd: number
  dx: number
  moved: boolean
}

interface TimelineEditorProps {
  onMessage: (message: string) => void
}

export const TimelineEditor: FC<TimelineEditorProps> = ({ onMessage }) => {
  const store = useTimelineStore()
  const {
    videoClips,
    audioClips,
    laneOffsets,
    originalVolume,
    ripple,
  } = store
  const { videos, currentVideo, setCurrentVideo } = useVideoStore()
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null)
  const [selectedAudioId, setSelectedAudioId] = useState<string | null>(null)
  const [importPick, setImportPick] = useState('')
  const [pxPerSec, setPxPerSec] = useState(14)
  const [playhead, setPlayhead] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [activeClipId, setActiveClipId] = useState<string | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const playingRef = useRef(false)
  const pendingSeekRef = useRef<number | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Upgrade a v1-saved timeline (no offsets / kinds) on first mount.
  useEffect(() => {
    const s = useTimelineStore.getState()
    const n = normalizeTimeline(s)
    if (
      JSON.stringify(n.videoClips) !== JSON.stringify(s.videoClips) ||
      JSON.stringify(n.audioClips) !== JSON.stringify(s.audioClips) ||
      JSON.stringify(n.laneOffsets) !== JSON.stringify(s.laneOffsets)
    ) {
      useTimelineStore.setState({
        videoClips: n.videoClips,
        audioClips: n.audioClips,
        laneOffsets: n.laneOffsets,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const total = videoTrackEnd(videoClips)
  const audioEnd = audioClips.reduce(
    (max, a) => Math.max(max, audioStartAbs(a, audioClips, laneOffsets) + keptAudio(a)),
    0
  )
  const trackSeconds = Math.max(total, audioEnd, 10)
  const trackWidth = trackSeconds * pxPerSec + 80
  const selectedVideo = videoClips.find((c) => c.id === selectedVideoId)
  const selectedAudio = audioClips.find((c) => c.id === selectedAudioId)
  const activeClip =
    videoClips.find((c) => c.id === activeClipId) ?? videoClips[0]

  /* ---------------- playback ---------------- */
  const clipAt = (t: number): TimelineVideoClip | undefined =>
    videoClips
      .filter((c) => t >= c.offset && t < c.offset + keptVideo(c))
      .sort((a, b) => a.offset - b.offset)[0] ??
    [...videoClips].sort((a, b) => a.offset - b.offset).find((c) => c.offset >= t)

  const seekTo = (t: number) => {
    const clamped = Math.max(0, Math.min(t, Math.max(total - 0.05, 0)))
    setPlayhead(clamped)
    const clip = clipAt(clamped)
    if (!clip) return
    const local = clip.trimStart + Math.max(0, clamped - clip.offset)
    if (clip.id !== activeClip?.id) {
      pendingSeekRef.current = local
      setActiveClipId(clip.id)
    } else if (videoRef.current) {
      videoRef.current.currentTime = local
    }
  }

  const setPlayingBoth = (on: boolean) => {
    playingRef.current = on
    setPlaying(on)
    const v = videoRef.current
    if (!v) return
    if (on) {
      if (activeClip && (v.currentTime < activeClip.trimStart || v.currentTime >= activeClip.trimEnd - 0.05)) {
        seekTo(playhead >= total - 0.05 ? 0 : playhead)
      }
      void v.play().catch(() => undefined)
    } else {
      v.pause()
    }
  }

  const handleTimeUpdate = () => {
    const v = videoRef.current
    if (!v || !activeClip) return
    const local = v.currentTime
    if (local >= activeClip.trimEnd - 0.04) {
      const next = [...videoClips]
        .sort((a, b) => a.offset - b.offset)
        .find((c) => c.offset >= activeClip.offset + keptVideo(activeClip) - 0.01 && c.id !== activeClip.id)
      if (next && playingRef.current) {
        pendingSeekRef.current = next.trimStart
        setActiveClipId(next.id)
        setPlayhead(next.offset)
        return
      }
      setPlayingBoth(false)
      setPlayhead(activeClip.offset + keptVideo(activeClip))
      return
    }
    setPlayhead(activeClip.offset + Math.max(0, local - activeClip.trimStart))
  }

  /* ---------------- adding clips ---------------- */
  const addVideoByPath = async (filePath: string) => {
    const result = await window.electronAPI.getVideoMetadata(filePath)
    if (!result.success || !result.data) {
      onMessage(`Could not read ${baseName(filePath)}: ${result.error ?? ''}`)
      return
    }
    const meta = result.data
    store.addVideoClip({
      id: uuidv4(),
      path: filePath,
      name: baseName(filePath),
      duration: meta.duration ?? 0,
      width: meta.width ?? 0,
      height: meta.height ?? 0,
      trimStart: 0,
      trimEnd: meta.duration ?? 0,
      offset: 0,
      dropFirstFrame: false,
    })
  }

  const addAudioByPath = async (filePath: string, kind: AudioKind) => {
    const result = await window.electronAPI.getMediaDuration(filePath)
    if (!result.success || !result.data) {
      onMessage(`Could not read ${baseName(filePath)}: ${result.error ?? ''}`)
      return
    }
    const duration = result.data.duration ?? 0
    store.addAudioClip({
      id: uuidv4(),
      path: filePath,
      name: baseName(filePath),
      duration,
      volume: 80,
      kind,
      trimStart: 0,
      trimEnd: duration,
    })
  }

  const handlePlus = async (kind: 'video' | AudioKind) => {
    const result = await window.electronAPI.selectFiles(
      kind === 'video' ? 'video' : 'audio'
    )
    if (!result.success || !result.data) {
      if (result.error && !/cancel/i.test(result.error)) onMessage(result.error)
      return
    }
    for (const file of result.data) {
      if (kind === 'video') await addVideoByPath(file.filePath)
      else await addAudioByPath(file.filePath, kind)
    }
  }

  const handleFileDrop = async (
    e: React.DragEvent,
    kind: 'video' | AudioKind
  ) => {
    e.preventDefault()
    const exts = kind === 'video' ? VIDEO_EXTS : AUDIO_EXTS
    for (const file of Array.from(e.dataTransfer.files)) {
      const filePath = (file as File & { path?: string }).path
      if (!filePath || !exts.includes(extOf(file.name))) continue
      if (kind === 'video') await addVideoByPath(filePath)
      else await addAudioByPath(filePath, kind)
    }
  }

  /* ---------------- pointer drag: move + trim handles ---------------- */
  const beginDrag = (
    e: React.PointerEvent,
    track: 'video' | 'audio',
    clip: TimelineVideoClip | TimelineAudioClip,
    mode: DragState['mode']
  ) => {
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    setDrag({
      track,
      id: clip.id,
      mode,
      startX: e.clientX,
      origStart: clip.trimStart,
      origEnd: clip.trimEnd,
      dx: 0,
      moved: false,
    })
  }

  const onDragMove = (e: React.PointerEvent) => {
    if (!drag) return
    const dx = e.clientX - drag.startX
    const dSec = dx / pxPerSec
    const moved = drag.moved || Math.abs(dx) > 5
    setDrag({ ...drag, dx, moved })
    if (!moved || drag.mode === 'move') return
    if (drag.track === 'video') {
      const clip = videoClips.find((c) => c.id === drag.id)
      if (!clip) return
      if (drag.mode === 'trim-left') {
        const next = Math.max(0, Math.min(drag.origStart + dSec, drag.origEnd - 0.1))
        store.updateVideoClip(clip.id, { trimStart: round2(next) })
      } else {
        let maxEnd = clip.duration
        if (!ripple) {
          maxEnd = Math.min(
            clip.duration,
            clip.trimStart + maxKeptWithoutOverlap(videoClips, clip)
          )
        }
        const next = Math.max(drag.origStart + 0.1, Math.min(drag.origEnd + dSec, maxEnd))
        store.updateVideoClip(clip.id, { trimEnd: round2(next) })
      }
    } else {
      const clip = audioClips.find((c) => c.id === drag.id)
      if (!clip) return
      if (drag.mode === 'trim-left') {
        const next = Math.max(0, Math.min(drag.origStart + dSec, drag.origEnd - 0.1))
        store.updateAudioClip(clip.id, { trimStart: round2(next) })
      } else {
        const next = Math.max(drag.origStart + 0.1, Math.min(drag.origEnd + dSec, clip.duration))
        store.updateAudioClip(clip.id, { trimEnd: round2(next) })
      }
    }
  }

  const onDragEnd = (e: React.PointerEvent) => {
    if (!drag) return
    const finished = drag
    setDrag(null)
    if (finished.mode !== 'move' || !finished.moved) return
    // Reorder: find the block whose center is nearest the drop point.
    const container = scrollRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const dropSec = (e.clientX - rect.left + container.scrollLeft) / pxPerSec
    if (finished.track === 'video') {
      const ordered = [...videoClips].sort((a, b) => a.offset - b.offset)
      const from = videoClips.findIndex((c) => c.id === finished.id)
      let to = from
      ordered.forEach((c) => {
        const center = c.offset + keptVideo(c) / 2
        if (dropSec > center) to = videoClips.findIndex((x) => x.id === c.id)
      })
      if (to !== from && from >= 0) store.moveVideoClip(from, to)
    } else {
      const from = audioClips.findIndex((c) => c.id === finished.id)
      const clip = audioClips[from]
      if (!clip || from < 0) return
      const lane = audioClips.filter((c) => c.kind === clip.kind)
      let target = clip
      for (const c of lane) {
        const start = audioStartAbs(c, audioClips, laneOffsets)
        if (dropSec > start + keptAudio(c) / 2) target = c
      }
      const to = audioClips.findIndex((c) => c.id === target.id)
      if (to !== from) store.moveAudioClip(from, to)
    }
  }

  const smartConcatOn =
    videoClips.length > 1 &&
    [...videoClips]
      .sort((a, b) => a.offset - b.offset)
      .slice(1)
      .every((c) => c.dropFirstFrame)

  const toggleSmartConcat = () => {
    const ordered = [...videoClips].sort((a, b) => a.offset - b.offset)
    ordered.forEach((c, i) => {
      if (i === 0) return
      store.updateVideoClip(c.id, { dropFirstFrame: !smartConcatOn })
    })
  }

  const handleBuild = () => {
    const error = enqueueCompose({
      videoClips,
      audioClips: audioClips.map((a) => ({
        path: a.path,
        volume: a.volume,
        kind: a.kind,
        trimStart: a.trimStart,
        trimEnd: a.trimEnd,
        duration: a.duration,
      })),
      laneOffsets,
      originalVolume,
    })
    onMessage(
      error ??
        `Build Movie queued (${videoClips.length} video clip(s), ${audioClips.length} audio clip(s), ${fmtT(total)}) — see Render Queue.`
    )
  }

  const selectVideoClip = (clip: TimelineVideoClip) => {
    setSelectedVideoId(clip.id)
    setSelectedAudioId(null)
    setActiveClipId(clip.id)
    setPlayhead(clip.offset)
    pendingSeekRef.current = clip.trimStart
    setCurrentVideo({
      id: clip.id,
      path: clip.path,
      name: clip.name,
      duration: clip.duration,
      width: clip.width,
      height: clip.height,
      fps: 0,
      codec: '',
      bitrate: '',
      size: 0,
      createdAt: new Date(),
    })
  }

  const tickStep = pxPerSec >= 20 ? 1 : pxPerSec >= 8 ? 2 : pxPerSec >= 4 ? 5 : 10
  const ticks = []
  for (let t = 0; t <= trackSeconds; t += tickStep) ticks.push(t)

  const blockDragProps = (
    track: 'video' | 'audio',
    clip: TimelineVideoClip | TimelineAudioClip
  ) => ({
    onPointerDown: (e: React.PointerEvent) => {
      const zone = (e.target as HTMLElement).dataset.zone
      if (zone === 'trim-left' || zone === 'trim-right') {
        beginDrag(e, track, clip, zone)
      } else {
        beginDrag(e, track, clip, 'move')
      }
    },
  })

  return (
    <div className="mt-6 border-t border-gray-700 pt-5">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <Film size={18} className="text-indigo-400" /> Timeline Editor
          <span className="text-sm font-normal text-gray-400">
            {fmtT(playhead)} / {fmtT(total)}
          </span>
        </h3>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="flex items-center gap-2 text-xs text-gray-400">
            Zoom
            <input
              type="range"
              min={3}
              max={80}
              value={pxPerSec}
              onChange={(e) => setPxPerSec(parseInt(e.target.value, 10))}
              className="w-24 accent-indigo-500"
            />
          </label>
          <button
            onClick={() => store.setRipple(!ripple)}
            className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg transition-colors ${
              ripple
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
            title="Ripple edit: trims and deletes pull later clips along; off leaves a black gap"
          >
            <Magnet size={13} /> Ripple {ripple ? 'On' : 'Off'}
          </button>
          <button
            onClick={toggleSmartConcat}
            disabled={videoClips.length < 2}
            className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg transition-colors disabled:opacity-40 ${
              smartConcatOn
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
            title="Smart Concat: drop the first frame of every clip after the first (for last-frame chains)"
          >
            <Link2 size={13} /> Smart Concat
          </button>
          {(videoClips.length > 0 || audioClips.length > 0) && (
            <button
              onClick={() => {
                store.clearTimeline()
                setSelectedVideoId(null)
                setSelectedAudioId(null)
              }}
              className="flex items-center gap-1 px-3 py-1.5 bg-gray-800 hover:bg-red-600/30 text-gray-300 text-xs rounded-lg transition-colors"
            >
              <Trash2 size={13} /> Clear
            </button>
          )}
          <button
            onClick={handleBuild}
            disabled={videoClips.length === 0}
            className="flex items-center gap-1 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded-lg transition-colors"
            title="Render the timeline into one movie (a Render Queue job)"
          >
            <Download size={16} /> Build Movie
          </button>
        </div>
      </div>

      {/* Preview + Inspector */}
      <div className="flex gap-4 flex-wrap mb-4">
        <div className="bg-black rounded-lg overflow-hidden border border-gray-700 w-[300px] shrink-0">
          {activeClip ? (
            <video
              key={activeClip.id}
              ref={videoRef}
              src={toFileUrl(activeClip.path)}
              className="w-full h-[190px] object-contain bg-black"
              preload="auto"
              onLoadedMetadata={() => {
                const v = videoRef.current
                if (!v) return
                const target = pendingSeekRef.current ?? activeClip.trimStart
                pendingSeekRef.current = null
                v.currentTime = target
                if (playingRef.current) void v.play().catch(() => undefined)
              }}
              onTimeUpdate={handleTimeUpdate}
              onEnded={() => handleTimeUpdate()}
            />
          ) : (
            <div className="h-[190px] flex items-center justify-center text-gray-600 text-sm">
              No video clip yet
            </div>
          )}
          <div className="flex items-center gap-3 px-3 py-2 bg-gray-900">
            <button
              onClick={() => setPlayingBoth(!playing)}
              disabled={!activeClip}
              className="p-1.5 rounded-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 text-white transition-colors"
            >
              {playing ? <Pause size={14} /> : <Play size={14} />}
            </button>
            <span className="text-xs text-gray-300 font-mono">
              {fmtT(playhead)} / {fmtT(total)}
            </span>
            <span className="text-xs text-gray-500 truncate">
              {activeClip?.name ?? ''}
            </span>
          </div>
        </div>

        {/* Inspector */}
        <div className="flex-1 min-w-[280px] bg-gray-900 border border-gray-700 rounded-lg p-3">
          <p className="text-xs uppercase tracking-wide text-gray-500 mb-2 flex items-center gap-1">
            <Scissors size={12} /> Clip Inspector
          </p>
          {selectedVideo ? (
            <div className="space-y-2 text-xs text-gray-300">
              <p className="font-medium text-white truncate" title={selectedVideo.path}>
                {selectedVideo.name}
              </p>
              <p className="text-gray-500">
                {selectedVideo.width}×{selectedVideo.height} • source{' '}
                {fmtT(selectedVideo.duration)} • on timeline{' '}
                {fmtT(selectedVideo.offset)} →{' '}
                {fmtT(selectedVideo.offset + keptVideo(selectedVideo))}
              </p>
              <div className="flex items-center gap-3 flex-wrap">
                <label className="flex items-center gap-1">
                  In (s)
                  <input
                    type="number"
                    min={0}
                    max={selectedVideo.trimEnd - 0.1}
                    step={0.05}
                    value={selectedVideo.trimStart}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value)
                      if (Number.isFinite(v)) {
                        store.updateVideoClip(selectedVideo.id, {
                          trimStart: Math.max(0, Math.min(v, selectedVideo.trimEnd - 0.1)),
                        })
                      }
                    }}
                    className="w-20 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-gray-100"
                  />
                </label>
                <label className="flex items-center gap-1">
                  Out (s)
                  <input
                    type="number"
                    min={selectedVideo.trimStart + 0.1}
                    max={selectedVideo.duration}
                    step={0.05}
                    value={selectedVideo.trimEnd}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value)
                      if (Number.isFinite(v)) {
                        store.updateVideoClip(selectedVideo.id, {
                          trimEnd: Math.max(selectedVideo.trimStart + 0.1, Math.min(v, selectedVideo.duration)),
                        })
                      }
                    }}
                    className="w-20 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-gray-100"
                  />
                </label>
                <span className="text-gray-500">
                  keeps {fmtT(keptVideo(selectedVideo))}
                </span>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedVideo.dropFirstFrame}
                    onChange={(e) =>
                      store.updateVideoClip(selectedVideo.id, {
                        dropFirstFrame: e.target.checked,
                      })
                    }
                    className="accent-indigo-500"
                  />
                  Remove first frame (−1f)
                </label>
                <button
                  onClick={() => {
                    store.removeVideoClip(selectedVideo.id)
                    setSelectedVideoId(null)
                  }}
                  className="flex items-center gap-1 px-2 py-1 bg-gray-800 hover:bg-red-600/30 text-red-300 rounded-lg transition-colors"
                >
                  <X size={12} /> Remove clip
                </button>
              </div>
            </div>
          ) : selectedAudio ? (
            <div className="space-y-2 text-xs text-gray-300">
              <p className="font-medium text-white truncate" title={selectedAudio.path}>
                {selectedAudio.name}
              </p>
              <p className="text-gray-500">
                source {fmtT(selectedAudio.duration)} • starts at{' '}
                {fmtT(audioStartAbs(selectedAudio, audioClips, laneOffsets))}
              </p>
              <div className="flex items-center gap-3 flex-wrap">
                <label className="flex items-center gap-1">
                  Lane
                  <select
                    value={selectedAudio.kind}
                    onChange={(e) =>
                      store.updateAudioClip(selectedAudio.id, {
                        kind: e.target.value as AudioKind,
                      })
                    }
                    className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-gray-100"
                  >
                    <option value="voice">Voice</option>
                    <option value="music">Music</option>
                    <option value="sfx">SFX</option>
                  </select>
                </label>
                <label className="flex items-center gap-1">
                  In (s)
                  <input
                    type="number"
                    min={0}
                    max={selectedAudio.trimEnd - 0.1}
                    step={0.05}
                    value={selectedAudio.trimStart}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value)
                      if (Number.isFinite(v)) {
                        store.updateAudioClip(selectedAudio.id, {
                          trimStart: Math.max(0, Math.min(v, selectedAudio.trimEnd - 0.1)),
                        })
                      }
                    }}
                    className="w-20 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-gray-100"
                  />
                </label>
                <label className="flex items-center gap-1">
                  Out (s)
                  <input
                    type="number"
                    min={selectedAudio.trimStart + 0.1}
                    max={selectedAudio.duration}
                    step={0.05}
                    value={selectedAudio.trimEnd}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value)
                      if (Number.isFinite(v)) {
                        store.updateAudioClip(selectedAudio.id, {
                          trimEnd: Math.max(selectedAudio.trimStart + 0.1, Math.min(v, selectedAudio.duration)),
                        })
                      }
                    }}
                    className="w-20 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-gray-100"
                  />
                </label>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <label className="flex items-center gap-2">
                  Volume {selectedAudio.volume}%
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={selectedAudio.volume}
                    onChange={(e) =>
                      store.updateAudioClip(selectedAudio.id, {
                        volume: parseInt(e.target.value, 10),
                      })
                    }
                    className="w-28 accent-emerald-500"
                  />
                </label>
                <button
                  onClick={() => {
                    store.removeAudioClip(selectedAudio.id)
                    setSelectedAudioId(null)
                  }}
                  className="flex items-center gap-1 px-2 py-1 bg-gray-800 hover:bg-red-600/30 text-red-300 rounded-lg transition-colors"
                >
                  <X size={12} /> Remove audio
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2 text-xs text-gray-400">
              <p>Click a clip on the timeline to inspect and trim it.</p>
              <label className="flex items-center gap-2">
                Original audio {originalVolume}%
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={originalVolume}
                  onChange={(e) => store.setOriginalVolume(parseInt(e.target.value, 10))}
                  className="w-32 accent-indigo-500"
                />
              </label>
              <p className="text-gray-600">
                Drag a block to reorder it. Drag its left or right edge
                to trim. Click the ruler to move the playhead.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Quick add row */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        {currentVideo && !videoClips.some((c) => c.path === currentVideo.path) && (
          <button
            onClick={() =>
              store.addVideoClip({
                id: uuidv4(),
                path: currentVideo.path,
                name: currentVideo.name,
                duration: currentVideo.duration,
                width: currentVideo.width,
                height: currentVideo.height,
                trimStart: 0,
                trimEnd: currentVideo.duration,
                offset: 0,
                dropFirstFrame: false,
              })
            }
            className="px-3 py-1 bg-gray-800 hover:bg-indigo-600 text-gray-200 text-xs rounded-lg transition-colors"
          >
            + Current video ({currentVideo.name})
          </button>
        )}
        {videos.length > 0 && (
          <>
            <select
              value={importPick}
              onChange={(e) => setImportPick(e.target.value)}
              className="bg-gray-900 border border-gray-700 rounded-lg text-xs text-gray-200 px-2 py-1.5 max-w-[260px]"
            >
              <option value="">Add an imported video…</option>
              {videos.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
            <button
              disabled={!importPick}
              onClick={() => {
                const v = videos.find((x) => x.id === importPick)
                if (!v) return
                store.addVideoClip({
                  id: uuidv4(),
                  path: v.path,
                  name: v.name,
                  duration: v.duration,
                  width: v.width,
                  height: v.height,
                  trimStart: 0,
                  trimEnd: v.duration,
                  offset: 0,
                  dropFirstFrame: false,
                })
                setImportPick('')
              }}
              className="px-3 py-1.5 bg-gray-800 hover:bg-indigo-600 disabled:opacity-40 text-gray-200 text-xs rounded-lg transition-colors"
            >
              Add
            </button>
          </>
        )}
      </div>

      {/* Tracks */}
      <div
        ref={scrollRef}
        className="overflow-x-auto rounded-lg border border-gray-700 bg-gray-900"
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
      >
        <div className="relative" style={{ width: trackWidth }}>
          {/* Ruler */}
          <div
            className="relative h-6 border-b border-gray-700 cursor-pointer"
            onPointerDown={(e) => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
              setPlayingBoth(false)
              seekTo((e.clientX - rect.left) / pxPerSec)
            }}
          >
            {ticks.map((t) => (
              <div
                key={t}
                className="absolute top-0 h-full border-l border-gray-700"
                style={{ left: t * pxPerSec }}
              >
                <span className="text-[9px] text-gray-500 pl-1">{t}s</span>
              </div>
            ))}
          </div>

          {/* Playhead */}
          <div
            className="absolute top-0 bottom-0 w-px bg-red-500 z-20 pointer-events-none"
            style={{ left: playhead * pxPerSec }}
          >
            <div className="w-2.5 h-2.5 bg-red-500 rounded-sm -ml-[5px] mt-0.5 rotate-45" />
          </div>

          {/* Video track */}
          <div
            className="relative h-[68px] border-b border-gray-800"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => void handleFileDrop(e, 'video')}
          >
            {videoClips.map((clip) => {
              const kept = keptVideo(clip)
              const isDragged = drag?.id === clip.id && drag.mode === 'move'
              return (
                <div
                  key={clip.id}
                  {...blockDragProps('video', clip)}
                  onClick={() => {
                    if (!drag?.moved) selectVideoClip(clip)
                  }}
                  style={{
                    left: clip.offset * pxPerSec,
                    width: Math.max(kept * pxPerSec, 14),
                    transform: isDragged ? `translateX(${drag.dx}px)` : undefined,
                    zIndex: isDragged ? 30 : 10,
                  }}
                  className={`absolute top-1 bottom-1 rounded-md overflow-hidden border cursor-grab active:cursor-grabbing select-none ${
                    clip.id === selectedVideoId
                      ? 'border-indigo-400'
                      : 'border-gray-600'
                  }`}
                  title={clip.path}
                >
                  <Filmstrip clip={clip} />
                  <div className="absolute inset-x-0 bottom-0 bg-black/60 px-1.5 py-0.5 flex items-center gap-1 pointer-events-none">
                    <span className="text-[10px] text-white truncate">{clip.name}</span>
                    <span className="text-[10px] text-gray-300 shrink-0">{fmtT(kept)}</span>
                    {clip.dropFirstFrame && (
                      <span className="text-[9px] bg-indigo-600 text-white rounded px-1 shrink-0">−1f</span>
                    )}
                  </div>
                  <div
                    data-zone="trim-left"
                    className="absolute left-0 top-0 bottom-0 w-[9px] cursor-ew-resize bg-white/0 hover:bg-white/25"
                  />
                  <div
                    data-zone="trim-right"
                    className="absolute right-0 top-0 bottom-0 w-[9px] cursor-ew-resize bg-white/0 hover:bg-white/25"
                  />
                </div>
              )
            })}
            <button
              onClick={() => void handlePlus('video')}
              className="absolute top-1 bottom-1 w-10 rounded-md border border-dashed border-gray-600 text-gray-400 hover:border-indigo-400 hover:text-indigo-300 flex items-center justify-center transition-colors bg-gray-900/70"
              style={{ left: total * pxPerSec + 6 }}
              title="Add video files"
            >
              <Plus size={16} />
            </button>
          </div>

          {/* Audio lanes */}
          {LANES.map((lane) => {
            const laneClips = audioClips.filter((a) => a.kind === lane.kind)
            return (
              <div key={lane.kind} className="border-b border-gray-800 last:border-b-0">
                <div className="flex items-center gap-2 px-2 pt-1.5">
                  <span className="text-[10px] uppercase tracking-wide text-gray-400 w-12">
                    {lane.label}
                  </span>
                  <label className="text-[10px] text-gray-500 flex items-center gap-1">
                    starts at (s)
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      value={laneOffsets[lane.kind]}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value)
                        if (Number.isFinite(v)) store.setLaneOffset(lane.kind, v)
                      }}
                      className="w-16 bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-gray-200"
                    />
                  </label>
                  <button
                    onClick={() => void handlePlus(lane.kind)}
                    className="flex items-center gap-0.5 text-[11px] px-2 py-0.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors"
                  >
                    <Plus size={11} /> Add {lane.label.toLowerCase()}
                  </button>
                </div>
                <div
                  className="relative h-[46px]"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => void handleFileDrop(e, lane.kind)}
                >
                  {laneClips.map((clip) => {
                    const start = audioStartAbs(clip, audioClips, laneOffsets)
                    const kept = keptAudio(clip)
                    const isDragged = drag?.id === clip.id && drag.mode === 'move'
                    return (
                      <div
                        key={clip.id}
                        {...blockDragProps('audio', clip)}
                        onClick={() => {
                          if (!drag?.moved) {
                            setSelectedAudioId(clip.id)
                            setSelectedVideoId(null)
                          }
                        }}
                        style={{
                          left: start * pxPerSec,
                          width: Math.max(kept * pxPerSec, 14),
                          transform: isDragged ? `translateX(${drag.dx}px)` : undefined,
                          zIndex: isDragged ? 30 : 10,
                        }}
                        className={`absolute top-1 bottom-1 rounded-md border overflow-hidden cursor-grab active:cursor-grabbing select-none ${lane.color} ${
                          clip.id === selectedAudioId ? lane.ring : 'border-gray-600'
                        }`}
                        title={clip.path}
                      >
                        <div className="px-1.5 py-1 pointer-events-none">
                          <p className="text-[10px] text-white truncate">{clip.name}</p>
                          <p className="text-[9px] text-gray-300">
                            {fmtT(kept)} • vol {clip.volume}%
                          </p>
                        </div>
                        <div
                          data-zone="trim-left"
                          className="absolute left-0 top-0 bottom-0 w-[9px] cursor-ew-resize bg-white/0 hover:bg-white/25"
                        />
                        <div
                          data-zone="trim-right"
                          className="absolute right-0 top-0 bottom-0 w-[9px] cursor-ew-resize bg-white/0 hover:bg-white/25"
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <p className="text-[11px] text-gray-600 mt-2">
        Clips are normalized to the first video clip's size and frame
        rate. With Ripple off, trims and deletions leave black gaps.
        The movie lands next to the first clip as “.timeline.mp4”.
      </p>
    </div>
  )
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}
