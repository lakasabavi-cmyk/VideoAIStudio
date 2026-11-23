import { FC, useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, FolderOpen } from 'lucide-react'

/**
 * Viewer for the on-disk app log (bottom of the Settings page).
 * The log is written synchronously by the main
 * process, so after a crash — even a full machine shutdown —
 * reopening the app shows exactly what happened up to the end:
 * job starts/finishes, tool failures, and the system stats
 * sampled every 10s during upscale jobs.
 */
export const LogViewer: FC = () => {
  const [text, setText] = useState('')
  const [path, setPath] = useState('')
  const preRef = useRef<HTMLPreElement>(null)

  const load = useCallback(async () => {
    const api = window.electronAPI
    if (!api?.getLogTail) return
    try {
      const result = await api.getLogTail()
      setText(result.text)
      setPath(result.path)
      // Keep the newest lines in view.
      requestAnimationFrame(() => {
        const el = preRef.current
        if (el) el.scrollTop = el.scrollHeight
      })
    } catch {
      // Log stays empty outside Electron.
    }
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(load, 5000)
    return () => clearInterval(timer)
  }, [load])

  return (
    <div className="bg-gray-900 rounded-lg p-6 border border-gray-800 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-xl font-bold text-white">App Log</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="flex items-center gap-1 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm rounded-lg transition-colors"
          >
            <RefreshCw size={14} /> Refresh
          </button>
          <button
            onClick={() => window.electronAPI?.openLogFile()}
            className="flex items-center gap-1 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm rounded-lg transition-colors"
          >
            <FolderOpen size={14} /> Open Log File
          </button>
        </div>
      </div>
      {path && <p className="text-xs text-gray-500 break-all">{path}</p>}
      <pre
        ref={preRef}
        className="h-64 overflow-auto bg-black/40 border border-gray-800 rounded-lg p-3 text-[11px] leading-relaxed text-gray-300 whitespace-pre-wrap break-all"
      >
        {text || '(log is empty)'}
      </pre>
      <p className="text-xs text-gray-500">
        The log survives crashes and shutdowns — if the machine dies
        during a job, reopen the app and read the last lines here:
        they show the load and temperatures right before the end.
      </p>
    </div>
  )
}
