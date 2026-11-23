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
  ArrowLeftRight,
  Layers,
  Crop,
  Gauge,
  RotateCw,
  LayoutGrid,
  FolderOpen,
  Image as ImageIcon,
  Zap,
  FastForward,
  Undo2,
  Redo2,
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
import {
  enqueueCompose,
  enqueueUpscale,
  enqueueTrim,
  enqueueSplit,
  enqueueCrop,
  enqueueSpeed,
  enqueueTransform,
  enqueueTimeline,
} from '@/lib/jobRunner'
import { toFileUrl } from '@/lib/files'
import type { VideoFile } from '@/types'

const VIDEO_EXTS = ['mp4', 'mov', 'mkv', 'avi', 'webm', 'flv', 'wmv']
const AUDIO_EXTS = ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg']
const LANES: {
  kind: AudioKind
  label: string
  color: string
  ring: string
  wave: string
}[] = [
  { kind: 'voice', label: 'Voice', color: 'bg-emerald-600/30', ring: 'border-emerald-400', wave: '#34d399' },
  { kind: 'music', label: 'Music', color: 'bg-violet-600/30', ring: 'border-violet-400', wave: '#a78bfa' },
  { kind: 'sfx', label: 'SFX', color: 'bg-amber-600/30', ring: 'border-amber-400', wave: '#fbbf24' },
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
function round2(v: number): number {
  return Math.round(v * 100) / 100
}

/** Build a minimal VideoFile for the render-job helpers. */
function clipFile(clip: TimelineVideoClip): VideoFile {
  return {
    id: clip.id,
    path: clip.path,
    name: clip.name,
    duration: clip.duration,
    width: clip.width,
    height: clip.height,
    fps: clip.fps ?? 0,
    codec: '',
    bitrate: '',
    size: 0,
    createdAt: new Date(),
  }
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

/** Real audio waveform across the clip's kept range. */
const Waveform: FC<{ clip: TimelineAudioClip; color: string }> = ({
  clip,
  color,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const kept = keptAudio(clip)
  const buckets = Math.max(16, Math.min(240, Math.round(kept * 12)))
  const key = `${clip.path}|${clip.trimStart.toFixed(1)}|${clip.trimEnd.toFixed(1)}|${buckets}`
  useEffect(() => {
    let alive = true
    const timer = setTimeout(async () => {
      try {
        const result = await window.electronAPI.extractWaveformPeaks({
          path: clip.path,
          startSeconds: clip.trimStart,
          endSeconds: clip.trimEnd,
          buckets,
        })
        if (!alive || !result.success || !result.data) return
        const canvas = canvasRef.current
        if (!canvas) return
        const w = canvas.clientWidth
        const h = canvas.clientHeight
        if (w === 0 || h === 0) return
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.clearRect(0, 0, w, h)
        ctx.fillStyle = color
        const peaks = result.data
        const barW = w / peaks.length
        peaks.forEach((p, i) => {
          const bh = Math.max(1, p * (h - 6))
          ctx.fillRect(
            i * barW,
            (h - bh) / 2,
            Math.max(1, barW - 0.5),
            bh
          )
        })
      } catch {
        /* waveform is decorative; the editor works without it */
      }
    }, 300)
    return () => {
      alive = false
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
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

interface MenuState {
  x: number
  y: number
  track: 'video' | 'audio'
  id: string
}

type ToolKind = 'trim' | 'split' | 'crop' | 'speed' | 'rotate' | 'sheet'

interface TimelineEditorProps {
  onMessage: (message: string) => void
}

export const TimelineEditor: FC<TimelineEditorProps> = ({ onMessage }) => {
  const store = useTimelineStore()
  const {
    videoClips,
    audioClips,
    laneOffsets,
    laneVolumes,
    laneFades,
    videoFadeIn,
    videoFadeOut,
    originalVolume,
    ripple,
    past,
    future,
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
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [tool, setTool] = useState<ToolKind | null>(null)
  const [toolTrim, setToolTrim] = useState({ start: 0, end: 0 })
  const [toolSplitAt, setToolSplitAt] = useState(0)
  const [toolSegLen, setToolSegLen] = useState(5)
  const [toolSplitMode, setToolSplitMode] = useState<'at' | 'segments'>('at')
  const [toolCrop, setToolCrop] = useState<'9:16' | '1:1' | '16:9' | 'custom'>('9:16')
  const [toolCropW, setToolCropW] = useState(720)
  const [toolCropH, setToolCropH] = useState(1280)
  const [toolSpeed, setToolSpeed] = useState(2)
  const videoRef = useRef<HTMLVideoElement>(null)
  const playingRef = useRef(false)
  const pendingSeekRef = useRef<number | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Upgrade an older saved timeline (missing fields) on first mount.
  useEffect(() => {
    const s = useTimelineStore.getState()
    const n = normalizeTimeline(s)
    const changed =
      JSON.stringify(n.videoClips) !== JSON.stringify(s.videoClips) ||
      JSON.stringify(n.audioClips) !== JSON.stringify(s.audioClips) ||
      JSON.stringify(n.laneOffsets) !== JSON.stringify(s.laneOffsets) ||
      JSON.stringify(n.laneVolumes) !== JSON.stringify(s.laneVolumes ?? {}) ||
      JSON.stringify(n.laneFades) !== JSON.stringify(s.laneFades ?? {}) ||
      n.videoFadeIn !== (s.videoFadeIn ?? 0) ||
      n.videoFadeOut !== (s.videoFadeOut ?? 0)
    if (changed) {
      useTimelineStore.setState({
        videoClips: n.videoClips,
        audioClips: n.audioClips,
        laneOffsets: n.laneOffsets,
        laneVolumes: n.laneVolumes,
        laneFades: n.laneFades,
        videoFadeIn: n.videoFadeIn,
        videoFadeOut: n.videoFadeOut,
      })
    }
    useTimelineStore.getState().resetHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y — but leave text fields alone
  // so typing in a number input keeps its native undo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const target = e.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT'
      ) {
        return
      }
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        useTimelineStore.getState().undo()
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault()
        useTimelineStore.getState().redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
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

  // Seed the tool strip whenever a tool is opened or the clip changes.
  useEffect(() => {
    if (!selectedVideo || !tool) return
    setToolTrim({ start: selectedVideo.trimStart, end: selectedVideo.trimEnd })
    setToolSplitAt(
      round2(
        selectedVideo.trimStart +
          Math.max(
            0,
            Math.min(playhead - selectedVideo.offset, keptVideo(selectedVideo))
          )
      )
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, selectedVideo?.id])

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
      fps: meta.fps ?? 0,
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
    store.beginBatch()
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
    store.endBatch()
    if (finished.mode !== 'move' || !finished.moved) return
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
      laneVolumes,
      laneFades,
      videoFadeIn,
      videoFadeOut,
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
    setCurrentVideo(clipFile(clip))
  }

  /* ---------------- split at cursor ---------------- */
  const videoClipUnderPlayhead = videoClips.find(
    (c) =>
      playhead > c.offset + 0.05 &&
      playhead < c.offset + keptVideo(c) - 0.05
  )
  const audioClipUnderPlayhead = selectedAudio
    ? (() => {
        const start = audioStartAbs(selectedAudio, audioClips, laneOffsets)
        return playhead > start + 0.05 &&
          playhead < start + keptAudio(selectedAudio) - 0.05
          ? selectedAudio
          : undefined
      })()
    : undefined

  const splitAtCursor = () => {
    if (videoClipUnderPlayhead) {
      if (store.splitVideoClip(videoClipUnderPlayhead.id, playhead)) {
        onMessage(
          `Split ${videoClipUnderPlayhead.name} at ${fmtT(playhead)}.`
        )
        return
      }
    }
    if (audioClipUnderPlayhead) {
      if (store.splitAudioClip(audioClipUnderPlayhead.id, playhead)) {
        onMessage(`Split ${audioClipUnderPlayhead.name} at ${fmtT(playhead)}.`)
        return
      }
    }
    onMessage('Move the playhead inside a clip to split it there.')
  }

  /* ---------------- context menu actions ---------------- */
  const menuClip =
    menu?.track === 'video'
      ? videoClips.find((c) => c.id === menu.id)
      : undefined
  const menuAudio =
    menu?.track === 'audio'
      ? audioClips.find((c) => c.id === menu.id)
      : undefined

  const doExtractFrame = async (
    clip: TimelineVideoClip,
    which: 'first' | 'last'
  ) => {
    const result = await window.electronAPI.extractFrameAt({
      path: clip.path,
      timeSeconds: which === 'first' ? clip.trimStart : clip.trimEnd,
      which,
      rangeStartSeconds: clip.trimStart,
    })
    onMessage(
      result.success && result.data
        ? `Saved ${which} frame → ${result.data}`
        : `Extract frame failed: ${result.error ?? 'unknown error'}`
    )
  }

  const doUpscale = (clip: TimelineVideoClip, rife: boolean) => {
    const error = enqueueUpscale(clipFile(clip), rife)
    onMessage(
      error ??
        `${rife ? 'RIFE + upscale' : 'Upscale'} queued for ${clip.name} — see Render Queue.`
    )
  }

  const doOpenFolder = async (filePath: string) => {
    const result = await window.electronAPI.openFolder(filePath)
    if (!result.success) {
      onMessage(`Open folder failed: ${result.error ?? 'unknown error'}`)
    }
  }

  /* ---------------- tool strip actions ---------------- */
  const runTool = (kind: ToolKind) => {
    if (!selectedVideo) return
    const file = clipFile(selectedVideo)
    if (kind === 'trim') {
      enqueueTrim(file, toolTrim.start, toolTrim.end)
      onMessage(`Trim queued for ${selectedVideo.name} — see Render Queue.`)
    } else if (kind === 'split') {
      enqueueSplit(
        file,
        toolSplitMode === 'at'
          ? { mode: 'at', atSeconds: toolSplitAt }
          : { mode: 'segments', segmentSeconds: toolSegLen }
      )
      onMessage(`Split queued for ${selectedVideo.name} — see Render Queue.`)
    } else if (kind === 'crop') {
      const W = selectedVideo.width
      const H = selectedVideo.height
      let w = toolCropW
      let h = toolCropH
      if (toolCrop !== 'custom') {
        const [rw, rh] = toolCrop.split(':').map(Number)
        const ratio = rw / rh
        if (W / H > ratio) {
          h = H
          w = Math.round((H * ratio) / 2) * 2
        } else {
          w = W
          h = Math.round(W / ratio / 2) * 2
        }
      }
      enqueueCrop(file, {
        x: Math.max(0, Math.round((W - w) / 2)),
        y: Math.max(0, Math.round((H - h) / 2)),
        width: w,
        height: h,
      })
      onMessage(`Crop queued for ${selectedVideo.name} — see Render Queue.`)
    } else if (kind === 'speed') {
      enqueueSpeed(file, toolSpeed)
      onMessage(`Speed ${toolSpeed}x queued for ${selectedVideo.name} — see Render Queue.`)
    } else if (kind === 'sheet') {
      enqueueTimeline(file)
      onMessage(`Timeline sheet queued for ${selectedVideo.name} — see Render Queue.`)
    }
  }

  const runTransform = (op: 'rot90' | 'rot-90' | 'rot180' | 'flipH' | 'flipV') => {
    if (!selectedVideo) return
    enqueueTransform(clipFile(selectedVideo), op)
    onMessage(`Transform queued for ${selectedVideo.name} — see Render Queue.`)
  }

  const tickStep =
    pxPerSec >= 400
      ? 0.1
      : pxPerSec >= 160
        ? 0.5
        : pxPerSec >= 40
          ? 1
          : pxPerSec >= 16
            ? 2
            : pxPerSec >= 8
              ? 5
              : 10
  const ticks: number[] = []
  for (let t = 0; t <= trackSeconds; t += tickStep) {
    ticks.push(Math.round(t * 10) / 10)
  }

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

  const toolButtons: { kind: ToolKind; label: string; icon: typeof ArrowLeftRight }[] = [
    { kind: 'trim', label: 'Trim', icon: ArrowLeftRight },
    { kind: 'split', label: 'Split file', icon: Layers },
    { kind: 'crop', label: 'Crop', icon: Crop },
    { kind: 'speed', label: 'Speed', icon: Gauge },
    { kind: 'rotate', label: 'Rotate / Flip', icon: RotateCw },
    { kind: 'sheet', label: 'Sheet', icon: LayoutGrid },
  ]

  const fadeInput = (
    value: number,
    onChange: (v: number) => void,
    title: string
  ) => (
    <input
      type="number"
      min={0}
      step={0.5}
      value={value}
      title={title}
      onChange={(e) => {
        const v = parseFloat(e.target.value)
        if (Number.isFinite(v)) onChange(Math.max(0, v))
      }}
      className="w-14 bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-gray-200"
    />
  )

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
          <button
            onClick={() => store.undo()}
            disabled={past.length === 0}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-35 text-gray-200 text-xs rounded-lg transition-colors"
            title="Undo the last timeline edit (Ctrl+Z)"
          >
            <Undo2 size={13} /> Undo
          </button>
          <button
            onClick={() => store.redo()}
            disabled={future.length === 0}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-35 text-gray-200 text-xs rounded-lg transition-colors"
            title="Redo (Ctrl+Shift+Z / Ctrl+Y)"
          >
            <Redo2 size={13} /> Redo
          </button>
          <label className="flex items-center gap-2 text-xs text-gray-400">
            Zoom
            <input
              type="range"
              min={2}
              max={600}
              value={pxPerSec}
              onChange={(e) => setPxPerSec(parseInt(e.target.value, 10))}
              className="w-28 accent-indigo-500"
              title="Zoom the timeline — far right reaches single frames"
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
            title="Smart Concat: remove the duplicated first frame of every clip after the first (for last-frame chains)"
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
      <div className="flex gap-4 flex-wrap mb-3">
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
                  Remove duplicated first frame
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
              <p>Click a clip on the timeline to inspect and trim it. Right-click a clip for frame extraction, upscale, RIFE and more.</p>
              <p className="text-gray-600">
                Drag a block to reorder it. Drag its left or right edge
                to trim. Click the ruler to move the playhead. Zoom far
                in to place the playhead frame by frame, then Split at
                Cursor.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Icon tool bar — sits between the preview and the timeline;
          the tools render new files from the selected clip. */}
      <div className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 mb-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={splitAtCursor}
            disabled={!videoClipUnderPlayhead && !audioClipUnderPlayhead}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600/80 hover:bg-red-500 disabled:bg-gray-800 disabled:text-gray-500 text-white text-xs font-medium rounded-lg transition-colors"
            title="Split the clip under the playhead into two clips, right on the timeline"
          >
            <Scissors size={14} /> Split at Cursor
            <span className="font-mono text-[10px] opacity-80">{fmtT(playhead)}</span>
          </button>
          <div className="w-px h-6 bg-gray-700 mx-1" />
          {toolButtons.map(({ kind, label, icon: Icon }) => (
            <button
              key={kind}
              disabled={!selectedVideo}
              onClick={() => setTool(tool === kind ? null : kind)}
              className={`flex flex-col items-center gap-0.5 px-2.5 py-1 rounded-lg text-[10px] transition-colors disabled:opacity-35 ${
                tool === kind
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-300 hover:bg-gray-800'
              }`}
              title={
                selectedVideo
                  ? `${label} — renders a new file from ${selectedVideo.name}`
                  : 'Select a video clip first'
              }
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
          <span className="text-[11px] text-gray-500 ml-2 truncate">
            {selectedVideo
              ? `Tools apply to: ${selectedVideo.name}`
              : 'Select a video clip to use the tools'}
          </span>
        </div>

        {tool && selectedVideo && (
          <div className="flex items-center gap-3 flex-wrap mt-2 pt-2 border-t border-gray-800 text-xs text-gray-300">
            {tool === 'trim' && (
              <>
                <label className="flex items-center gap-1">
                  Start (s)
                  <input
                    type="number"
                    min={0}
                    step={0.05}
                    value={toolTrim.start}
                    onChange={(e) => setToolTrim({ ...toolTrim, start: parseFloat(e.target.value) || 0 })}
                    className="w-20 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-gray-100"
                  />
                </label>
                <label className="flex items-center gap-1">
                  End (s)
                  <input
                    type="number"
                    min={0}
                    step={0.05}
                    value={toolTrim.end}
                    onChange={(e) => setToolTrim({ ...toolTrim, end: parseFloat(e.target.value) || 0 })}
                    className="w-20 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-gray-100"
                  />
                </label>
                <button
                  onClick={() => runTool('trim')}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors"
                >
                  Render trimmed file
                </button>
                <span className="text-gray-500">Frame-accurate re-encode to a new .trim.mp4</span>
              </>
            )}
            {tool === 'split' && (
              <>
                <select
                  value={toolSplitMode}
                  onChange={(e) => setToolSplitMode(e.target.value as 'at' | 'segments')}
                  className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-gray-100"
                >
                  <option value="at">Split at one point</option>
                  <option value="segments">Split every N seconds</option>
                </select>
                {toolSplitMode === 'at' ? (
                  <label className="flex items-center gap-1">
                    At (s)
                    <input
                      type="number"
                      min={0}
                      step={0.05}
                      value={toolSplitAt}
                      onChange={(e) => setToolSplitAt(parseFloat(e.target.value) || 0)}
                      className="w-20 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-gray-100"
                    />
                  </label>
                ) : (
                  <label className="flex items-center gap-1">
                    Every (s)
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={toolSegLen}
                      onChange={(e) => setToolSegLen(parseFloat(e.target.value) || 5)}
                      className="w-20 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-gray-100"
                    />
                  </label>
                )}
                <button
                  onClick={() => runTool('split')}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors"
                >
                  Render split files
                </button>
                <span className="text-gray-500">Parts land in a “_parts” folder next to the clip</span>
              </>
            )}
            {tool === 'crop' && (
              <>
                <select
                  value={toolCrop}
                  onChange={(e) => setToolCrop(e.target.value as typeof toolCrop)}
                  className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-gray-100"
                >
                  <option value="9:16">9:16 portrait</option>
                  <option value="1:1">1:1 square</option>
                  <option value="16:9">16:9 landscape</option>
                  <option value="custom">Custom size</option>
                </select>
                {toolCrop === 'custom' && (
                  <>
                    <input
                      type="number"
                      value={toolCropW}
                      onChange={(e) => setToolCropW(parseInt(e.target.value, 10) || 0)}
                      className="w-20 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-gray-100"
                      title="Width"
                    />
                    <span className="text-gray-500">×</span>
                    <input
                      type="number"
                      value={toolCropH}
                      onChange={(e) => setToolCropH(parseInt(e.target.value, 10) || 0)}
                      className="w-20 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-gray-100"
                      title="Height"
                    />
                  </>
                )}
                <button
                  onClick={() => runTool('crop')}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors"
                >
                  Render cropped file
                </button>
                <span className="text-gray-500">Center crop of {selectedVideo.width}×{selectedVideo.height}</span>
              </>
            )}
            {tool === 'speed' && (
              <>
                <select
                  value={toolSpeed}
                  onChange={(e) => setToolSpeed(parseFloat(e.target.value))}
                  className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-gray-100"
                >
                  {[0.25, 0.5, 0.75, 1.5, 2, 3, 4].map((f) => (
                    <option key={f} value={f}>{f}x</option>
                  ))}
                </select>
                <button
                  onClick={() => runTool('speed')}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors"
                >
                  Render speed file
                </button>
              </>
            )}
            {tool === 'rotate' && (
              <>
                {(
                  [
                    ['rot90', 'Rotate 90°'],
                    ['rot-90', 'Rotate −90°'],
                    ['rot180', 'Rotate 180°'],
                    ['flipH', 'Flip horizontal'],
                    ['flipV', 'Flip vertical'],
                  ] as const
                ).map(([op, label]) => (
                  <button
                    key={op}
                    onClick={() => runTransform(op)}
                    className="px-3 py-1.5 bg-gray-800 hover:bg-indigo-600 text-gray-200 rounded-lg transition-colors"
                  >
                    {label}
                  </button>
                ))}
              </>
            )}
            {tool === 'sheet' && (
              <>
                <button
                  onClick={() => runTool('sheet')}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors"
                >
                  Render timeline sheet
                </button>
                <span className="text-gray-500">One contact-sheet PNG of frames across the whole clip</span>
              </>
            )}
          </div>
        )}
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
                fps: currentVideo.fps,
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
                  fps: v.fps,
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
                <span className="text-[9px] text-gray-500 pl-1">
                  {tickStep < 1 ? `${t.toFixed(1)}s` : `${t}s`}
                </span>
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

          {/* Video track header: track volume + fades */}
          <div className="flex items-center gap-3 px-2 pt-1.5 flex-wrap">
            <span className="text-[10px] uppercase tracking-wide text-gray-400 w-12">
              Video
            </span>
            <label className="text-[10px] text-gray-500 flex items-center gap-1.5">
              Vol {originalVolume}%
              <input
                type="range"
                min={0}
                max={100}
                value={originalVolume}
                onChange={(e) => store.setOriginalVolume(parseInt(e.target.value, 10))}
                className="w-20 accent-indigo-500"
                title="Volume of the video track's own audio"
              />
            </label>
            <label className="text-[10px] text-gray-500 flex items-center gap-1">
              Fade in (s)
              {fadeInput(videoFadeIn, (v) => store.setVideoFades({ fadeIn: v }), 'Video-track audio fade in, seconds')}
            </label>
            <label className="text-[10px] text-gray-500 flex items-center gap-1">
              Fade out (s)
              {fadeInput(videoFadeOut, (v) => store.setVideoFades({ fadeOut: v }), 'Video-track audio fade out, seconds')}
            </label>
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
                  onContextMenu={(e) => {
                    e.preventDefault()
                    selectVideoClip(clip)
                    setMenu({
                      x: Math.min(e.clientX, window.innerWidth - 250),
                      y: e.clientY,
                      track: 'video',
                      id: clip.id,
                    })
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
            const laneVolume = laneVolumes?.[lane.kind] ?? 100
            const laneFade = laneFades?.[lane.kind] ?? { fadeIn: 0, fadeOut: 0 }
            return (
              <div key={lane.kind} className="border-b border-gray-800 last:border-b-0">
                <div className="flex items-center gap-3 px-2 pt-1.5 flex-wrap">
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
                  <label className="text-[10px] text-gray-500 flex items-center gap-1.5">
                    Vol {laneVolume}%
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={laneVolume}
                      onChange={(e) => store.setLaneVolume(lane.kind, parseInt(e.target.value, 10))}
                      className="w-20 accent-emerald-500"
                      title={`${lane.label} track volume`}
                    />
                  </label>
                  <label className="text-[10px] text-gray-500 flex items-center gap-1">
                    Fade in (s)
                    {fadeInput(laneFade.fadeIn, (v) => store.setLaneFade(lane.kind, 'fadeIn', v), `${lane.label} track fade in, seconds`)}
                  </label>
                  <label className="text-[10px] text-gray-500 flex items-center gap-1">
                    Fade out (s)
                    {fadeInput(laneFade.fadeOut, (v) => store.setLaneFade(lane.kind, 'fadeOut', v), `${lane.label} track fade out, seconds`)}
                  </label>
                  <button
                    onClick={() => void handlePlus(lane.kind)}
                    className="flex items-center gap-0.5 text-[11px] px-2 py-0.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors"
                  >
                    <Plus size={11} /> Add {lane.label.toLowerCase()}
                  </button>
                </div>
                <div
                  className="relative h-[52px]"
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
                        onContextMenu={(e) => {
                          e.preventDefault()
                          setSelectedAudioId(clip.id)
                          setSelectedVideoId(null)
                          setMenu({
                            x: Math.min(e.clientX, window.innerWidth - 250),
                            y: e.clientY,
                            track: 'audio',
                            id: clip.id,
                          })
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
                        <Waveform clip={clip} color={lane.wave} />
                        <div className="absolute top-0 left-0 bg-black/55 rounded-br px-1.5 py-0.5 pointer-events-none max-w-full">
                          <span className="text-[10px] text-white truncate block">
                            {clip.name} • {fmtT(kept)} • vol {clip.volume}%
                          </span>
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
        Right-click any clip for frame extraction, upscale, RIFE and
        its folder. The movie lands next to the first clip as
        “.timeline.mp4”.
      </p>

      {/* Right-click context menu */}
      {menu && (menuClip || menuAudio) && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setMenu(null)}
          onContextMenu={(e) => {
            e.preventDefault()
            setMenu(null)
          }}
        >
          <div
            className="absolute w-[240px] bg-gray-800 border border-gray-600 rounded-lg shadow-2xl py-1 text-xs text-gray-200"
            style={{ left: menu.x, top: menu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-gray-500 truncate">
              {menuClip?.name ?? menuAudio?.name}
            </p>
            {menuClip && (
              <>
                <button
                  onClick={() => {
                    setMenu(null)
                    void doExtractFrame(menuClip, 'first')
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-gray-700 text-left"
                >
                  <ImageIcon size={13} /> Extract First Frame
                </button>
                <button
                  onClick={() => {
                    setMenu(null)
                    void doExtractFrame(menuClip, 'last')
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-gray-700 text-left"
                >
                  <ImageIcon size={13} /> Extract Last Frame
                </button>
                <button
                  onClick={() => {
                    setMenu(null)
                    doUpscale(menuClip, false)
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-gray-700 text-left"
                >
                  <Zap size={13} /> Upscale
                </button>
                <button
                  onClick={() => {
                    setMenu(null)
                    doUpscale(menuClip, true)
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-gray-700 text-left"
                >
                  <FastForward size={13} /> RIFE
                </button>
                <button
                  onClick={() => {
                    store.updateVideoClip(menuClip.id, {
                      dropFirstFrame: !menuClip.dropFirstFrame,
                    })
                    setMenu(null)
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-gray-700 text-left"
                >
                  <Scissors size={13} /> Remove duplicated first frame
                  {menuClip.dropFirstFrame && (
                    <span className="ml-auto text-indigo-300">on</span>
                  )}
                </button>
              </>
            )}
            <button
              onClick={() => {
                const p = (menuClip ?? menuAudio)!.path
                setMenu(null)
                void doOpenFolder(p)
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-gray-700 text-left"
            >
              <FolderOpen size={13} /> Open folder
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
