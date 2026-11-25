import { FC, useEffect, useRef, useState } from 'react'
import { Trash2, CheckCircle, AlertCircle, Loader, Ban, FileX2, Columns2, X } from 'lucide-react'
import { useRenderQueue } from '@/stores/renderQueue'
import { cancelCurrentJob } from '@/lib/jobRunner'
import { toFileUrl } from '@/lib/files'
import type { RenderJobKind } from '@/types'
import type { FrameCompareResult } from '@/types/ipc'

const KIND_LABELS: Record<RenderJobKind, string> = {
  'remove-silence': 'Remove Silence',
  transcribe: 'Transcribe (faster-whisper)',
  'transcript-cuts': 'Apply Transcript Cuts',
  'burn-subtitles': 'Burn Karaoke Subtitles',
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
  'color-grade': 'Color Grade',
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

  // Frame compare (v0.4.3): tick two completed jobs, compare the
  // same-timestamp frame from both outputs, preview below the list.
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [compare, setCompare] = useState<{
    firstJobId: string
    secondJobId: string
    firstLabel: string
    secondLabel: string
    result: FrameCompareResult | null
    loading: boolean
    error: string | null
  } | null>(null)
  const compareRef = useRef<HTMLDivElement>(null)

  // A job can be compared when it finished and produced a video file.
  const isVideoOutput = (job: (typeof jobs)[number]) =>
    !!job.outputPath && /\.(mp4|webm|mov)$/i.test(job.outputPath)
  const canCompare = (job: (typeof jobs)[number]) =>
    job.status === 'completed' && isVideoOutput(job)

  const toggleSelect = (job: (typeof jobs)[number]) => {
    setSelectedIds((cur) => {
      if (cur.includes(job.id)) return cur.filter((id) => id !== job.id)
      if (cur.length >= 2) return cur // max two; the 3rd box is disabled
      return [...cur, job.id]
    })
  }

  // Drop a selection / compare whose job was removed (or cleared).
  useEffect(() => {
    setSelectedIds((cur) => {
      const kept = cur.filter((id) => jobs.some((j) => j.id === id))
      return kept.length === cur.length ? cur : kept
    })
    setCompare((cur) => {
      if (!cur) return cur
      const alive =
        jobs.some((j) => j.id === cur.firstJobId) &&
        jobs.some((j) => j.id === cur.secondJobId)
      return alive ? cur : null
    })
  }, [jobs])

  const handleCompare = async () => {
    const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p
    const [first, second] = selectedIds
      .map((id) => jobs.find((j) => j.id === id))
      .filter(
        (j): j is (typeof jobs)[number] => !!j && !!j.outputPath
      )
    if (!first || !second || !first.outputPath || !second.outputPath) return
    setCompare({
      firstJobId: first.id,
      secondJobId: second.id,
      firstLabel: `${KIND_LABELS[first.kind]} — ${baseName(first.outputPath)}`,
      secondLabel: `${KIND_LABELS[second.kind]} — ${baseName(second.outputPath)}`,
      result: null,
      loading: true,
      error: null,
    })
    const result = await window.electronAPI.getFrameCompare({
      firstPath: first.outputPath,
      secondPath: second.outputPath,
    })
    setCompare((cur) => {
      if (!cur || cur.firstJobId !== first.id || cur.secondJobId !== second.id)
        return cur
      if (!result.success || !result.data) {
        return {
          ...cur,
          loading: false,
          error: result.error ?? 'Could not extract compare frames.',
        }
      }
      return { ...cur, loading: false, result: result.data }
    })
    window.setTimeout(
      () =>
        compareRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        }),
      50
    )
  }

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

      {selectedIds.length > 0 && (
        <div className="bg-gray-900 rounded-lg px-4 py-3 border border-indigo-800 flex items-center justify-between gap-4">
          <p className="text-sm text-gray-300">
            Selected {selectedIds.length}/2 jobs to compare
            {selectedIds.length < 2 ? ' — tick one more job' : ''}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedIds([])}
              className="px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 text-white rounded transition-colors"
            >
              Clear selection
            </button>
            <button
              onClick={() => void handleCompare()}
              disabled={selectedIds.length !== 2}
              className="px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded transition-colors flex items-center gap-2"
            >
              <Columns2 size={16} /> Compare
            </button>
          </div>
        </div>
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
                {canCompare(job) && (
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(job.id)}
                    disabled={
                      selectedIds.length >= 2 &&
                      !selectedIds.includes(job.id)
                    }
                    onChange={() => toggleSelect(job)}
                    title={
                      selectedIds.length >= 2 &&
                      !selectedIds.includes(job.id)
                        ? 'Only 2 jobs can be compared — untick one first'
                        : 'Tick to compare with another job'
                    }
                    className="mt-1.5 w-4 h-4 accent-indigo-500 cursor-pointer disabled:cursor-not-allowed"
                  />
                )}
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

      {compare && (
        <div
          ref={compareRef}
          className="bg-gray-900 rounded-lg p-4 border border-gray-800"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-white font-medium">Frame Compare</h2>
              {compare.result && (
                <p className="text-xs text-gray-500 mt-1">
                  Same moment in both videos —{' '}
                  {compare.result.timeSeconds.toFixed(2)}s (half the shorter
                  clip)
                </p>
              )}
            </div>
            <button
              onClick={() => setCompare(null)}
              className="p-2 hover:bg-gray-800 rounded transition-colors"
              title="Close compare"
            >
              <X size={18} className="text-gray-400" />
            </button>
          </div>
          {compare.loading && (
            <p className="text-sm text-blue-300 mt-4">
              Extracting frames…
            </p>
          )}
          {compare.error && (
            <p className="text-sm text-red-400 mt-4">{compare.error}</p>
          )}
          {compare.result && (
            <div className="grid grid-cols-2 gap-4 mt-4">
              {(
                [
                  {
                    label: compare.firstLabel,
                    frame: compare.result.firstFrame,
                    w: compare.result.firstWidth,
                    h: compare.result.firstHeight,
                  },
                  {
                    label: compare.secondLabel,
                    frame: compare.result.secondFrame,
                    w: compare.result.secondWidth,
                    h: compare.result.secondHeight,
                  },
                ] as const
              ).map((side) => (
                <div key={side.frame}>
                  <p className="text-sm text-gray-300 font-medium break-all">
                    {side.label}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {side.w}×{side.h}
                  </p>
                  <img
                    src={toFileUrl(side.frame)}
                    alt={side.label}
                    className="mt-2 w-full rounded border border-gray-700"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
