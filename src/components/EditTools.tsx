import { FC, useState } from 'react'
import type { VideoFile } from '@/types'
import {
  enqueueTrim,
  enqueueSplit,
  enqueueCrop,
  enqueueSpeed,
  enqueueTransform,
  enqueueTimeline,
} from '@/lib/jobRunner'
import {
  Scissors,
  Crop,
  Gauge,
  RotateCw,
  RotateCcw,
  FlipHorizontal2,
  FlipVertical2,
  LayoutGrid,
} from 'lucide-react'

const num = (s: string, fallback: number): number => {
  const v = parseFloat(s)
  return Number.isFinite(v) ? v : fallback
}
const even = (n: number): number => Math.max(2, Math.floor(n / 2) * 2)

const inputCls =
  'w-24 px-2 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm'
const btnCls =
  'flex items-center gap-1 px-3 py-1.5 bg-gray-800 hover:bg-indigo-600 text-gray-200 text-sm rounded-lg transition-colors'
const chipCls = (active: boolean) =>
  'px-2.5 py-1 rounded-lg text-sm transition-colors ' +
  (active
    ? 'bg-indigo-600 text-white'
    : 'bg-gray-800 text-gray-300 hover:bg-gray-700')

/**
 * Parameterised edit tools for the Current Video: Trim, Split,
 * Crop, Speed, Rotate/Flip and Timeline Thumbnails. Each action
 * enqueues a normal render job; results land next to the source
 * file (split parts go into a "<name>_parts" folder).
 */
export const EditTools: FC<{
  video: VideoFile
  onMessage: (message: string) => void
}> = ({ video, onMessage }) => {
  const [trimStart, setTrimStart] = useState('0')
  const [trimEnd, setTrimEnd] = useState('')
  const [splitMode, setSplitMode] = useState<'at' | 'segments'>('segments')
  const [splitValue, setSplitValue] = useState('8')
  const [crop, setCrop] = useState({ x: '0', y: '0', w: '', h: '' })
  const [speed, setSpeed] = useState(2)

  const queued = (what: string) =>
    onMessage(`${what} job queued for ${video.name} — see Render Queue.`)

  const applyCropPreset = (preset: '9:16' | '1:1' | '16:9') => {
    const W = video.width
    const H = video.height
    let w = W
    let h = H
    if (preset === '9:16') {
      w = even((H * 9) / 16)
      if (w > W) {
        w = even(W)
        h = even((W * 16) / 9)
      }
    } else if (preset === '1:1') {
      w = h = even(Math.min(W, H))
    } else {
      h = even((W * 9) / 16)
      if (h > H) {
        h = even(H)
        w = even((H * 16) / 9)
      }
    }
    setCrop({
      x: String(Math.floor((W - w) / 2)),
      y: String(Math.floor((H - h) / 2)),
      w: String(w),
      h: String(h),
    })
  }

  const handleTrim = () => {
    const start = num(trimStart, 0)
    const end = num(trimEnd, video.duration)
    if (end <= start) {
      onMessage('Trim: end time must be after start time.')
      return
    }
    enqueueTrim(video, start, Math.min(end, video.duration))
    queued('Trim')
  }

  const handleSplit = () => {
    const value = num(splitValue, splitMode === 'at' ? 0 : 8)
    if (splitMode === 'at' && (value <= 0 || value >= video.duration)) {
      onMessage('Split: cut point must be inside the video.')
      return
    }
    if (splitMode === 'segments' && value < 1) {
      onMessage('Split: segment length must be at least 1 second.')
      return
    }
    enqueueSplit(
      video,
      splitMode === 'at'
        ? { mode: 'at', atSeconds: value }
        : { mode: 'segments', segmentSeconds: value }
    )
    queued('Split Clip')
  }

  const handleCrop = () => {
    const rect = {
      x: Math.round(num(crop.x, 0)),
      y: Math.round(num(crop.y, 0)),
      width: Math.round(num(crop.w, video.width)),
      height: Math.round(num(crop.h, video.height)),
    }
    if (rect.x + rect.width > video.width || rect.y + rect.height > video.height) {
      onMessage(
        `Crop: rectangle exceeds the frame (${video.width}×${video.height}).`
      )
      return
    }
    enqueueCrop(video, rect)
    queued('Crop')
  }

  return (
    <div className="mt-6 border-t border-gray-700 pt-5 space-y-4">
      <h3 className="text-lg font-semibold text-white">Edit Tools</h3>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-gray-400 w-28">Trim</span>
        <input
          className={inputCls}
          value={trimStart}
          onChange={(e) => setTrimStart(e.target.value)}
          placeholder="Start (s)"
          title="Start time in seconds"
        />
        <input
          className={inputCls}
          value={trimEnd}
          onChange={(e) => setTrimEnd(e.target.value)}
          placeholder={`End (s) — max ${video.duration.toFixed(1)}`}
          title="End time in seconds (blank = end of video)"
        />
        <button className={btnCls} onClick={handleTrim}>
          <Scissors size={16} /> Trim
        </button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-gray-400 w-28">Split Clip</span>
        <button
          className={chipCls(splitMode === 'segments')}
          onClick={() => setSplitMode('segments')}
        >
          Every N sec
        </button>
        <button
          className={chipCls(splitMode === 'at')}
          onClick={() => setSplitMode('at')}
        >
          At point
        </button>
        <input
          className={inputCls}
          value={splitValue}
          onChange={(e) => setSplitValue(e.target.value)}
          title={
            splitMode === 'at'
              ? 'Cut point in seconds'
              : 'Segment length in seconds'
          }
        />
        <button className={btnCls} onClick={handleSplit}>
          <Scissors size={16} /> Split
        </button>
        <span className="text-xs text-gray-500">
          Parts land in a “{video.name.replace(/\.[^.]+$/, '')}_parts” folder.
        </span>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-gray-400 w-28">Crop</span>
        {(['9:16', '1:1', '16:9'] as const).map((preset) => (
          <button
            key={preset}
            className={chipCls(false)}
            onClick={() => applyCropPreset(preset)}
            title={`Center-crop preset ${preset}`}
          >
            {preset}
          </button>
        ))}
        <input
          className={inputCls}
          value={crop.x}
          onChange={(e) => setCrop({ ...crop, x: e.target.value })}
          placeholder="x"
          title="Left offset in pixels"
        />
        <input
          className={inputCls}
          value={crop.y}
          onChange={(e) => setCrop({ ...crop, y: e.target.value })}
          placeholder="y"
          title="Top offset in pixels"
        />
        <input
          className={inputCls}
          value={crop.w}
          onChange={(e) => setCrop({ ...crop, w: e.target.value })}
          placeholder={`width — max ${video.width}`}
          title="Crop width in pixels"
        />
        <input
          className={inputCls}
          value={crop.h}
          onChange={(e) => setCrop({ ...crop, h: e.target.value })}
          placeholder={`height — max ${video.height}`}
          title="Crop height in pixels"
        />
        <button className={btnCls} onClick={handleCrop}>
          <Crop size={16} /> Crop
        </button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-gray-400 w-28">Speed</span>
        {[0.25, 0.5, 0.75, 1.5, 2, 4].map((factor) => (
          <button
            key={factor}
            className={chipCls(speed === factor)}
            onClick={() => setSpeed(factor)}
          >
            {factor}x
          </button>
        ))}
        <button
          className={btnCls}
          onClick={() => {
            enqueueSpeed(video, speed)
            queued(`Speed ${speed}x`)
          }}
        >
          <Gauge size={16} /> Apply Speed
        </button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-gray-400 w-28">Rotate / Flip</span>
        <button
          className={btnCls}
          onClick={() => {
            enqueueTransform(video, 'rot90')
            queued('Rotate 90° CW')
          }}
        >
          <RotateCw size={16} /> 90° CW
        </button>
        <button
          className={btnCls}
          onClick={() => {
            enqueueTransform(video, 'rot-90')
            queued('Rotate 90° CCW')
          }}
        >
          <RotateCcw size={16} /> 90° CCW
        </button>
        <button
          className={btnCls}
          onClick={() => {
            enqueueTransform(video, 'rot180')
            queued('Rotate 180°')
          }}
        >
          <RotateCw size={16} /> 180°
        </button>
        <button
          className={btnCls}
          onClick={() => {
            enqueueTransform(video, 'flipH')
            queued('Flip Horizontal')
          }}
        >
          <FlipHorizontal2 size={16} /> Flip H
        </button>
        <button
          className={btnCls}
          onClick={() => {
            enqueueTransform(video, 'flipV')
            queued('Flip Vertical')
          }}
        >
          <FlipVertical2 size={16} /> Flip V
        </button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-gray-400 w-28">Thumbnails</span>
        <button
          className={btnCls}
          onClick={() => {
            enqueueTimeline(video)
            queued('Timeline Thumbnails')
          }}
          title="One PNG contact sheet: 10 frames sampled evenly across the video (5x2)"
        >
          <LayoutGrid size={16} /> Timeline Sheet (5×2)
        </button>
      </div>
    </div>
  )
}
