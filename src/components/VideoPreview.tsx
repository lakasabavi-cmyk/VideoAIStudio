import { FC, useRef, useState } from 'react'
import { Play, Pause } from 'lucide-react'
import type { VideoFile } from '@/types'
import { toFileUrl } from '@/lib/files'

interface VideoPreviewProps {
  video: VideoFile | null
}

export const VideoPreview: FC<VideoPreviewProps> = ({ video }) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)

  if (!video) {
    return (
      <div className="w-full h-96 bg-gray-900 rounded-lg flex items-center justify-center border border-gray-800">
        <p className="text-gray-400">No video selected</p>
      </div>
    )
  }

  const togglePlayPause = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause()
      } else {
        videoRef.current.play()
      }
      setIsPlaying(!isPlaying)
    }
  }

  const handleVideoPlay = () => setIsPlaying(true)
  const handleVideoPause = () => setIsPlaying(false)

  return (
    <div className="w-full space-y-4">
      <div className="bg-gray-900 rounded-lg p-4 border border-gray-800 relative group">
        <video
          key={video.id}
          ref={videoRef}
          src={toFileUrl(video.path)}
          onPlay={handleVideoPlay}
          onPause={handleVideoPause}
          onEnded={handleVideoPause}
          className="w-full h-96 bg-black rounded"
        />
        <button
          onClick={togglePlayPause}
          className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          {isPlaying ? (
            <Pause size={48} className="text-white drop-shadow-lg" />
          ) : (
            <Play size={48} className="text-white drop-shadow-lg ml-1" />
          )}
        </button>
      </div>

      <div className="space-y-2">
        <h3 className="text-white font-semibold">{video.name}</h3>
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
            <p className="text-xs text-gray-400 uppercase">Duration</p>
            <p className="text-lg font-semibold text-indigo-400">{video.duration.toFixed(2)}s</p>
          </div>
          <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
            <p className="text-xs text-gray-400 uppercase">Resolution</p>
            <p className="text-lg font-semibold text-indigo-400">{video.width}×{video.height}</p>
          </div>
          <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
            <p className="text-xs text-gray-400 uppercase">Size</p>
            <p className="text-lg font-semibold text-indigo-400">{(video.size / 1024 / 1024).toFixed(2)} MB</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
            <p className="text-xs text-gray-400 uppercase">FPS</p>
            <p className="text-lg font-semibold text-purple-400">{video.fps.toFixed(2)}</p>
          </div>
          <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
            <p className="text-xs text-gray-400 uppercase">Codec</p>
            <p className="text-lg font-semibold text-purple-400">{video.codec}</p>
          </div>
          <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
            <p className="text-xs text-gray-400 uppercase">Bitrate</p>
            <p className="text-lg font-semibold text-purple-400">{video.bitrate}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
