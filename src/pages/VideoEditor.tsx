import { FC, useState } from 'react'
import { TimelineEditor } from '@/components/TimelineEditor'

/**
 * Video Editor (v0.4.1): the timeline is its own top-level
 * feature now — it used to live inside the Dashboard's
 * "Current Video" card. The timeline state itself is unchanged
 * (same zustand store, same persisted project).
 */
export const VideoEditor: FC = () => {
  const [actionMessage, setActionMessage] = useState<string | null>(null)

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold text-white mb-1">Video Editor</h1>
      <p className="text-sm text-gray-400 mb-4">
        Cut, arrange and grade your clips on the timeline, then build
        the movie. Filters apply per clip, like a lens filter.
      </p>
      <TimelineEditor onMessage={setActionMessage} />
      {actionMessage && (
        <p className="text-sm text-indigo-300 mt-3">{actionMessage}</p>
      )}
    </div>
  )
}
