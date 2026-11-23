import { FC, useEffect, useState } from 'react'
import { Trash2, CheckCircle, AlertCircle, Loader, Ban, FileX2 } from 'lucide-react'
import { useRenderQueue } from '@/stores/renderQueue'
import { cancelCurrentJob } from '@/lib/jobRunner'
import type { RenderJobKind } from '@/types'

const KIND_LABELS: Record<RenderJobKind, string> = {
  'remove-silence': 'Remove Silence',
  'add-music': 'Add Music',
  'adjust-volume': 'Adjust Volume',
  'get-last-frame': 'Get Last Frame',
  merge: 'Merge Videos',
  upscale: 'Upscale',
  trim: 'Trim',
  split: 'Split Clip',
  crop: 'Crop',
  speed: 'Speed',
  transform: 'Rotate / Flip',
  timeline: 'Timeline Thumbnails',
  compose: 'Build Movie',
  export: 'Export',
}

function formatClock(date?: Date): string {
  if (!date) return ''
  return new Date(date).toLocaleTimeString([], { hour12: false })
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const mm = String(minutes).padStart(2, '0')
  const ss = String(seconds).padStart(2, '0')
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`
}

export const RenderQueue: FC = () => {
  const { jobs, removeJob, clearCompleted } = useRenderQueue()

  // Tick once a second while any job is processing so the elapsed
  // time and ETA stay live.
  const [now, setNow] = useState(() => Date.now())
  const anyProcessing = jobs.some((j) => j.status === 'processing')
  useEffect(() => {
    if (!anyProcessing) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [anyProcessing])

  // Two-step delete of a job's output file (the trimmed /
  // split / rendered leftovers): first click arms, second
  // sends the file to the Recycle Bin and drops the entry.
  const [confirmFileId, setConfirmFileId] = useState<string | null>(null)
  const [fileMessage, setFileMessage] = useState<string | null>(null)
  const handleDeleteOutputFile = async (job: (typeof jobs)[number]) => {
    if (!job.outputPath) return
    if (confirmFileId !== job.id) {
      setConfirmFileId(job.id)
      window.setTimeout(() => {
        setConfirmFileId((cur) => (cur === job.id ? null : cur))
      }, 3500)
      return
    }
    setConfirmFileId(null)
    const result = await window.electronAPI.deleteFile(job.outputPath)
    if (!result.success) {
      setFileMessage(
        `Could not delete ${job.outputPath}: ${result.error ?? 'unknown error'}`
      )
      return
    }
    removeJob(job.id)
    setFileMessage(`Moved the output file to the Recycle Bin: ${job.outputPath}`)
  }

  const timeLine = (job: (typeof jobs)[number]) => {
    if (job.status === 'pending') {
      return `Queued ${formatClock(job.createdAt)}`
    }
    if (!job.startedAt) return ''
    const started = new Date(job.startedAt).getTime()
    if (job.status === 'processing') {
      const elapsed = now - started
      let line = `Started ${formatClock(job.startedAt)} · Elapsed ${formatDuration(elapsed)}`
      if (job.progress >= 5 && job.progress < 100) {
        const etaMs = (elapsed * (100 - job.progress)) / job.progress
        line += ` · ETA ~${formatDuration(etaMs)}`
      }
      return line
    }
    if (job.finishedAt) {
      const took = new Date(job.finishedAt).getTime() - started
      return job.status === 'cancelled'
        ? `Cancelled after ${formatDuration(took)} · ${formatClock(job.finishedAt)}`
        : `Took ${formatDuration(took)} · Finished ${formatClock(job.finishedAt)}`
    }
    return ''
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="text-green-500" size={20} />
      case 'processing':
        return <Loader className="text-blue-500 animate-spin" size={20} />
      case 'failed':
        return <AlertCircle className="text-red-500" size={20} />
      case 'cancelled':
        return <Ban className="text-gray-500" size={20} />
      default:
        return <div className="w-5 h-5 border border-gray-600 rounded" />
    }
  }

  return (
    <div className="p-8 space-y-8">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-4xl font-bold text-white mb-2">Render Queue</h1>
          <p className="text-gray-400">Monitor your video processing jobs</p>
        </div>
        {jobs.some((j) => j.status === 'completed') && (
          <button
            onClick={clearCompleted}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
          >
            Clear Completed
          </button>
        )}
      </div>

      {fileMessage && (
        <p className="text-sm text-indigo-300">{fileMessage}</p>
      )}

      {jobs.length === 0 ? (
        <div className="bg-gray-900 rounded-lg p-12 border border-gray-800 text-center">
          <p className="text-gray-400">No jobs in queue</p>
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => (
            <div
              key={job.id}
              className="bg-gray-900 rounded-lg p-4 border border-gray-800 flex items-start justify-between"
            >
              <div className="flex items-start gap-4 flex-1 min-w-0">
                <div className="mt-1">{getStatusIcon(job.status)}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-medium">
                    {KIND_LABELS[job.kind]} — {job.videoName}
                  </p>
                  <div className="w-full bg-gray-800 rounded-full h-2 mt-2">
                    <div
                      className="bg-indigo-600 h-2 rounded-full"
                      style={{ width: job.progress + '%' }}
                    />
                  </div>
                  {job.status === 'processing' && job.stage && (
                    <p className="text-sm text-blue-300 mt-2">
                      Stage: {job.stage}
                    </p>
                  )}
                  <p className="text-xs text-gray-500 mt-1">{timeLine(job)}</p>
                  {job.status === 'completed' && job.outputPath && (
                    <p className="text-sm text-green-400 mt-2 break-all">
                      Output: {job.outputPath}
                    </p>
                  )}
                  {job.status === 'failed' && job.error && (
                    <p className="text-sm text-red-400 mt-2 break-all">
                      {job.error}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-4 ml-4">
                <span className="text-sm text-gray-400">{job.progress}%</span>
                {job.status === 'processing' ? (
                  <button
                    onClick={() => cancelCurrentJob()}
                    className="px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
                  >
                    Cancel
                  </button>
                ) : (
                  <>
                    {job.outputPath && job.status !== 'pending' && (
                      confirmFileId === job.id ? (
                        <button
                          onClick={() => void handleDeleteOutputFile(job)}
                          className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-xs font-medium rounded transition-colors whitespace-nowrap"
                          title="Click again to move the output file to the Recycle Bin"
                        >
                          Delete file?
                        </button>
                      ) : (
                        <button
                          onClick={() => void handleDeleteOutputFile(job)}
                          className="p-2 hover:bg-gray-800 rounded transition-colors"
                          title="Delete the output file from disk (Recycle Bin) and remove this entry"
                        >
                          <FileX2 size={18} className="text-red-400" />
                        </button>
                      )
                    )}
                    <button
                      onClick={() => removeJob(job.id)}
                      className="p-2 hover:bg-gray-800 rounded transition-colors"
                      title="Remove this entry only (the file stays on disk)"
                    >
                      <Trash2 size={18} className="text-red-500" />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
