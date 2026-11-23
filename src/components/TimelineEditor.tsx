import { FC, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { Plus, X, Film, Music, Download, Trash2 } from 'lucide-react'
import {
  useTimelineStore,
  timelineDuration,
  type TimelineVideoClip,
  type TimelineAudioClip,
} from '@/stores/timelineStore'
import { useVideoStore } from '@/stores/videoStore'
import { enqueueCompose } from '@/lib/jobRunner'
import type { VideoFile } from '@/types'

const VIDEO_EXTS = ['mp4', 'mov', 'mkv', 'avi', 'webm', 'flv', 'wmv']
const AUDIO_EXTS = ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg']

function baseName(filePath: string): string {
  const parts = filePath.split(/[\\/]/)
  return parts[parts.length - 1] || filePath
}

function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

function fmt(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0.0s'
  return `${seconds.toFixed(1)}s`
}

interface TimelineEditorProps {
  onMessage: (message: string) => void
}

/**
 * CapCut-style timeline under the Current Video: a video track and
 * an added-audio track. Clips are added with the + buttons or by
 * dropping files onto a track, reordered by dragging, trimmed in
 * place, and rendered by the Export Timeline button (a normal
 * render-queue job).
 */
export const TimelineEditor: FC<TimelineEditorProps> = ({ onMessage }) => {
  const {
    videoClips,
    audioClips,
    audioStartOffset,
    originalVolume,
    addVideoClip,
    addAudioClip,
    updateVideoClip,
    updateAudioClip,
    removeVideoClip,
    removeAudioClip,
    moveVideoClip,
    moveAudioClip,
    setAudioStartOffset,
    setOriginalVolume,
    clearTimeline,
  } = useTimelineStore()
  const { videos, currentVideo, setCurrentVideo } = useVideoStore()
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null)
  const [selectedAudioId, setSelectedAudioId] = useState<string | null>(null)
  const [importPick, setImportPick] = useState('')
  const dragFrom = useRef<{ track: 'video' | 'audio'; index: number } | null>(
    null
  )
  const [dropTrack, setDropTrack] = useState<'video' | 'audio' | null>(null)

  const total = timelineDuration(videoClips)
  const selectedVideo = videoClips.find((c) => c.id === selectedVideoId)
  const selectedAudio = audioClips.find((c) => c.id === selectedAudioId)

  const addVideoByPath = async (filePath: string) => {
    const result = await window.electronAPI.getVideoMetadata(filePath)
    if (!result.success || !result.data) {
      onMessage(`Could not read ${baseName(filePath)}: ${result.error ?? ''}`)
      return
    }
    const meta = result.data
    addVideoClip({
      id: uuidv4(),
      path: filePath,
      name: baseName(filePath),
      duration: meta.duration ?? 0,
      width: meta.width ?? 0,
      height: meta.height ?? 0,
      trimStart: 0,
      trimEnd: meta.duration ?? 0,
    })
  }

  const addAudioByPath = async (filePath: string) => {
    const result = await window.electronAPI.getMediaDuration(filePath)
    if (!result.success || !result.data) {
      onMessage(`Could not read ${baseName(filePath)}: ${result.error ?? ''}`)
      return
    }
    addAudioClip({
      id: uuidv4(),
      path: filePath,
      name: baseName(filePath),
      duration: result.data.duration ?? 0,
      volume: 80,
    })
  }

  const handlePlus = async (kind: 'video' | 'audio') => {
    const result = await window.electronAPI.selectFiles(kind)
    if (!result.success || !result.data) {
      if (result.error && !/cancel/i.test(result.error)) {
        onMessage(result.error)
      }
      return
    }
    for (const file of result.data) {
      if (kind === 'video') await addVideoByPath(file.filePath)
      else await addAudioByPath(file.filePath)
    }
  }

  const handleDrop = async (
    e: React.DragEvent,
    kind: 'video' | 'audio'
  ) => {
    e.preventDefault()
    setDropTrack(null)
    // A drop that started as an in-app reorder carries no files.
    if (dragFrom.current) return
    const exts = kind === 'video' ? VIDEO_EXTS : AUDIO_EXTS
    for (const file of Array.from(e.dataTransfer.files)) {
      const filePath = (file as File & { path?: string }).path
      if (!filePath) continue
      if (!exts.includes(extOf(file.name))) continue
      if (kind === 'video') await addVideoByPath(filePath)
      else await addAudioByPath(filePath)
    }
  }

  const selectVideoClip = (clip: TimelineVideoClip) => {
    setSelectedVideoId(clip.id)
    // The preview and the single-video tools follow the selection.
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
    } as VideoFile)
  }

  const handleExport = () => {
    const error = enqueueCompose({
      videoClips,
      audioClips: audioClips.map((a) => ({
        path: a.path,
        volume: a.volume,
      })),
      audioStartOffset,
      originalVolume,
    })
    onMessage(
      error ??
        `Timeline export queued (${videoClips.length} video clip(s), ${audioClips.length} audio clip(s), ${fmt(total)}) — see Render Queue.`
    )
  }

  const blockBase =
    'relative shrink-0 rounded-md px-2 py-2 text-left cursor-pointer select-none border transition-colors overflow-hidden'

  return (
    <div className="mt-6 border-t border-gray-700 pt-5">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <Film size={18} className="text-indigo-400" /> Timeline Editor
          <span className="text-sm font-normal text-gray-400">
            total {fmt(total)}
          </span>
        </h3>
        <div className="flex items-center gap-2">
          {(videoClips.length > 0 || audioClips.length > 0) && (
            <button
              onClick={() => {
                clearTimeline()
                setSelectedVideoId(null)
                setSelectedAudioId(null)
              }}
              className="flex items-center gap-1 px-3 py-1.5 bg-gray-800 hover:bg-red-600/30 text-gray-300 text-sm rounded-lg transition-colors"
              title="Remove every clip from the timeline"
            >
              <Trash2 size={14} /> Clear
            </button>
          )}
          <button
            onClick={handleExport}
            disabled={videoClips.length === 0}
            className="flex items-center gap-1 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded-lg transition-colors"
            title="Render the timeline into one video (a Render Queue job)"
          >
            <Download size={16} /> Export Timeline
          </button>
        </div>
      </div>

      {/* Video track */}
      <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">
        Video track — drag blocks to reorder, drop files to add
      </p>
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDropTrack('video')
        }}
        onDragLeave={() => setDropTrack(null)}
        onDrop={(e) => void handleDrop(e, 'video')}
        className={`flex items-stretch gap-1.5 rounded-lg bg-gray-900 border p-2 min-h-[64px] ${
          dropTrack === 'video' ? 'border-indigo-500' : 'border-gray-700'
        }`}
      >
        {videoClips.map((clip, index) => {
          const kept = Math.max(0, clip.trimEnd - clip.trimStart)
          return (
            <div
              key={clip.id}
              draggable
              onDragStart={() => {
                dragFrom.current = { track: 'video', index }
              }}
              onDragEnd={() => {
                dragFrom.current = null
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (dragFrom.current?.track === 'video') {
                  moveVideoClip(dragFrom.current.index, index)
                }
                dragFrom.current = null
              }}
              onClick={() => selectVideoClip(clip)}
              style={{ flexGrow: Math.max(kept, 0.5), flexBasis: 0 }}
              className={`${blockBase} min-w-[92px] ${
                clip.id === selectedVideoId
                  ? 'bg-indigo-600/40 border-indigo-400 text-white'
                  : 'bg-gray-800 border-gray-700 text-gray-200 hover:border-gray-500'
              }`}
              title={clip.path}
            >
              <p className="text-xs font-medium truncate">{clip.name}</p>
              <p className="text-[11px] text-gray-400">
                {fmt(kept)}
                {kept < clip.duration - 0.05 && ` of ${fmt(clip.duration)}`}
              </p>
            </div>
          )
        })}
        <button
          onClick={() => void handlePlus('video')}
          className="shrink-0 w-12 rounded-md border border-dashed border-gray-600 text-gray-400 hover:border-indigo-400 hover:text-indigo-300 flex items-center justify-center transition-colors"
          title="Add video files"
        >
          <Plus size={18} />
        </button>
      </div>

      {/* Quick add from imported videos / current video */}
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        {currentVideo &&
          !videoClips.some((c) => c.path === currentVideo.path) && (
            <button
              onClick={() =>
                addVideoClip({
                  id: uuidv4(),
                  path: currentVideo.path,
                  name: currentVideo.name,
                  duration: currentVideo.duration,
                  width: currentVideo.width,
                  height: currentVideo.height,
                  trimStart: 0,
                  trimEnd: currentVideo.duration,
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
                addVideoClip({
                  id: uuidv4(),
                  path: v.path,
                  name: v.name,
                  duration: v.duration,
                  width: v.width,
                  height: v.height,
                  trimStart: 0,
                  trimEnd: v.duration,
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

      {/* Selected video clip controls */}
      {selectedVideo && (
        <div className="flex items-center gap-3 mt-3 flex-wrap bg-gray-900 border border-gray-700 rounded-lg px-3 py-2">
          <span className="text-xs text-gray-300 font-medium truncate max-w-[220px]">
            {selectedVideo.name}
          </span>
          <label className="text-xs text-gray-400 flex items-center gap-1">
            Trim start (s)
            <input
              type="number"
              min={0}
              max={Math.max(0, selectedVideo.trimEnd - 0.1)}
              step={0.1}
              value={selectedVideo.trimStart}
              onChange={(e) => {
                const value = parseFloat(e.target.value)
                if (!Number.isFinite(value)) return
                updateVideoClip(selectedVideo.id, {
                  trimStart: Math.max(
                    0,
                    Math.min(value, selectedVideo.trimEnd - 0.1)
                  ),
                })
              }}
              className="w-20 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-gray-100"
            />
          </label>
          <label className="text-xs text-gray-400 flex items-center gap-1">
            Trim end (s)
            <input
              type="number"
              min={selectedVideo.trimStart + 0.1}
              max={selectedVideo.duration}
              step={0.1}
              value={selectedVideo.trimEnd}
              onChange={(e) => {
                const value = parseFloat(e.target.value)
                if (!Number.isFinite(value)) return
                updateVideoClip(selectedVideo.id, {
                  trimEnd: Math.max(
                    selectedVideo.trimStart + 0.1,
                    Math.min(value, selectedVideo.duration)
                  ),
                })
              }}
              className="w-20 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-gray-100"
            />
          </label>
          <span className="text-xs text-gray-500">
            keeps {fmt(selectedVideo.trimEnd - selectedVideo.trimStart)} of{' '}
            {fmt(selectedVideo.duration)}
          </span>
          <button
            onClick={() => {
              removeVideoClip(selectedVideo.id)
              setSelectedVideoId(null)
            }}
            className="flex items-center gap-1 px-2 py-1 bg-gray-800 hover:bg-red-600/30 text-red-300 text-xs rounded-lg transition-colors"
          >
            <X size={13} /> Remove clip
          </button>
        </div>
      )}

      {/* Audio track */}
      <p className="text-xs uppercase tracking-wide text-gray-500 mt-5 mb-1">
        Audio track — added clips play end to end over the video
      </p>
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDropTrack('audio')
        }}
        onDragLeave={() => setDropTrack(null)}
        onDrop={(e) => void handleDrop(e, 'audio')}
        className={`flex items-stretch gap-1.5 rounded-lg bg-gray-900 border p-2 min-h-[56px] ${
          dropTrack === 'audio' ? 'border-emerald-500' : 'border-gray-700'
        }`}
      >
        {audioClips.map((clip, index) => (
          <div
            key={clip.id}
            draggable
            onDragStart={() => {
              dragFrom.current = { track: 'audio', index }
            }}
            onDragEnd={() => {
              dragFrom.current = null
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (dragFrom.current?.track === 'audio') {
                moveAudioClip(dragFrom.current.index, index)
              }
              dragFrom.current = null
            }}
            onClick={() => setSelectedAudioId(clip.id)}
            style={{ flexGrow: Math.max(clip.duration, 0.5), flexBasis: 0 }}
            className={`${blockBase} min-w-[92px] ${
              clip.id === selectedAudioId
                ? 'bg-emerald-600/30 border-emerald-400 text-white'
                : 'bg-gray-800 border-gray-700 text-gray-200 hover:border-gray-500'
            }`}
            title={clip.path}
          >
            <p className="text-xs font-medium truncate flex items-center gap-1">
              <Music size={11} className="shrink-0" /> {clip.name}
            </p>
            <p className="text-[11px] text-gray-400">
              {fmt(clip.duration)} • vol {clip.volume}%
            </p>
          </div>
        ))}
        <button
          onClick={() => void handlePlus('audio')}
          className="shrink-0 w-12 rounded-md border border-dashed border-gray-600 text-gray-400 hover:border-emerald-400 hover:text-emerald-300 flex items-center justify-center transition-colors"
          title="Add audio files"
        >
          <Plus size={18} />
        </button>
      </div>

      {/* Audio track settings + selected audio clip */}
      <div className="flex items-center gap-4 mt-3 flex-wrap">
        <label className="text-xs text-gray-400 flex items-center gap-2">
          Audio starts at (s)
          <input
            type="number"
            min={0}
            step={0.5}
            value={audioStartOffset}
            onChange={(e) => {
              const value = parseFloat(e.target.value)
              if (Number.isFinite(value)) setAudioStartOffset(Math.max(0, value))
            }}
            className="w-20 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-gray-100"
          />
        </label>
        <label className="text-xs text-gray-400 flex items-center gap-2">
          Original audio {originalVolume}%
          <input
            type="range"
            min={0}
            max={100}
            value={originalVolume}
            onChange={(e) => setOriginalVolume(parseInt(e.target.value, 10))}
            className="w-28 accent-indigo-500"
          />
        </label>
        {selectedAudio && (
          <>
            <label className="text-xs text-gray-400 flex items-center gap-2">
              {selectedAudio.name} volume {selectedAudio.volume}%
              <input
                type="range"
                min={0}
                max={100}
                value={selectedAudio.volume}
                onChange={(e) =>
                  updateAudioClip(selectedAudio.id, {
                    volume: parseInt(e.target.value, 10),
                  })
                }
                className="w-28 accent-emerald-500"
              />
            </label>
            <button
              onClick={() => {
                removeAudioClip(selectedAudio.id)
                setSelectedAudioId(null)
              }}
              className="flex items-center gap-1 px-2 py-1 bg-gray-800 hover:bg-red-600/30 text-red-300 text-xs rounded-lg transition-colors"
            >
              <X size={13} /> Remove audio
            </button>
          </>
        )}
      </div>
      <p className="text-[11px] text-gray-600 mt-2">
        Clips are normalized to the first video clip's size and frame
        rate. The export lands next to the first clip as
        “.timeline.mp4” and runs as a normal Render Queue job.
      </p>
    </div>
  )
}
