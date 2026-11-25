import { FC, useState } from 'react'
import { useVideoStore } from '@/stores/videoStore'
import { useTimelineStore } from '@/stores/timelineStore'
import { useRenderQueue } from '@/stores/renderQueue'
import { VideoPreview } from '@/components/VideoPreview'
import {
  enqueueRemoveSilence,
  enqueueAdjustVolume,
  enqueueGetLastFrame,
  enqueueMerge,
  enqueueAddMusic,
  enqueueExport,
  enqueueUpscale,
  enqueueColorGrade,
} from '@/lib/jobRunner'
import { BUILTIN_LUTS, LUT_CUSTOM, LUT_NONE } from '@/lib/luts'
import type { VideoFile } from '@/types'
import { Trash2, VolumeX, Volume2, Music, Download, Image, Scaling, Palette } from 'lucide-react'

export const Dashboard: FC = () => {
  const { videos, currentVideo, removeVideo, setCurrentVideo } = useVideoStore()
  const { jobs } = useRenderQueue()
  const [actionMessage, setActionMessage] = useState<string | null>(null)

  // Color Grade panel (v0.4.0): one panel for whichever video
  // the button was pressed on; defaults match the plan
  // (balance on, warm cinematic, 70%).
  const [gradeVideo, setGradeVideo] = useState<VideoFile | null>(null)
  const [gradeAutoBalance, setGradeAutoBalance] = useState(true)
  const [gradeLut, setGradeLut] = useState('warm-cinematic')
  const [gradeStrength, setGradeStrength] = useState(70)
  const [gradeCustomPath, setGradeCustomPath] = useState<string | null>(null)
  const [gradeCustomName, setGradeCustomName] = useState<string | null>(null)

  const openGradePanel = (video: VideoFile) => {
    setGradeVideo(video)
    setGradeAutoBalance(true)
    setGradeLut('warm-cinematic')
    setGradeStrength(70)
    setGradeCustomPath(null)
    setGradeCustomName(null)
  }

  const handlePickLutFile = async () => {
    const result = await window.electronAPI.selectLutFile()
    if (result.success && result.data) {
      setGradeCustomPath(result.data.filePath)
      setGradeCustomName(result.data.fileName)
    } else if (result.error && result.error !== 'User canceled selection') {
      setActionMessage(`Could not pick a LUT file: ${result.error}`)
    }
  }

  const handleRunGrade = () => {
    if (!gradeVideo) return
    if (gradeLut === LUT_CUSTOM && !gradeCustomPath) {
      setActionMessage('Pick a custom .cube file first.')
      return
    }
    if (gradeLut === LUT_NONE && !gradeAutoBalance) {
      setActionMessage(
        'Nothing to grade: turn on Auto Balance or pick a LUT.'
      )
      return
    }
    enqueueColorGrade(gradeVideo, {
      autoBalance: gradeAutoBalance,
      lut: gradeLut,
      customLutPath: gradeCustomPath ?? undefined,
      strength: gradeStrength,
    })
    setActionMessage(
      `Color Grade job queued for ${gradeVideo.name} — see Render Queue.`
    )
    setGradeVideo(null)
  }

  const handleUpscale = (video: VideoFile) => {
    const error = enqueueUpscale(video)
    setActionMessage(
      error ?? `Upscale job queued for ${video.name} — see Render Queue.`
    )
  }

  const handleAddMusic = (video: VideoFile) => {
    const error = enqueueAddMusic(video)
    setActionMessage(
      error ?? `Add Music job queued for ${video.name} — see Render Queue.`
    )
  }

  const actionButtons = (video: VideoFile) => (
    <div className="flex items-center gap-2">
      <button
        onClick={() => {
          enqueueRemoveSilence(video)
          setActionMessage(
            `Remove Silence job queued for ${video.name} — see Render Queue.`
          )
        }}
        className="flex items-center gap-1 px-3 py-1.5 bg-gray-800 hover:bg-indigo-600 text-gray-200 text-sm rounded-lg transition-colors"
        title="Remove silence"
      >
        <VolumeX size={16} /> Remove Silence
      </button>
      <button
        onClick={() => {
          enqueueAdjustVolume(video)
          setActionMessage(
            `Adjust Volume job queued for ${video.name} — see Render Queue.`
          )
        }}
        className="flex items-center gap-1 px-3 py-1.5 bg-gray-800 hover:bg-indigo-600 text-gray-200 text-sm rounded-lg transition-colors"
        title="Render a copy with the original audio at the volume set in Settings (0% = muted)"
      >
        <Volume2 size={16} /> Adjust Volume
      </button>
      <button
        onClick={() => handleAddMusic(video)}
        className="flex items-center gap-1 px-3 py-1.5 bg-gray-800 hover:bg-indigo-600 text-gray-200 text-sm rounded-lg transition-colors"
        title="Add background music"
      >
        <Music size={16} /> Add Music
      </button>
      <button
        onClick={() => {
          enqueueGetLastFrame(video)
          setActionMessage(
            `Get Last Frame job queued for ${video.name} — the frame is saved into a "first frame" folder next to the video.`
          )
        }}
        className="flex items-center gap-1 px-3 py-1.5 bg-gray-800 hover:bg-indigo-600 text-gray-200 text-sm rounded-lg transition-colors"
        title="Extract the last frame as a PNG into a 'first frame' folder"
      >
        <Image size={16} /> Last Frame
      </button>
      <button
        onClick={() => handleUpscale(video)}
        className="flex items-center gap-1 px-3 py-1.5 bg-gray-800 hover:bg-indigo-600 text-gray-200 text-sm rounded-lg transition-colors"
        title="Upscale this video (method and options are set in Settings)"
      >
        <Scaling size={16} /> Upscale
      </button>
      <button
        onClick={() => openGradePanel(video)}
        className="flex items-center gap-1 px-3 py-1.5 bg-gray-800 hover:bg-indigo-600 text-gray-200 text-sm rounded-lg transition-colors"
        title="Color Grade: auto brightness balance + LUT (default warm cinematic 70%)"
      >
        <Palette size={16} /> Color Grade
      </button>
      <button
        onClick={() => {
          enqueueExport(video)
          setActionMessage(
            `Export job queued for ${video.name} — see Render Queue.`
          )
        }}
        className="flex items-center gap-1 px-3 py-1.5 bg-gray-800 hover:bg-indigo-600 text-gray-200 text-sm rounded-lg transition-colors"
        title="Export video"
      >
        <Download size={16} /> Export
      </button>
    </div>
  )

  const completedJobs = jobs.filter((j) => j.status === 'completed').length
  const processingJobs = jobs.filter((j) => j.status === 'processing').length
  const totalDuration = videos.reduce((sum, v) => sum + v.duration, 0)

  // Two-step file delete: the first click arms the button,
  // the second sends the file to the Recycle Bin and removes
  // every reference to it (library, current video, timeline).
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const handleDeleteVideo = async (video: VideoFile) => {
    if (confirmDeleteId !== video.id) {
      setConfirmDeleteId(video.id)
      window.setTimeout(() => {
        setConfirmDeleteId((cur) => (cur === video.id ? null : cur))
      }, 3500)
      return
    }
    setConfirmDeleteId(null)
    const result = await window.electronAPI.deleteFile(video.path)
    if (!result.success) {
      setActionMessage(
        `Could not delete ${video.name}: ${result.error ?? 'unknown error'}`
      )
      return
    }
    const timeline = useTimelineStore.getState()
    timeline.videoClips
      .filter((c) => c.path === video.path)
      .forEach((c) => timeline.removeVideoClip(c.id))
    timeline.audioClips
      .filter((c) => c.path === video.path)
      .forEach((c) => timeline.removeAudioClip(c.id))
    if (currentVideo?.id === video.id) setCurrentVideo(null)
    removeVideo(video.id)
    setActionMessage(`Moved ${video.name} to the Recycle Bin.`)
  }

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-4xl font-bold text-white mb-2">Dashboard</h1>
        <p className="text-gray-400">Welcome to VideoAIStudio v{__APP_VERSION__}</p>
      </div>

      <div className="grid grid-cols-4 gap-6">
        <div className="bg-gradient-to-br from-indigo-600 to-purple-600 rounded-lg p-6 text-white">
          <p className="text-sm opacity-80">Total Videos</p>
          <p className="text-3xl font-bold">{videos.length}</p>
        </div>
        <div className="bg-gradient-to-br from-blue-600 to-cyan-600 rounded-lg p-6 text-white">
          <p className="text-sm opacity-80">Total Duration</p>
          <p className="text-3xl font-bold">{totalDuration.toFixed(0)}s</p>
        </div>
        <div className="bg-gradient-to-br from-green-600 to-emerald-600 rounded-lg p-6 text-white">
          <p className="text-sm opacity-80">Completed Renders</p>
          <p className="text-3xl font-bold">{completedJobs}</p>
        </div>
        <div className="bg-gradient-to-br from-orange-600 to-red-600 rounded-lg p-6 text-white">
          <p className="text-sm opacity-80">Processing</p>
          <p className="text-3xl font-bold">{processingJobs}</p>
        </div>
      </div>

      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <h2 className="text-2xl font-bold text-white mb-4">Current Video</h2>
        <VideoPreview video={currentVideo} />
        {currentVideo && (
          <div className="mt-4 flex items-center gap-3 flex-wrap">
            {actionButtons(currentVideo)}
          </div>
        )}
        {actionMessage && (
          <p className="text-sm text-indigo-300 mt-3">{actionMessage}</p>
        )}
      </div>

      {gradeVideo && (
        <div className="bg-gray-800 rounded-lg p-6 border border-indigo-500">
          <h2 className="text-xl font-bold text-white mb-1">
            Color Grade — {gradeVideo.name}
          </h2>
          <p className="text-sm text-gray-400 mb-4">
            Auto balance runs first (only when the clip&apos;s range is
            actually compressed), then the LUT. Output is saved next to
            the video as <span className="text-gray-200">.graded.mp4</span>.
          </p>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <label className="flex items-center gap-2 text-sm text-gray-200">
              <input
                type="checkbox"
                checked={gradeAutoBalance}
                onChange={(e) => setGradeAutoBalance(e.target.checked)}
                className="w-4 h-4 accent-indigo-600"
              />
              Auto Balance
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-200">
              LUT
              <select
                value={gradeLut}
                onChange={(e) => setGradeLut(e.target.value)}
                className="bg-gray-900 border border-gray-700 text-gray-200 text-sm rounded-lg px-2 py-1.5"
              >
                <option value={LUT_NONE}>None</option>
                {BUILTIN_LUTS.map((lut) => (
                  <option key={lut.id} value={lut.id}>
                    {lut.label}
                  </option>
                ))}
                <option value={LUT_CUSTOM}>Custom file…</option>
              </select>
            </label>
            {gradeLut === LUT_CUSTOM && (
              <span className="flex items-center gap-2">
                <button
                  onClick={() => void handlePickLutFile()}
                  className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm rounded-lg transition-colors"
                >
                  Choose .cube file…
                </button>
                {gradeCustomName && (
                  <span className="text-sm text-gray-300">{gradeCustomName}</span>
                )}
              </span>
            )}
            <label className="flex items-center gap-2 text-sm text-gray-200">
              Strength
              <input
                type="range"
                min={0}
                max={100}
                value={gradeStrength}
                onChange={(e) => setGradeStrength(Number(e.target.value))}
                className="w-40 accent-indigo-600"
              />
              <span className="w-10 text-right">{gradeStrength}%</span>
            </label>
          </div>
          <div className="flex items-center gap-2 mt-5">
            <button
              onClick={handleRunGrade}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-lg transition-colors"
            >
              Run Color Grade
            </button>
            <button
              onClick={() => setGradeVideo(null)}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm rounded-lg transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {videos.length > 0 && (
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <h2 className="text-2xl font-bold text-white mb-4">Your Videos</h2>
          {videos.length >= 2 && (
            <div className="mb-4 flex items-center gap-3 flex-wrap">
              <button
                onClick={() => {
                  enqueueMerge(videos)
                  setActionMessage(
                    `Merge job queued: ${videos.length} videos in list order — see Render Queue.`
                  )
                }}
                className="flex items-center gap-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-lg transition-colors"
                title="Merge all videos in list order; the first frame of each following clip is dropped because it duplicates the previous clip's last frame"
              >
                <Download size={16} className="rotate-90" /> Merge {videos.length} Videos
              </button>
              <span className="text-xs text-gray-500">
                List order = merge order. The first frame of every clip
                after the first is dropped (it duplicates the previous
                clip's last frame).
              </span>
            </div>
          )}
          <div className="space-y-3">
            {videos.map((video) => (
              <div
                key={video.id}
                className="flex items-center justify-between bg-gray-900 rounded-lg p-4 border border-gray-700 hover:border-indigo-500 transition-colors"
              >
                <div className="flex-1">
                  <p className="font-semibold text-white">{video.name}</p>
                  <p className="text-sm text-gray-400">
                    {video.width}×{video.height} • {video.duration.toFixed(2)}s • {(video.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {actionButtons(video)}
                  {confirmDeleteId === video.id ? (
                    <button
                      onClick={() => void handleDeleteVideo(video)}
                      className="px-3 py-2 bg-red-600 hover:bg-red-500 text-white text-xs font-medium rounded transition-colors"
                      title="Click again to move this file to the Recycle Bin"
                    >
                      Delete file?
                    </button>
                  ) : (
                    <button
                      onClick={() => void handleDeleteVideo(video)}
                      className="p-2 hover:bg-red-600/20 text-red-400 rounded transition-colors"
                      title="Delete this file from disk (moves it to the Recycle Bin) and remove it from the library and the timeline"
                    >
                      <Trash2 size={18} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
