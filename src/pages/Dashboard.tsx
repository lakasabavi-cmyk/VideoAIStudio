import { FC, useState } from 'react'
import { useVideoStore } from '@/stores/videoStore'
import { useRenderQueue } from '@/stores/renderQueue'
import { VideoPreview } from '@/components/VideoPreview'
import {
  enqueueRemoveSilence,
  enqueueAdjustVolume,
  enqueueGetLastFrame,
  enqueueMerge,
  enqueueAddMusic,
  enqueueExport,
} from '@/lib/jobRunner'
import type { VideoFile } from '@/types'
import { Trash2, VolumeX, Volume2, Music, Download, Image } from 'lucide-react'

export const Dashboard: FC = () => {
  const { videos, currentVideo, removeVideo } = useVideoStore()
  const { jobs } = useRenderQueue()
  const [actionMessage, setActionMessage] = useState<string | null>(null)

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

  const handleRemoveVideo = (id: string) => {
    removeVideo(id)
  }

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-4xl font-bold text-white mb-2">Dashboard</h1>
        <p className="text-gray-400">Welcome to VideoAIStudio v0.1</p>
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
                  <button
                    onClick={() => handleRemoveVideo(video.id)}
                    className="p-2 hover:bg-red-600/20 text-red-400 rounded transition-colors"
                    title="Delete video"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
