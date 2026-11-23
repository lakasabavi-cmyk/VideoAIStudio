import { FC, useEffect, useMemo, useRef, useState } from 'react'
import {
  Subtitles,
  Eraser,
  FileText,
  Flame,
  Play,
  Pause,
  RefreshCw,
  Scissors,
  Search,
  Undo2,
} from 'lucide-react'
import { useVideoStore } from '@/stores/videoStore'
import { useRenderQueue } from '@/stores/renderQueue'
import {
  enqueueBurnSubtitles,
  enqueueTranscribe,
  enqueueTranscriptCuts,
} from '@/lib/jobRunner'
import { toFileUrl } from '@/lib/files'
import type { TranscriptData, TranscriptWord } from '@/types/ipc'
import type { VideoFile } from '@/types'

/** Vietnamese filler syllables + English fillers (whisper tokens
 * are single syllables for Vietnamese). */
const FILLERS = new Set([
  'ừm', 'ừ', 'ờ', 'à', 'ơ', 'ờm', 'ừm', 'hmm', 'uh', 'um', 'er', 'ah',
])

interface FlatWord {
  segIdx: number
  wordIdx: number
  flatIdx: number
  word: TranscriptWord
}

function formatTime(t: number): string {
  const m = Math.floor(t / 60)
  const s = t - m * 60
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`
}

export const Transcript: FC = () => {
  const { videos, currentVideo, setCurrentVideo } = useVideoStore()
  const jobs = useRenderQueue((s) => s.jobs)
  const [transcript, setTranscript] = useState<TranscriptData | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [selection, setSelection] = useState<{ from: number; to: number } | null>(null)
  const [anchor, setAnchor] = useState<number | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  const wordRefs = useRef<Map<number, HTMLSpanElement>>(new Map())
  const saveTimer = useRef<number | null>(null)

  const flatWords = useMemo<FlatWord[]>(() => {
    if (!transcript) return []
    const flat: FlatWord[] = []
    transcript.segments.forEach((segment, segIdx) => {
      segment.words.forEach((word, wordIdx) => {
        flat.push({ segIdx, wordIdx, flatIdx: flat.length, word })
      })
    })
    return flat
  }, [transcript])

  const flatIndexOf = useMemo(() => {
    const map = new Map<string, number>()
    for (const f of flatWords) map.set(`${f.segIdx}:${f.wordIdx}`, f.flatIdx)
    return map
  }, [flatWords])

  const cutCount = useMemo(
    () => flatWords.filter((f) => f.word.cut).length,
    [flatWords]
  )
  const cutSeconds = useMemo(
    () =>
      flatWords.reduce(
        (sum, f) => sum + (f.word.cut ? f.word.end - f.word.start : 0),
        0
      ),
    [flatWords]
  )

  const activeIdx = useMemo(() => {
    let active = -1
    for (const f of flatWords) {
      if (f.word.start <= currentTime) active = f.flatIdx
      else break
    }
    return active
  }, [flatWords, currentTime])

  // Load the sidecar whenever the selected video changes.
  useEffect(() => {
    setTranscript(null)
    setLoaded(false)
    setSelection(null)
    setAnchor(null)
    setEditing(null)
    setNotice(null)
    if (!currentVideo) return
    let cancelled = false
    void window.electronAPI
      .loadTranscript({ videoPath: currentVideo.path })
      .then((result) => {
        if (cancelled) return
        if (result.success) setTranscript(result.data ?? null)
        setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [currentVideo])

  // When a transcribe job for this video finishes, reload the sidecar.
  const transcribeDone = jobs.some(
    (j) =>
      j.kind === 'transcribe' &&
      j.inputPath === currentVideo?.path &&
      j.status === 'completed'
  )
  useEffect(() => {
    if (!transcribeDone || !currentVideo) return
    void window.electronAPI
      .loadTranscript({ videoPath: currentVideo.path })
      .then((result) => {
        if (result.success && result.data) setTranscript(result.data)
      })
  }, [transcribeDone, currentVideo])

  // Debounced auto-save of edits into the sidecar.
  useEffect(() => {
    if (!loaded || !transcript || !currentVideo) return
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      void window.electronAPI.saveTranscript({
        videoPath: currentVideo.path,
        data: transcript,
      })
    }, 800)
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    }
  }, [transcript, loaded, currentVideo])

  // Follow the spoken word while playing.
  useEffect(() => {
    if (!playing || activeIdx < 0) return
    wordRefs.current
      .get(activeIdx)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeIdx, playing])

  const updateWords = (fn: (word: TranscriptWord, flatIdx: number) => TranscriptWord) => {
    setTranscript((prev) => {
      if (!prev) return prev
      let flatIdx = -1
      return {
        ...prev,
        segments: prev.segments.map((segment) => ({
          ...segment,
          words: segment.words.map((word) => {
            flatIdx += 1
            return fn(word, flatIdx)
          }),
        })),
      }
    })
  }

  const inSelection = (flatIdx: number) =>
    selection !== null && flatIdx >= selection.from && flatIdx <= selection.to

  const handleWordClick = (f: FlatWord, e: React.MouseEvent) => {
    const video = videoRef.current
    if (video) {
      video.currentTime = f.word.start
    }
    if (e.shiftKey && anchor !== null) {
      setSelection({
        from: Math.min(anchor, f.flatIdx),
        to: Math.max(anchor, f.flatIdx),
      })
    } else {
      setAnchor(f.flatIdx)
      setSelection({ from: f.flatIdx, to: f.flatIdx })
    }
  }

  const markCut = (cut: boolean) => {
    if (!selection) return
    updateWords((word, flatIdx) =>
      inSelection(flatIdx) ? { ...word, cut } : word
    )
  }

  const detectFillers = () => {
    if (!transcript) return
    let marked = 0
    const flags = new Set<number>()
    flatWords.forEach((f, i) => {
      const token = (f.word.text ?? f.word.word).trim().toLowerCase()
      if (FILLERS.has(token)) flags.add(i)
      const prev = flatWords[i - 1]
      if (
        prev &&
        token !== '' &&
        token === (prev.word.text ?? prev.word.word).trim().toLowerCase()
      ) {
        // Immediate repeat (stutter): cut the repeated token.
        flags.add(i)
      }
    })
    marked = flags.size
    if (marked === 0) {
      setNotice('Không tìm thấy từ đệm hay từ lặp nào.')
      return
    }
    updateWords((word, flatIdx) =>
      flags.has(flatIdx) ? { ...word, cut: true } : word
    )
    setNotice(
      `Đã đánh dấu cắt ${marked} từ đệm/lặp. Kiểm tra lại rồi bấm "Apply cuts" hoặc "Burn karaoke".`
    )
  }

  const commitEdit = (flatIdx: number) => {
    const trimmed = editText.trim()
    updateWords((word, i) => {
      if (i !== flatIdx) return word
      if (!trimmed || trimmed === word.word) {
        const { text: _drop, ...rest } = word
        return rest
      }
      return { ...word, text: trimmed }
    })
    setEditing(null)
  }

  // Delete key marks the selection as cut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing !== null) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selection) {
        const target = e.target as HTMLElement
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
        e.preventDefault()
        markCut(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const handleTranscribe = (video: VideoFile) => {
    const error = enqueueTranscribe(video)
    setNotice(
      error ??
        'Đã đưa vào Render Queue. Xong lúc nào bản ghi sẽ tự hiện ở đây.'
    )
  }

  const handleApplyCuts = async (video: VideoFile) => {
    if (transcript) {
      await window.electronAPI.saveTranscript({
        videoPath: video.path,
        data: transcript,
      })
    }
    enqueueTranscriptCuts(video)
    setNotice('Đã đưa "Apply cuts" vào Render Queue — video mới có hậu tố .edited.')
  }

  const handleBurn = async (video: VideoFile) => {
    if (transcript) {
      await window.electronAPI.saveTranscript({
        videoPath: video.path,
        data: transcript,
      })
    }
    enqueueBurnSubtitles(video)
    setNotice('Đã đưa "Burn karaoke" vào Render Queue — video mới có hậu tố .karaoke.')
  }

  const handleExport = async (format: 'srt' | 'ass') => {
    if (!currentVideo || !transcript) return
    const result = await window.electronAPI.exportSubtitles({
      videoPath: currentVideo.path,
      data: transcript,
      format,
    })
    setNotice(
      result.success
        ? `Đã xuất: ${result.data}`
        : `Xuất phụ đề lỗi: ${result.error ?? 'unknown error'}`
    )
  }

  if (!currentVideo) {
    return (
      <div className="p-8 space-y-6">
        <h1 className="text-4xl font-bold text-white">Transcript Editor</h1>
        <p className="text-gray-400">
          Chọn một video trong thư viện để nhận diện giọng nói và sửa
          bản ghi. Chưa có video nào được chọn.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {videos.map((video) => (
            <button
              key={video.id}
              onClick={() => setCurrentVideo(video)}
              className="text-left px-4 py-3 bg-gray-900 hover:bg-gray-800 border border-gray-800 rounded-lg text-gray-200"
            >
              {video.name}
            </button>
          ))}
        </div>
        {videos.length === 0 && (
          <p className="text-gray-500">Thư viện trống — Import video trước.</p>
        )}
      </div>
    )
  }

  return (
    <div className="p-8 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-2">
            <Subtitles className="text-indigo-400" /> Transcript Editor
          </h1>
          <p className="text-gray-400 mt-1">
            {currentVideo.name}
            {transcript && (
              <>
                {' '}· {transcript.language} · model {transcript.model ?? '?'} ·{' '}
                {flatWords.length} từ · đã cắt {cutCount} từ (
                {cutSeconds.toFixed(1)}s)
              </>
            )}
          </p>
        </div>
        <button
          onClick={() => handleTranscribe(currentVideo)}
          className="shrink-0 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg flex items-center gap-2"
        >
          <RefreshCw size={16} />
          {transcript ? 'Transcribe lại' : 'Transcribe'}
        </button>
      </div>

      {notice && (
        <div className="px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-gray-200">
          {notice}
        </div>
      )}

      <div className="grid grid-cols-[minmax(300px,420px)_1fr] gap-6 items-start">
        <div className="space-y-4 sticky top-8">
          <video
            ref={videoRef}
            src={toFileUrl(currentVideo.path)}
            controls
            className="w-full rounded-lg bg-black"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(e) =>
              setCurrentTime(e.currentTarget.currentTime)
            }
          />
          <p className="text-sm text-gray-400">
            Bấm vào một từ để nghe lại đúng chỗ đó. Shift+bấm để chọn
            một đoạn. Bấm đúp để sửa chữ (chỉ đổi phụ đề, không đổi
            tiếng). Phím Delete = cắt đoạn đang chọn.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => handleExport('srt')}
              disabled={!transcript}
              className="px-3 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-100 rounded-lg flex items-center justify-center gap-2 text-sm"
            >
              <FileText size={16} /> Export SRT
            </button>
            <button
              onClick={() => handleExport('ass')}
              disabled={!transcript}
              className="px-3 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-100 rounded-lg flex items-center justify-center gap-2 text-sm"
            >
              <Subtitles size={16} /> Export ASS karaoke
            </button>
            <button
              onClick={() => void handleApplyCuts(currentVideo)}
              disabled={!transcript || cutCount === 0}
              className="px-3 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white rounded-lg flex items-center justify-center gap-2 text-sm"
            >
              <Scissors size={16} /> Apply cuts (.edited)
            </button>
            <button
              onClick={() => void handleBurn(currentVideo)}
              disabled={!transcript}
              className="px-3 py-2 bg-orange-700 hover:bg-orange-600 disabled:opacity-40 text-white rounded-lg flex items-center justify-center gap-2 text-sm"
            >
              <Flame size={16} /> Burn karaoke (.karaoke)
            </button>
          </div>
          <p className="text-xs text-gray-500">
            Phụ đề xuất ra đi theo timeline ĐÃ cắt (từ bị cắt sẽ biến
            mất và các từ sau dồn lên trước). Burn karaoke tự áp dụng
            các đoạn cắt trước khi gắn phụ đề.
          </p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-lg">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-gray-800">
            <button
              onClick={detectFillers}
              disabled={!transcript}
              className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-100 rounded-md flex items-center gap-2 text-sm"
            >
              <Search size={14} /> Tìm từ đệm / nói lắp
            </button>
            <button
              onClick={() => markCut(true)}
              disabled={!selection}
              className="px-3 py-1.5 bg-red-900/60 hover:bg-red-900 disabled:opacity-40 text-red-100 rounded-md flex items-center gap-2 text-sm"
            >
              <Scissors size={14} /> Cắt đoạn chọn
            </button>
            <button
              onClick={() => markCut(false)}
              disabled={!selection}
              className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-100 rounded-md flex items-center gap-2 text-sm"
            >
              <Undo2 size={14} /> Bỏ cắt
            </button>
            <button
              onClick={() =>
                updateWords((word) =>
                  word.cut ? { ...word, cut: false } : word
                )
              }
              disabled={cutCount === 0}
              className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-100 rounded-md flex items-center gap-2 text-sm"
            >
              <Eraser size={14} /> Xoá mọi đánh dấu cắt
            </button>
            <span className="ml-auto text-xs text-gray-500 flex items-center gap-1">
              {playing ? <Pause size={12} /> : <Play size={12} />}
              {formatTime(currentTime)}
            </span>
          </div>

          <div className="px-5 py-4 max-h-[65vh] overflow-y-auto leading-9 text-[17px] text-gray-100">
            {!loaded && <p className="text-gray-500">Đang tải bản ghi...</p>}
            {loaded && !transcript && (
              <div className="text-gray-400 space-y-3">
                <p>Video này chưa có bản ghi.</p>
                <p className="text-sm">
                  Bấm Transcribe ở góc trên để faster-whisper nhận diện
                  giọng nói (lần đầu sẽ tải model, hơi lâu). Cần cài
                  một lần bằng tools\\setup-whisper.bat và đặt đường
                  dẫn python trong Settings &gt; Transcript.
                </p>
              </div>
            )}
            {transcript &&
              transcript.segments.map((segment, segIdx) => (
                <p key={segIdx} className="mb-3">
                  <span className="text-xs text-gray-500 mr-2 select-none">
                    {formatTime(segment.start)}
                  </span>
                  {segment.words.map((word, wordIdx) => {
                    const flatIdx =
                      flatIndexOf.get(`${segIdx}:${wordIdx}`) ?? -1
                    const selected = inSelection(flatIdx)
                    const isActive = flatIdx === activeIdx
                    const display = word.text ?? word.word
                    const editedText = word.text !== undefined
                    if (editing === flatIdx) {
                      return (
                        <input
                          key={wordIdx}
                          autoFocus
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          onBlur={() => commitEdit(flatIdx)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitEdit(flatIdx)
                            if (e.key === 'Escape') setEditing(null)
                          }}
                          className="w-28 px-1 bg-gray-800 border border-indigo-500 rounded text-gray-100"
                        />
                      )
                    }
                    return (
                      <span
                        key={wordIdx}
                        ref={(el) => {
                          if (el) wordRefs.current.set(flatIdx, el)
                          else wordRefs.current.delete(flatIdx)
                        }}
                        onClick={(e) =>
                          handleWordClick(
                            { segIdx, wordIdx, flatIdx, word },
                            e
                          )
                        }
                        onDoubleClick={() => {
                          setEditing(flatIdx)
                          setEditText(display)
                        }}
                        className={[
                          'cursor-pointer rounded px-0.5',
                          word.cut
                            ? 'line-through opacity-40 text-red-300'
                            : '',
                          selected ? 'bg-indigo-600 text-white' : '',
                          !selected && isActive ? 'bg-amber-400/30' : '',
                          !word.cut && editedText
                            ? 'underline decoration-dotted underline-offset-4 text-sky-300'
                            : '',
                        ].join(' ')}
                      >
                        {display}{' '}
                      </span>
                    )
                  })}
                </p>
              ))}
          </div>
        </div>
      </div>
    </div>
  )
}
