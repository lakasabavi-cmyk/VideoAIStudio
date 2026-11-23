import { FC } from 'react'
import { useVideoStore } from '@/stores/videoStore'
import { useRenderQueue } from '@/stores/renderQueue'
import { VideoPreview } from '@/components/VideoPreview'
import { Trash2 } from 'lucide-react'

export const Dashboard: FC = () => {
  const { videos, currentVideo, removeVideo } = useVideoStore()
  const { jobs } = useRenderQueue()

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
      </div>

      {videos.length > 0 && (
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <h2 className="text-2xl font-bold text-white mb-4">Your Videos</h2>
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
