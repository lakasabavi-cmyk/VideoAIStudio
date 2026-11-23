import { FC, useState } from 'react'
import { Upload, AlertCircle } from 'lucide-react'
import { useVideoStore } from '@/stores/videoStore'
import type { VideoFile } from '@/types'
import { v4 as uuidv4 } from 'uuid'

export const Import: FC = () => {
  const { addVideo, setCurrentVideo } = useVideoStore()
  const [isDragging, setIsDragging] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastImported, setLastImported] = useState<VideoFile | null>(null)

  const handleSelectVideo = async () => {
    setError(null)
    setIsLoading(true)

    try {
      // Select video file
      const selectResult = await window.electronAPI.selectVideo()
      if (!selectResult.success || !selectResult.data) {
        setError(selectResult.error || 'Failed to select video')
        setIsLoading(false)
        return
      }

      const { filePath, fileSize, fileName } = selectResult.data

      // Get video metadata
      const metadataResult = await window.electronAPI.getVideoMetadata(filePath)
      if (!metadataResult.success || !metadataResult.data) {
        setError(metadataResult.error || 'Failed to load video metadata')
        setIsLoading(false)
        return
      }

      const metadata = metadataResult.data
      
      // Create video file object
      const videoFile: VideoFile = {
        id: uuidv4(),
        path: filePath,
        name: fileName,
        duration: metadata.duration ?? 0,
        width: metadata.width ?? 0,
        height: metadata.height ?? 0,
        fps: metadata.fps ?? 0,
        codec: metadata.codec ?? 'unknown',
        bitrate: `${((metadata.bitrate ?? 0) / 1000000).toFixed(2)} Mbps`,
        size: fileSize,
        createdAt: new Date(),
      }

      // Add to store and set as current
      addVideo(videoFile)
      setCurrentVideo(videoFile)
      setLastImported(videoFile)
      setError(null)
    } catch (err) {
      setError((err as Error).message || 'An error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  const handleDragEnter = () => setIsDragging(true)
  const handleDragLeave = () => setIsDragging(false)
  const handleDrop = () => setIsDragging(false)

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-4xl font-bold text-white mb-2">Import Video</h1>
        <p className="text-gray-400">Add video files to your project</p>
      </div>

      {error && (
        <div className="bg-red-500/20 border border-red-500 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="text-red-500" size={20} />
          <span className="text-red-100">{error}</span>
        </div>
      )}

      <div
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
          isDragging ? 'border-indigo-500 bg-indigo-500/10' : 'border-gray-700 hover:border-gray-600'
        }`}
      >
        <Upload size={48} className="mx-auto mb-4 text-indigo-500" />
        <p className="text-xl font-semibold text-white mb-2">Select Video File</p>
        <p className="text-gray-400 mb-4">Choose a video to import and process</p>
        <button
          onClick={handleSelectVideo}
          disabled={isLoading}
          className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-600 text-white rounded-lg transition-colors"
        >
          {isLoading ? 'Loading...' : 'Browse Files'}
        </button>
      </div>

      <div className="text-sm text-gray-400">
        <p className="font-semibold mb-2">Supported formats:</p>
        <p>MP4, MOV, MKV, AVI, WebM, FLV, WMV</p>
      </div>

      {lastImported && (
        <div className="bg-green-500/20 border border-green-500 rounded-lg p-6">
          <p className="text-green-100 font-semibold mb-4">✓ Video Imported Successfully!</p>
          <div className="grid grid-cols-2 gap-4 text-green-100 text-sm">
            <div>
              <p className="text-green-200/70">Name</p>
              <p className="font-mono">{lastImported.name}</p>
            </div>
            <div>
              <p className="text-green-200/70">Duration</p>
              <p className="font-mono">{lastImported.duration.toFixed(2)}s</p>
            </div>
            <div>
              <p className="text-green-200/70">Resolution</p>
              <p className="font-mono">{lastImported.width}x{lastImported.height}px</p>
            </div>
            <div>
              <p className="text-green-200/70">Size</p>
              <p className="font-mono">{(lastImported.size / 1024 / 1024).toFixed(2)} MB</p>
            </div>
            <div>
              <p className="text-green-200/70">Codec</p>
              <p className="font-mono">{lastImported.codec}</p>
            </div>
            <div>
              <p className="text-green-200/70">FPS</p>
              <p className="font-mono">{lastImported.fps.toFixed(2)}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

