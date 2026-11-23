import { FC } from 'react'
import { Trash2, CheckCircle, AlertCircle, Loader } from 'lucide-react'
import { useRenderQueue } from '@/stores/renderQueue'
import type { RenderJobKind } from '@/types'

const KIND_LABELS: Record<RenderJobKind, string> = {
  'remove-silence': 'Remove Silence',
  'add-music': 'Add Music',
  'adjust-volume': 'Adjust Volume',
  'get-last-frame': 'Get Last Frame',
  merge: 'Merge Videos',
  export: 'Export',
}

export const RenderQueue: FC = () => {
  const { jobs, removeJob, clearCompleted } = useRenderQueue()

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="text-green-500" size={20} />
      case 'processing':
        return <Loader className="text-blue-500 animate-spin" size={20} />
      case 'failed':
        return <AlertCircle className="text-red-500" size={20} />
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
                <button
                  onClick={() => removeJob(job.id)}
                  className="p-2 hover:bg-gray-800 rounded transition-colors"
                >
                  <Trash2 size={18} className="text-red-500" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
