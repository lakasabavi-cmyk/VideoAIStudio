import { spawn, type ChildProcess } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createHash } from 'crypto'
import { FFmpegService } from './ffmpeg.service'
import { LogService } from './log.service'
import type {
  TranscriptData,
  TranscriptSegment,
  TranscriptWord,
} from '@/types/ipc'

/** A kept (not cut) word with its display text resolved. */
interface EditedWord {
  start: number
  end: number
  text: string
}

/** One subtitle line on the EDITED timeline (cuts removed). */
interface EditedSegment {
  start: number
  end: number
  words: EditedWord[]
}

/**
 * Transcript Editor backend: runs the faster-whisper sidecar
 * (tools/transcribe.py), owns the `<media>.transcript.json`
 * sidecar, and turns an edited transcript into subtitles
 * (SRT / karaoke ASS), a cut render and a karaoke burn-in.
 *
 * Subtitle timings always follow the EDITED timeline: cut words
 * are removed and later words shift earlier by the cut lengths,
 * so the files match the video that Apply Cuts / Burn produce.
 * With no cuts the edited timeline is the original timeline.
 */
export class TranscriptService {
  private static activeChild: ChildProcess | null = null

  static sidecarPath(mediaPath: string): string {
    return mediaPath.replace(/\.[^.\\/]+$/, '') + '.transcript.json'
  }

  /** Kill a running transcription (job cancel). */
  static cancelActive(): boolean {
    if (TranscriptService.activeChild) {
      TranscriptService.activeChild.kill()
      TranscriptService.activeChild = null
      return true
    }
    return false
  }

  /**
   * Run the faster-whisper sidecar. The script prints PROGRESS
   * and STAGE lines on stdout; the JSON lands in the sidecar.
   */
  static async transcribe(
    mediaPath: string,
    pythonPath: string,
    scriptPath: string,
    model: string,
    language: string,
    onProgress?: (progress: number, stage?: string) => void
  ): Promise<string> {
    if (!pythonPath) {
      throw new Error(
        'faster-whisper python is not set. Run tools/setup-whisper.bat ' +
          'once, then set the python path in Settings > Transcript.'
      )
    }
    if (!fs.existsSync(scriptPath)) {
      throw new Error(`Transcribe script not found: ${scriptPath}`)
    }
    const outputPath = TranscriptService.sidecarPath(mediaPath)
    LogService.log(
      'transcribe',
      `start ${mediaPath} model=${model} language=${language}`
    )
    await new Promise<void>((resolve, reject) => {
      const child = spawn(pythonPath, [
        scriptPath,
        '--input', mediaPath,
        '--output', outputPath,
        '--model', model,
        '--language', language,
      ])
      TranscriptService.activeChild = child
      let stderr = ''
      let buffer = ''
      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed.startsWith('PROGRESS ')) {
            const pct = parseFloat(trimmed.slice(9))
            if (Number.isFinite(pct)) onProgress?.(pct, 'Transcribing')
          } else if (trimmed.startsWith('STAGE ')) {
            onProgress?.(-1, trimmed.slice(6))
          }
        }
      })
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-800)
      })
      child.on('error', (err) => {
        TranscriptService.activeChild = null
        reject(
          new Error(
            `Could not start python at "${pythonPath}": ${err.message}. ` +
              'Run tools/setup-whisper.bat and check the path in Settings.'
          )
        )
      })
      child.on('close', (code) => {
        TranscriptService.activeChild = null
        if (code === 0) {
          resolve()
        } else {
          const tail = stderr.trim().split('\n').pop() ?? ''
          reject(
            new Error(
              `Transcription failed (exit ${code}). ${tail}`.trim()
            )
          )
        }
      })
    })
    LogService.log('transcribe', `done -> ${outputPath}`)
    return outputPath
  }

  static async load(mediaPath: string): Promise<TranscriptData | null> {
    const sidecar = TranscriptService.sidecarPath(mediaPath)
    try {
      const raw = await fs.promises.readFile(sidecar, 'utf8')
      const parsed = JSON.parse(raw) as TranscriptData
      if (!parsed || !Array.isArray(parsed.segments)) return null
      return parsed
    } catch {
      return null
    }
  }

  static async save(
    mediaPath: string,
    data: TranscriptData
  ): Promise<void> {
    const sidecar = TranscriptService.sidecarPath(mediaPath)
    const tmp = sidecar + '.tmp'
    await fs.promises.writeFile(tmp, JSON.stringify(data), 'utf8')
    await fs.promises.rename(tmp, sidecar)
  }

  /**
   * Merged cut ranges from the words flagged `cut`. Ranges are
   * shrunk slightly at both ends so a cut does not clip the
   * neighbouring kept words, and near-touching ranges merge.
   */
  static cutRanges(data: TranscriptData): { start: number; end: number }[] {
    const raw: { start: number; end: number }[] = []
    for (const segment of data.segments) {
      for (const word of segment.words) {
        if (word.cut) raw.push({ start: word.start, end: word.end })
      }
    }
    raw.sort((a, b) => a.start - b.start)
    const shrunk = raw
      .map((r) => ({ start: r.start + 0.02, end: r.end - 0.02 }))
      .filter((r) => r.end - r.start > 0.03)
    const merged: { start: number; end: number }[] = []
    for (const range of shrunk) {
      const last = merged[merged.length - 1]
      if (last && range.start - last.end < 0.04) {
        last.end = Math.max(last.end, range.end)
      } else {
        merged.push({ ...range })
      }
    }
    return merged
  }

  /** Map an original-timeline time onto the edited timeline. */
  private static mapTime(
    t: number,
    cuts: { start: number; end: number }[]
  ): number {
    let shift = 0
    for (const cut of cuts) {
      if (t >= cut.end) {
        shift += cut.end - cut.start
      } else if (t > cut.start) {
        // Inside a cut: clamp to the cut's mapped start.
        return cut.start - shift
      } else {
        break
      }
    }
    return t - shift
  }

  /** Segments with cut words removed and timings remapped. */
  static editedSegments(data: TranscriptData): EditedSegment[] {
    const cuts = TranscriptService.cutRanges(data)
    const result: EditedSegment[] = []
    for (const segment of data.segments) {
      const words: EditedWord[] = []
      for (const word of segment.words) {
        if (word.cut) continue
        const start = TranscriptService.mapTime(word.start, cuts)
        const end = TranscriptService.mapTime(word.end, cuts)
        if (end - start < 0.01) continue
        words.push({
          start,
          end,
          text: (word.text ?? word.word).trim(),
        })
      }
      if (words.length > 0) {
        result.push({
          start: words[0].start,
          end: words[words.length - 1].end,
          words,
        })
      }
    }
    return result
  }

  private static srtTime(t: number): string {
    const clamped = Math.max(0, t)
    const h = Math.floor(clamped / 3600)
    const m = Math.floor((clamped % 3600) / 60)
    const s = Math.floor(clamped % 60)
    const ms = Math.round((clamped - Math.floor(clamped)) * 1000)
    const pad = (n: number, l = 2) => String(n).padStart(l, '0')
    return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`
  }

  private static assTime(t: number): string {
    const clamped = Math.max(0, t)
    const h = Math.floor(clamped / 3600)
    const m = Math.floor((clamped % 3600) / 60)
    const s = clamped % 60
    const whole = Math.floor(s)
    const cs = Math.round((s - whole) * 100)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${h}:${pad(m)}:${pad(whole)}.${pad(cs)}`
  }

  static buildSRT(data: TranscriptData): string {
    const segments = TranscriptService.editedSegments(data)
    return (
      segments
        .map((segment, i) => {
          const text = segment.words.map((w) => w.text).join(' ')
          return (
            `${i + 1}\n` +
            `${TranscriptService.srtTime(segment.start)} --> ` +
            `${TranscriptService.srtTime(segment.end)}\n${text}\n`
          )
        })
        .join('\n') + '\n'
    )
  }

  private static escapeAssText(text: string): string {
    return text.replace(/[{}]/g, '').replace(/\\/g, '/')
  }

  /**
   * Karaoke ASS: one Dialogue event per word. Each event shows
   * the whole segment line with the currently spoken word in
   * the highlight colour, so burning it in gives word-by-word
   * dynamic subtitles.
   */
  static buildKaraokeASS(
    data: TranscriptData,
    width: number,
    height: number
  ): string {
    const fontSize = Math.max(16, Math.round(height * 0.052))
    const marginV = Math.max(8, Math.round(height * 0.045))
    const header = [
      '[Script Info]',
      'Title: VideoAI Studio karaoke',
      'ScriptType: v4.00+',
      `PlayResX: ${width}`,
      `PlayResY: ${height}`,
      'WrapStyle: 0',
      '',
      '[V4+ Styles]',
      'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
      `Style: Karaoke,Arial,${fontSize},&H00FFFFFF,&H0000FFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,2,0,2,24,24,${marginV},1`,
      '',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ]
    const lines: string[] = []
    for (const segment of TranscriptService.editedSegments(data)) {
      segment.words.forEach((word, i) => {
        const text = segment.words
          .map((w, j) => {
            const escaped = TranscriptService.escapeAssText(w.text)
            return j === i
              ? `{\\c&H00FFFF&}${escaped}{\\c&HFFFFFF&}`
              : escaped
          })
          .join(' ')
        const start = TranscriptService.assTime(word.start)
        const end = TranscriptService.assTime(
          Math.max(word.end, word.start + 0.08)
        )
        lines.push(`Dialogue: 0,${start},${end},Karaoke,,0,0,0,,${text}`)
      })
    }
    return header.join('\n') + '\n' + lines.join('\n') + '\n'
  }

  /** Write an SRT or karaoke ASS next to the media; returns its path. */
  static async exportSubtitles(
    mediaPath: string,
    data: TranscriptData,
    format: 'srt' | 'ass'
  ): Promise<string> {
    const base = mediaPath.replace(/\.[^.\\/]+$/, '')
    if (format === 'srt') {
      const outputPath = base + '.srt'
      await fs.promises.writeFile(
        outputPath,
        TranscriptService.buildSRT(data),
        'utf8'
      )
      LogService.log('transcribe', `srt -> ${outputPath}`)
      return outputPath
    }
    const metadata = await FFmpegService.getVideoMetadata(mediaPath)
    const outputPath = base + '.karaoke.ass'
    await fs.promises.writeFile(
      outputPath,
      TranscriptService.buildKaraokeASS(
        data,
        metadata.width || 1280,
        metadata.height || 720
      ),
      'utf8'
    )
    LogService.log('transcribe', `ass -> ${outputPath}`)
    return outputPath
  }

  /** Invert cut ranges into keep ranges over [0, duration]. */
  private static keepsFromCuts(
    cuts: { start: number; end: number }[],
    duration: number
  ): { start: number; end: number }[] {
    const keeps: { start: number; end: number }[] = []
    let cursor = 0
    for (const cut of cuts) {
      if (cut.start > cursor) keeps.push({ start: cursor, end: cut.start })
      cursor = Math.max(cursor, cut.end)
    }
    if (cursor < duration) keeps.push({ start: cursor, end: duration })
    return keeps.filter((k) => k.end - k.start > 0.05)
  }

  /** Render the video with every cut word removed. */
  static async applyCuts(
    mediaPath: string,
    outputPath: string,
    onProgress?: (progress: number, stage?: string) => void
  ): Promise<void> {
    const data = await TranscriptService.load(mediaPath)
    if (!data) {
      throw new Error('No transcript found for this video yet.')
    }
    const cuts = TranscriptService.cutRanges(data)
    if (cuts.length === 0) {
      await fs.promises.copyFile(mediaPath, outputPath)
      onProgress?.(100)
      return
    }
    const metadata = await FFmpegService.getVideoMetadata(mediaPath)
    const keeps = TranscriptService.keepsFromCuts(
      cuts,
      metadata.duration || data.duration
    )
    if (keeps.length === 0) {
      throw new Error('Every word is marked cut — nothing would remain.')
    }
    await FFmpegService.renderKeeps(
      mediaPath,
      outputPath,
      keeps,
      (pct) => onProgress?.(pct, 'Cutting')
    )
  }

  /**
   * Burn karaoke subtitles into a new video. When the transcript
   * has cuts, the cut render happens first (to a temp file) so
   * the subtitles — timed on the edited timeline — line up.
   */
  static async burnSubtitles(
    mediaPath: string,
    outputPath: string,
    onProgress?: (progress: number, stage?: string) => void
  ): Promise<void> {
    const data = await TranscriptService.load(mediaPath)
    if (!data) {
      throw new Error('No transcript found for this video yet.')
    }
    const metadata = await FFmpegService.getVideoMetadata(mediaPath)
    const ass = TranscriptService.buildKaraokeASS(
      data,
      metadata.width || 1280,
      metadata.height || 720
    )
    const hash = createHash('sha1')
      .update(mediaPath + '|' + Date.now())
      .digest('hex')
      .slice(0, 12)
    const assPath = path.join(os.tmpdir(), `videoai-karaoke-${hash}.ass`)
    await fs.promises.writeFile(assPath, ass, 'utf8')

    const cuts = TranscriptService.cutRanges(data)
    let sourcePath = mediaPath
    let tempCut: string | null = null
    try {
      if (cuts.length > 0) {
        tempCut = path.join(os.tmpdir(), `videoai-cut-${hash}.mp4`)
        const keeps = TranscriptService.keepsFromCuts(
          cuts,
          metadata.duration || data.duration
        )
        if (keeps.length === 0) {
          throw new Error('Every word is marked cut — nothing would remain.')
        }
        await FFmpegService.renderKeeps(sourcePath, tempCut, keeps, (pct) =>
          onProgress?.(Math.round(pct * 0.6), 'Cutting')
        )
        sourcePath = tempCut
      }
      await FFmpegService.burnAss(
        sourcePath,
        outputPath,
        assPath,
        cuts.length > 0
          ? (pct) => onProgress?.(60 + Math.round(pct * 0.4), 'Burning subtitles')
          : (pct) => onProgress?.(pct, 'Burning subtitles')
      )
    } finally {
      await fs.promises.unlink(assPath).catch(() => undefined)
      if (tempCut) {
        await fs.promises.unlink(tempCut).catch(() => undefined)
      }
    }
  }
}

export type { TranscriptData, TranscriptSegment, TranscriptWord }
