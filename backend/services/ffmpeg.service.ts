import { app } from 'electron'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'
import { createHash } from 'crypto'
import type { UpscaleRequest } from '@/types/ipc'
import { LogService } from './log.service'
import { SystemService } from './system.service'
import { verifyFrameDir, readPngDimensions } from './frameCheck'

/**
 * Resolve a bundled binary path.
 * - ffmpeg-static / ffprobe-static compute their path from their own
 *   location in node_modules, so both packages must stay OUTSIDE the
 *   esbuild bundle (see the build:electron script in package.json).
 * - When the app is packaged, the binaries live in app.asar.unpacked
 *   (see the "build".asarUnpack config in package.json), while the
 *   reported path still points into app.asar — rewrite it.
 */
function resolveBinaryPath(binaryPath: string | null | undefined): string {
  if (!binaryPath) {
    throw new Error('Bundled ffmpeg/ffprobe binary not found')
  }
  return binaryPath.replace('app.asar', 'app.asar.unpacked')
}

ffmpeg.setFfmpegPath(resolveBinaryPath(ffmpegStatic))
ffmpeg.setFfprobePath(resolveBinaryPath(ffprobeStatic.path))

export interface VideoMetadata {
  format: string
  duration: number
  bitrate: number
  width: number
  height: number
  fps: number
  codec: string
  audioCodec?: string
  audioChannels?: number
  /** Duration of the video stream itself (the container duration
   * can run longer because of audio padding). */
  videoDuration?: number
}

interface SilenceRange {
  start: number
  end: number
}

/** Parse an ffmpeg "HH:MM:SS.cc" timemark into seconds. */
function timemarkSeconds(timemark?: string): number {
  if (!timemark) return 0
  const parts = timemark.split(':').map((p) => parseFloat(p))
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return 0
  return parts[0] * 3600 + parts[1] * 60 + parts[2]
}

/** Parse a "num/den" frame-rate string (e.g. "30000/1001") into fps. */
function parseFrameRate(rate: string | undefined): number {
  if (!rate) return 0
  const [num, den] = rate.split('/')
  const denominator = parseFloat(den ?? '1')
  if (!denominator) return 0
  return parseFloat(num) / denominator
}

export class FFmpegService {
  /**
   * Cancellation support. Every long-running child (fluent-ffmpeg
   * commands and the directly spawned frame tools) registers
   * itself here; cancelActive() kills them all and bumps the
   * epoch so multi-stage pipelines also stop between stages.
   * The queue runs one job at a time, so "kill everything" is
   * exactly "cancel the current job".
   */
  private static activeProcesses = new Set<{ kill: () => void }>()
  private static cancelEpoch = 0

  private static trackCommand<T extends ffmpeg.FfmpegCommand>(command: T): T {
    const entry = {
      kill: () => {
        try {
          command.kill('SIGKILL')
        } catch {
          /* process already gone */
        }
      },
    }
    FFmpegService.activeProcesses.add(entry)
    const done = () => FFmpegService.activeProcesses.delete(entry)
    command.on('end', done)
    command.on('error', done)
    return command
  }

  private static trackChild(child: import('child_process').ChildProcess): void {
    const entry = {
      kill: () => {
        try {
          child.kill('SIGKILL')
        } catch {
          /* process already gone */
        }
      },
    }
    FFmpegService.activeProcesses.add(entry)
    const done = () => FFmpegService.activeProcesses.delete(entry)
    child.on('close', done)
    child.on('error', done)
  }

  /** Kill all running processing; returns how many were killed. */
  static cancelActive(): number {
    FFmpegService.cancelEpoch++
    let killed = 0
    for (const proc of FFmpegService.activeProcesses) {
      proc.kill()
      killed++
    }
    return killed
  }

  private static throwIfCancelled(epoch: number): void {
    if (epoch !== FFmpegService.cancelEpoch) {
      throw new Error('Processing cancelled by user')
    }
  }
  /**
   * Get video metadata
   */
  static async getVideoMetadata(videoPath: string): Promise<VideoMetadata> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) {
          reject(err)
          return
        }

        const stream = metadata.streams.find((s) => s.codec_type === 'video')
        if (!stream) {
          reject(new Error('No video stream found'))
          return
        }

        const audioStream = metadata.streams.find(
          (s) => s.codec_type === 'audio'
        )
        resolve({
          format: metadata.format.format_name || 'unknown',
          duration: metadata.format.duration || 0,
          bitrate: metadata.format.bit_rate || 0,
          width: stream.width || 0,
          height: stream.height || 0,
          fps: parseFrameRate(stream.avg_frame_rate || stream.r_frame_rate),
          codec: stream.codec_name || 'unknown',
          audioCodec: audioStream?.codec_name,
          audioChannels: audioStream?.channels,
          videoDuration:
            typeof stream.duration === 'number'
              ? stream.duration
              : undefined,
        })
      })
    })
  }

  /** Duration of any media file (audio files included). */
  static async getMediaDuration(mediaPath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(mediaPath, (err, metadata) => {
        if (err) {
          reject(err)
          return
        }
        resolve(metadata.format.duration || 0)
      })
    })
  }

  /**
   * Detect silent ranges with ffmpeg's silencedetect filter.
   * Returns ranges in seconds. A silence that runs to the end of the
   * file has no silence_end line, so it is closed with the duration.
   */
  private static async detectSilence(
    inputPath: string,
    threshold: number,
    duration: number,
    minSilenceDuration: number = 0.5
  ): Promise<SilenceRange[]> {
    return new Promise((resolve, reject) => {
      const ranges: SilenceRange[] = []
      let openStart: number | null = null

      FFmpegService.trackCommand(ffmpeg(inputPath))
        .audioFilter(
          `silencedetect=noise=${threshold}dB:d=${minSilenceDuration}`
        )
        .outputOptions(['-f', 'null'])
        .output('-')
        .on('stderr', (line: string) => {
          const startMatch = line.match(/silence_start:\s*([\d.]+)/)
          if (startMatch) {
            openStart = parseFloat(startMatch[1])
          }
          const endMatch = line.match(/silence_end:\s*([\d.]+)/)
          if (endMatch && openStart !== null) {
            ranges.push({ start: openStart, end: parseFloat(endMatch[1]) })
            openStart = null
          }
        })
        .on('end', () => {
          if (openStart !== null) {
            ranges.push({ start: openStart, end: duration })
          }
          resolve(ranges)
        })
        .on('error', reject)
        .run()
    })
  }

  /**
   * Remove silence from a video.
   *
   * silenceremove alone is NOT used here: it only shortens the audio
   * stream, which leaves the video full-length and progressively out
   * of sync. Instead, silent ranges are detected first, then both
   * streams are trimmed to the audible segments and concatenated, so
   * picture and sound stay in sync.
   */
  static async removeSilence(
    inputPath: string,
    outputPath: string,
    threshold: number = -40,
    onProgress?: (progress: number) => void
  ): Promise<void> {
    const metadata = await FFmpegService.getVideoMetadata(inputPath)

    // No audio track: there is no silence to detect. Copy as-is.
    if (!metadata.audioCodec) {
      await fs.promises.copyFile(inputPath, outputPath)
      onProgress?.(100)
      return
    }

    const duration = metadata.duration
    const silences = await FFmpegService.detectSilence(
      inputPath,
      threshold,
      duration
    )

    // Shrink each silence a little from both sides so words are not
    // clipped at the cut points.
    const pad = 0.08
    const effective = silences
      .map((s) => ({ start: s.start + pad, end: s.end - pad }))
      .filter((s) => s.end - s.start > 0.05)

    // Nothing worth cutting: copy as-is instead of re-encoding.
    if (effective.length === 0) {
      await fs.promises.copyFile(inputPath, outputPath)
      onProgress?.(100)
      return
    }

    // Invert the silent ranges into the segments to keep.
    const keeps: SilenceRange[] = []
    let cursor = 0
    for (const silence of effective) {
      if (silence.start > cursor) {
        keeps.push({ start: cursor, end: silence.start })
      }
      cursor = Math.max(cursor, silence.end)
    }
    if (cursor < duration) {
      keeps.push({ start: cursor, end: duration })
    }
    const cleanKeeps = keeps.filter((k) => k.end - k.start > 0.05)
    if (cleanKeeps.length === 0) {
      throw new Error('Video is entirely silent at this threshold')
    }

    const filters: string[] = []
    const concatInputs: string[] = []
    cleanKeeps.forEach((segment, i) => {
      const start = segment.start.toFixed(3)
      const end = segment.end.toFixed(3)
      filters.push(
        `[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${i}]`
      )
      filters.push(
        `[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${i}]`
      )
      concatInputs.push(`[v${i}][a${i}]`)
    })
    filters.push(
      `${concatInputs.join('')}concat=n=${cleanKeeps.length}:v=1:a=1[outv][outa]`
    )

    const keptDuration = cleanKeeps.reduce(
      (sum, k) => sum + (k.end - k.start),
      0
    )

    return new Promise((resolve, reject) => {
      FFmpegService.trackCommand(ffmpeg(inputPath))
        .complexFilter(filters)
        .map('[outv]')
        .map('[outa]')
        .outputOptions(['-c:v', 'libx264', '-c:a', 'aac'])
        .output(outputPath)
        .on('progress', (progress) => {
          // progress.percent is unreliable with complex filters; the
          // timemark is measured against the kept (output) duration.
          if (progress.timemark && keptDuration > 0) {
            const parts = progress.timemark.split(':')
            const seconds =
              parseInt(parts[0], 10) * 3600 +
              parseInt(parts[1], 10) * 60 +
              parseFloat(parts[2])
            const percent = Math.round((seconds / keptDuration) * 100)
            if (Number.isFinite(percent)) {
              onProgress?.(Math.min(100, percent))
            }
          }
        })
        .on('end', () => {
          onProgress?.(100)
          resolve()
        })
        .on('error', reject)
        .run()
    })
  }

  /**
   * Render only the given keep ranges of a video, concatenated
   * back to back. This is the shared cut engine behind Remove
   * Silence and the Transcript Editor's word cuts.
   */
  static async renderKeeps(
    inputPath: string,
    outputPath: string,
    keeps: { start: number; end: number }[],
    onProgress?: (progress: number) => void
  ): Promise<void> {
    const metadata = await FFmpegService.getVideoMetadata(inputPath)
    const hasAudio = Boolean(metadata.audioCodec)
    const cleanKeeps = keeps.filter((k) => k.end - k.start > 0.05)
    if (cleanKeeps.length === 0) {
      throw new Error('Nothing to keep — every range was cut')
    }

    const filters: string[] = []
    const concatInputs: string[] = []
    cleanKeeps.forEach((segment, i) => {
      const start = segment.start.toFixed(3)
      const end = segment.end.toFixed(3)
      filters.push(
        `[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${i}]`
      )
      if (hasAudio) {
        filters.push(
          `[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${i}]`
        )
        concatInputs.push(`[v${i}][a${i}]`)
      } else {
        concatInputs.push(`[v${i}]`)
      }
    })
    filters.push(
      `${concatInputs.join('')}concat=n=${cleanKeeps.length}:v=1:a=${
        hasAudio ? 1 : 0
      }[outv]${hasAudio ? '[outa]' : ''}`
    )

    const keptDuration = cleanKeeps.reduce(
      (sum, k) => sum + (k.end - k.start),
      0
    )

    return new Promise((resolve, reject) => {
      const command = FFmpegService.trackCommand(ffmpeg(inputPath))
        .complexFilter(filters)
        .map('[outv]')
      if (hasAudio) command.map('[outa]')
      command
        .outputOptions(['-c:v', 'libx264', '-c:a', 'aac'])
        .output(outputPath)
        .on('progress', (progress) => {
          if (progress.timemark && keptDuration > 0) {
            const parts = progress.timemark.split(':')
            const seconds =
              parseInt(parts[0], 10) * 3600 +
              parseInt(parts[1], 10) * 60 +
              parseFloat(parts[2])
            const percent = Math.round((seconds / keptDuration) * 100)
            if (Number.isFinite(percent)) {
              onProgress?.(Math.min(100, percent))
            }
          }
        })
        .on('end', () => {
          onProgress?.(100)
          resolve()
        })
        .on('error', reject)
        .run()
    })
  }

  /**
   * Burn an ASS subtitle file into the video with libass.
   * The filter argument needs the path escaped for ffmpeg's
   * filter parser: forward slashes, escaped drive colon, and
   * the whole path single-quoted.
   */
  static async burnAss(
    inputPath: string,
    outputPath: string,
    assPath: string,
    onProgress?: (progress: number) => void
  ): Promise<void> {
    const metadata = await FFmpegService.getVideoMetadata(inputPath)
    const duration = metadata.duration || 0
    const escaped = assPath
      .replace(/\\/g, '/')
      .replace(/:/g, '\\:')
      .replace(/'/g, "'\\''")
    return new Promise((resolve, reject) => {
      FFmpegService.trackCommand(ffmpeg(inputPath))
        .videoFilters(`ass='${escaped}'`)
        .outputOptions(['-c:v', 'libx264', '-c:a', 'aac'])
        .output(outputPath)
        .on('progress', (progress) => {
          if (progress.timemark && duration > 0) {
            const parts = progress.timemark.split(':')
            const seconds =
              parseInt(parts[0], 10) * 3600 +
              parseInt(parts[1], 10) * 60 +
              parseFloat(parts[2])
            const percent = Math.round((seconds / duration) * 100)
            if (Number.isFinite(percent)) {
              onProgress?.(Math.min(100, percent))
            }
          }
        })
        .on('end', () => {
          onProgress?.(100)
          resolve()
        })
        .on('error', reject)
        .run()
    })
  }

  /**
   * Measure the clip's brightness range with signalstats: the
   * 10th percentile of per-frame YMIN (black point) and the
   * 90th percentile of per-frame YMAX (white point), 0-255.
   * Percentiles (not the absolute min/max) so a few black or
   * blown frames cannot skew the measurement. Decodes the
   * whole clip once — fast, no encode involved.
   */
  private static async measureLevels(inputPath: string): Promise<{
    blackPoint: number
    whitePoint: number
  }> {
    const decoded = await new Promise<{
      code: number | null
      stderr: string
      spawnError?: string
    }>((resolve) => {
      const child = spawn(resolveBinaryPath(ffmpegStatic), [
        '-v', 'info',
        '-i', inputPath,
        '-an',
        '-vf', 'signalstats,metadata=mode=print',
        '-f', 'null', '-',
      ], { windowsHide: true })
      let stderr = ''
      child.stderr.on('data', (c: Buffer) => {
        stderr += c.toString()
      })
      child.on('error', (err) =>
        resolve({ code: null, stderr, spawnError: err.message })
      )
      child.on('close', (code) => resolve({ code, stderr }))
    })
    if (decoded.code !== 0) {
      throw new Error(
        `Could not measure brightness levels (ffmpeg exited with code ${decoded.code}). ` +
          `${decoded.spawnError ?? decoded.stderr.trim().slice(-300)}`
      )
    }
    const mins: number[] = []
    const maxs: number[] = []
    for (const line of decoded.stderr.split('\n')) {
      const minMatch = line.match(/lavfi\.signalstats\.YMIN=(\d+)/)
      if (minMatch) mins.push(parseInt(minMatch[1], 10))
      const maxMatch = line.match(/lavfi\.signalstats\.YMAX=(\d+)/)
      if (maxMatch) maxs.push(parseInt(maxMatch[1], 10))
    }
    if (mins.length === 0 || maxs.length === 0) {
      throw new Error('Could not measure brightness levels (no signalstats data)')
    }
    const percentile = (values: number[], p: number): number => {
      const sorted = [...values].sort((a, b) => a - b)
      const index = (p / 100) * (sorted.length - 1)
      const lo = Math.floor(index)
      const hi = Math.ceil(index)
      return sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo)
    }
    return {
      blackPoint: Math.round(percentile(mins, 10)),
      whitePoint: Math.round(percentile(maxs, 90)),
    }
  }

  /**
   * Color Grade (v0.4.0): auto brightness balance + 3D LUT.
   *
   * Balance is a 2-pass mechanism: pass 1 measures the whole
   * clip's range with signalstats; pass 2 applies ONE fixed
   * colorlevels for the entire clip. It is applied ONLY when
   * the measured range is clearly compressed (white point
   * below 200/255, or blacks washed out above 55) — a clip
   * with a full range skips balancing and the job log says so.
   * Never normalize per-frame: that flickers when the scene
   * changes and pumps noise in the dark.
   *
   * The LUT runs AFTER the balance, through lut3d
   * (interp=tetrahedral). lut3d has no strength parameter in
   * this ffmpeg build, so strength is a split + blend:
   * [graded][original]blend=all_opacity=strength — the
   * graded frame must be the FIRST (top) input, or opacity
   * 1.0 silently returns the original (verified 25/11/2026).
   */
  static async colorGrade(
    request: {
      videoPath: string
      outputPath: string
      autoBalance: boolean
      /** Absolute path to a .cube file, or undefined for none. */
      lutPath?: string
      /** LUT strength 0-100. */
      strength: number
    },
    onProgress?: (progress: number, stage?: string) => void
  ): Promise<{
    balanced: boolean
    blackPoint: number
    whitePoint: number
  }> {
    const cancelEpoch = FFmpegService.cancelEpoch
    const metadata = await FFmpegService.getVideoMetadata(request.videoPath)
    const duration = metadata.duration || 0
    const strength = Math.max(0, Math.min(100, request.strength))
    const lutPath = request.lutPath?.trim() || undefined
    if (lutPath && !fs.existsSync(lutPath)) {
      throw new Error(`LUT file not found: ${lutPath}`)
    }
    const hasLut = Boolean(lutPath) && strength > 0

    // Pass 1: measure the range (only when balance is wanted).
    let blackPoint = 0
    let whitePoint = 255
    let balanced = false
    if (request.autoBalance) {
      onProgress?.(2, 'Measure Levels')
      const levels = await FFmpegService.measureLevels(request.videoPath)
      blackPoint = levels.blackPoint
      whitePoint = levels.whitePoint
      // Clearly compressed range: whites never reach 200, or
      // blacks never fall below 55 (washed out).
      balanced = whitePoint < 200 || blackPoint > 55
      LogService.log(
        'colorgrade',
        `levels black=${blackPoint} white=${whitePoint} ` +
          (balanced
            ? '-> balance will be applied'
            : '-> range already sufficient, skipping balance')
      )
    }

    if (!balanced && !hasLut) {
      throw new Error(
        'Nothing to grade: the brightness range is already sufficient ' +
          'and no LUT was selected.'
      )
    }

    FFmpegService.throwIfCancelled(cancelEpoch)

    // Pass 2: build the filter graph as a list of chains.
    // Order is fixed: balance FIRST, LUT AFTER.
    const escapedLut = lutPath
      ? lutPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\''")
      : ''
    const chains: string[] = []
    if (balanced) {
      // ffmpeg 7.0.2's colorlevels has no imin/imax shortcuts,
      // only per-channel rimin/gimin/bimin + rimax/gimax/bimax.
      const lo = (blackPoint / 255).toFixed(4)
      const hi = (whitePoint / 255).toFixed(4)
      chains.push(
        `[0:v]colorlevels=rimin=${lo}:gimin=${lo}:bimin=${lo}` +
          `:rimax=${hi}:gimax=${hi}:bimax=${hi}[balanced]`
      )
    }
    const sourceLabel = balanced ? '[balanced]' : '[0:v]'
    if (hasLut) {
      chains.push(`${sourceLabel}split[a][b]`)
      chains.push(
        `[a]lut3d=file='${escapedLut}':interp=tetrahedral[graded]`
      )
      chains.push(
        `[graded][b]blend=all_mode=normal:all_opacity=${(strength / 100).toFixed(3)},` +
          `format=yuv420p[outv]`
      )
    } else {
      chains.push(`${sourceLabel}format=yuv420p[outv]`)
    }

    LogService.log(
      'colorgrade',
      `start input=${path.basename(request.videoPath)} ` +
        `${metadata.width}x${metadata.height} ${duration.toFixed(1)}s ` +
        `balance=${balanced ? 'yes' : 'no'} ` +
        `lut=${lutPath ? path.basename(lutPath) : 'none'} ` +
        `strength=${strength}%`
    )

    const hasAudio = Boolean(metadata.audioCodec)
    return new Promise((resolve, reject) => {
      const command = FFmpegService.trackCommand(ffmpeg(request.videoPath))
        .complexFilter(chains)
        .map('[outv]')
      if (hasAudio) {
        command.outputOptions(['-map', '0:a', '-c:a', 'copy'])
      }
      command
        .outputOptions([
          '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
          '-pix_fmt', 'yuv420p',
        ])
        .output(request.outputPath)
        .on('progress', (progress) => {
          if (progress.timemark && duration > 0) {
            const done = timemarkSeconds(progress.timemark)
            const percent = Math.round((done / duration) * 100)
            if (Number.isFinite(percent)) {
              onProgress?.(
                Math.min(100, 10 + Math.round(percent * 0.9)),
                'Color Grade'
              )
            }
          }
        })
        .on('end', () => {
          onProgress?.(100, 'Color Grade')
          LogService.log('colorgrade', `done -> ${request.outputPath}`)
          resolve({ balanced, blackPoint, whitePoint })
        })
        .on('error', reject)
        .run()
    })
  }

  /**
   * Add background music to video.
   * The music is looped so it covers the whole video, and amix runs
   * with normalize=0 so the original audio keeps its level.
   */
  static async addBackgroundMusic(
    videoPath: string,
    audioPath: string,
    outputPath: string,
    audioVolume: number = 0.5,
    originalVolume: number = 1,
    onProgress?: (progress: number) => void
  ): Promise<void> {
    const metadata = await FFmpegService.getVideoMetadata(videoPath)

    return new Promise((resolve, reject) => {
      const command = FFmpegService.trackCommand(ffmpeg())
        .input(videoPath)
        .input(audioPath)
        .inputOptions(['-stream_loop', '-1'])

      // Note: the video stream must be mapped as the raw option
      // '-map 0:v'. fluent-ffmpeg's .map() helper wraps its argument
      // in brackets (it is meant for filter-graph labels), producing
      // '-map [0:v]', which ffmpeg rejects because 0:v is a raw input
      // stream, not a filter output.
      if (metadata.audioCodec) {
        const originalGain = Math.min(1, Math.max(0, originalVolume))
        command
          .complexFilter([
            `[0:a]volume=${originalGain}[a0]`,
            `[1:a]volume=${audioVolume}[a1]`,
            '[a0][a1]amix=inputs=2:duration=first:normalize=0[a]',
          ])
          .outputOptions(['-map', '0:v'])
          .map('[a]')
      } else {
        // Video has no audio track: the music becomes the soundtrack.
        command
          .complexFilter([`[1:a]volume=${audioVolume}[a]`])
          .outputOptions(['-map', '0:v'])
          .map('[a]')
          .outputOptions(['-shortest'])
      }

      command
        .output(outputPath)
        .on('progress', (progress) => {
          onProgress?.(progress.percent || 0)
        })
        .on('end', () => resolve())
        .on('error', reject)
        .run()
    })
  }

  /**
   * Adjust the volume of the video's ORIGINAL audio track.
   * Volume is 0-1: 1 keeps the original level, 0 mutes the track
   * completely (a silent track is kept, so the file can still be
   * mixed with new audio afterwards). The picture is copied
   * without re-encoding.
   */
  static async adjustVolume(
    inputPath: string,
    outputPath: string,
    volume: number = 1,
    onProgress?: (progress: number) => void
  ): Promise<void> {
    const metadata = await FFmpegService.getVideoMetadata(inputPath)
    if (!metadata.audioCodec) {
      throw new Error('Video has no audio track to adjust')
    }
    const gain = Math.min(1, Math.max(0, volume))

    return new Promise((resolve, reject) => {
      FFmpegService.trackCommand(ffmpeg(inputPath))
        .audioFilter(`volume=${gain}`)
        .outputOptions(['-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k'])
        .output(outputPath)
        .on('progress', (progress) => {
          onProgress?.(progress.percent || 0)
        })
        .on('end', () => {
          onProgress?.(100)
          resolve()
        })
        .on('error', reject)
        .run()
    })
  }

  /**
   * Extract the video's LAST frame as a PNG.
   *
   * Seeking to an exact timestamp is not frame-accurate enough
   * for clip chaining (the frame shown at duration-0.1s is not
   * necessarily the final frame), so this decodes the tail of
   * the video into a temporary image sequence and keeps the
   * final image. The window is ~3 frames (min 0.2s, max 1s);
   * input seeking discards everything before it, so the cost
   * stays small even for long videos.
   */
  static async extractLastFrame(
    inputPath: string,
    outputPath: string,
    onProgress?: (progress: number) => void
  ): Promise<void> {
    const metadata = await FFmpegService.getVideoMetadata(inputPath)
    const fps = metadata.fps > 0 ? metadata.fps : 30
    const windowSeconds = Math.min(1, Math.max(0.2, 3 / fps + 0.05))

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'videoai-frame-'))
    try {
      const pattern = path.join(tmpDir, 'tail-%04d.png')
      await new Promise<void>((resolve, reject) => {
        FFmpegService.trackCommand(ffmpeg(inputPath))
          .inputOptions(['-sseof', `-${windowSeconds.toFixed(3)}`])
          .output(pattern)
          .on('end', () => resolve())
          .on('error', reject)
          .run()
      })

      const frames = fs
        .readdirSync(tmpDir)
        .filter((f) => f.endsWith('.png'))
        .sort()
      if (frames.length === 0) {
        throw new Error('Could not extract any frame from the video tail')
      }
      const lastFrame = path.join(tmpDir, frames[frames.length - 1])
      fs.mkdirSync(path.dirname(outputPath), { recursive: true })
      await fs.promises.copyFile(lastFrame, outputPath)
      onProgress?.(100)
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  }

  /**
   * Merge several videos into one, in the given order.
   *
   * The clips are produced by chaining: each scene is generated
   * from the previous scene's last frame, so that frame appears
   * twice — as the last frame of clip N and the first frame of
   * clip N+1. To remove the duplicate, the FIRST FRAME of every
   * clip after the first is dropped (frame-exact video trim; the
   * audio is trimmed by the same one-frame duration of its own
   * clip). All clips are normalised to the first clip's size;
   * clips without an audio track get a silent track.
   *
   * Frame-exactness note (verified by frame-colour tests): each
   * segment's audio is cut/padded to EXACTLY its video length
   * inside the filter graph. Without that lock the concat
   * filter pads segments whose audio runs longer than their
   * video and invents duplicate frames at the joins — the very
   * thing this feature exists to remove. A two-pass concat
   * demuxer join was also tried and rejected: the MP4/AAC
   * timestamp offsets shifted frames at the joins instead.
   */
  static async mergeVideos(
    inputPaths: string[],
    outputPath: string,
    onProgress?: (progress: number) => void
  ): Promise<void> {
    if (inputPaths.length < 2) {
      throw new Error('Merging needs at least two videos')
    }
    const metas: VideoMetadata[] = []
    for (const inputPath of inputPaths) {
      metas.push(await FFmpegService.getVideoMetadata(inputPath))
    }
    const target = metas[0]
    const targetFps = target.fps > 0 ? Math.round(target.fps) : 30

    const filters: string[] = []
    const concatInputs: string[] = []
    let outputDuration = 0
    metas.forEach((meta, i) => {
      const clipFps = meta.fps > 0 ? meta.fps : targetFps
      const dropFrames = i === 0 ? 0 : 1
      const dropSeconds = dropFrames / clipFps
      // Length of this clip's video after the drop; the audio is
      // locked to exactly this length (see the note above).
      const videoLength = Math.max(
        0.1,
        (meta.videoDuration ?? meta.duration) - dropSeconds
      )
      filters.push(
        `[${i}:v]trim=start_frame=${dropFrames},setpts=PTS-STARTPTS,` +
          `scale=${target.width}:${target.height},` +
          `format=yuv420p,setsar=1[v${i}]`
      )
      if (meta.audioCodec) {
        filters.push(
          `[${i}:a]atrim=start=${dropSeconds.toFixed(5)},asetpts=PTS-STARTPTS,` +
            `aresample=48000,aformat=channel_layouts=stereo,` +
            `apad,atrim=duration=${videoLength.toFixed(3)}[a${i}]`
        )
      } else {
        filters.push(
          `anullsrc=channel_layout=stereo:sample_rate=48000,` +
            `atrim=duration=${videoLength.toFixed(3)}[a${i}]`
        )
      }
      concatInputs.push(`[v${i}][a${i}]`)
      outputDuration += videoLength
    })
    filters.push(
      `${concatInputs.join('')}concat=n=${metas.length}:v=1:a=1[cv][ca]`
    )
    filters.push(`[cv]fps=${targetFps}[outv]`)

    return new Promise((resolve, reject) => {
      const command = FFmpegService.trackCommand(ffmpeg())
      inputPaths.forEach((inputPath) => command.input(inputPath))
      command
        .complexFilter(filters)
        .map('[outv]')
        .map('[ca]')
        .outputOptions([
          '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
          '-c:a', 'aac', '-b:a', '192k',
        ])
        .output(outputPath)
        .on('progress', (progress) => {
          if (progress.timemark && outputDuration > 0) {
            const parts = progress.timemark.split(':')
            const seconds =
              parseInt(parts[0], 10) * 3600 +
              parseInt(parts[1], 10) * 60 +
              parseFloat(parts[2])
            const percent = Math.round((seconds / outputDuration) * 100)
            if (Number.isFinite(percent)) {
              onProgress?.(Math.min(100, percent))
            }
          }
        })
        .on('end', () => {
          onProgress?.(100)
          resolve()
        })
        .on('error', reject)
        .run()
    })
  }

  /**
   * Compose a timeline (v2): video clips sit at absolute offsets
   * on the track; gaps between them (left by non-ripple trims or
   * deletions) render as black + silence. A clip flagged
   * dropFirstFrame starts one frame in (Smart Concat for
   * last-frame chains). The clips' own audio runs at
   * originalVolume; added audio clips (Voice / Music / SFX lanes,
   * already resolved to absolute start times and trims by the
   * caller) are mixed over the top with adelay + amix.
   */
  static async composeTimeline(
    request: {
      clips: {
        path: string
        startSeconds: number
        endSeconds: number
        offsetSeconds: number
        dropFirstFrame?: boolean
        transition?: string
        /** Resolved .cube path for this clip's color filter. */
        lutPath?: string
        /** Color filter strength 0-100. */
        filterStrength?: number
      }[]
      audioClips: {
        path: string
        volume: number
        startAtSeconds: number
        startSeconds: number
        endSeconds: number
        lane?: string
      }[]
      audioLaneFades?: Record<
        string,
        { fadeInSeconds: number; fadeOutSeconds: number }
      >
      originalVolume: number
      originalFadeInSeconds?: number
      originalFadeOutSeconds?: number
      ducking?: boolean
      outputPath: string
    },
    onProgress?: (progress: number) => void
  ): Promise<void> {
    if (request.clips.length === 0) {
      throw new Error('The timeline has no video clips')
    }
    // The output may live in a fresh project folder — create it.
    fs.mkdirSync(path.dirname(request.outputPath), { recursive: true })
    const metas: VideoMetadata[] = []
    for (const clip of request.clips) {
      metas.push(await FFmpegService.getVideoMetadata(clip.path))
    }
    const target = metas[0]
    const targetFps = target.fps > 0 ? Math.round(target.fps) : 30
    const originalVolume = Math.max(0, Math.min(1, request.originalVolume))

    // Flatten the track into segments: gaps and clips in time order.
    interface Segment {
      kind: 'gap' | 'clip'
      length: number
      clipIndex?: number
      start?: number
      end?: number
      transition?: string
      lutPath?: string
      filterStrength?: number
    }
    const ordered = request.clips
      .map((clip, index) => ({ clip, index }))
      .sort((a, b) => a.clip.offsetSeconds - b.clip.offsetSeconds)
    const segments: Segment[] = []
    let cursor = 0
    for (const { clip, index } of ordered) {
      const meta = metas[index]
      let start = Math.max(0, Math.min(clip.startSeconds, meta.duration))
      if (clip.dropFirstFrame) {
        const clipFps = meta.fps > 0 ? meta.fps : targetFps
        start += 1 / clipFps
      }
      const end = Math.max(
        start + 0.1,
        Math.min(clip.endSeconds, meta.duration || clip.endSeconds)
      )
      const gap = clip.offsetSeconds - cursor
      if (gap > 0.05) segments.push({ kind: 'gap', length: gap })
      segments.push({
        kind: 'clip',
        length: end - start,
        clipIndex: index,
        start,
        end,
        transition: clip.transition,
        lutPath: clip.lutPath,
        filterStrength: clip.filterStrength,
      })
      cursor = Math.max(cursor, clip.offsetSeconds) + (end - start)
    }
    const filters: string[] = []
    segments.forEach((segment, s) => {
      if (segment.kind === 'gap') {
        filters.push(
          `color=c=black:s=${target.width}x${target.height}:r=${targetFps},` +
            `trim=duration=${segment.length.toFixed(3)},setpts=PTS-STARTPTS,` +
            `format=yuv420p,settb=AVTB[gv${s}]`
        )
        filters.push(
          `anullsrc=channel_layout=stereo:sample_rate=48000,` +
            `atrim=duration=${segment.length.toFixed(3)}[ga${s}]`
        )
      } else {
        const i = segment.clipIndex as number
        const meta = metas[i]
        const start = segment.start as number
        const end = segment.end as number
        // Color filter (v0.4.1): a built-in LUT on this clip only,
        // same split + blend strength trick as colorGrade — the
        // graded frame must be the FIRST blend input, or opacity
        // 1.0 silently returns the original.
        const strength = Math.max(
          0,
          Math.min(100, segment.filterStrength ?? 70)
        )
        const lutPath = segment.lutPath?.trim() || undefined
        const hasFilter = Boolean(lutPath) && strength > 0
        if (hasFilter) {
          const escaped = (lutPath as string)
            .replace(/\\/g, '/')
            .replace(/:/g, '\\:')
            .replace(/'/g, "'\\''")
          filters.push(
            `[${i}:v]trim=start=${start.toFixed(3)}:end=${end.toFixed(3)},` +
              `setpts=PTS-STARTPTS,scale=${target.width}:${target.height},` +
              `fps=${targetFps},format=yuv420p,split[fa${s}][fb${s}]`
          )
          filters.push(
            `[fa${s}]lut3d=file='${escaped}':interp=tetrahedral[fg${s}]`
          )
          filters.push(
            `[fg${s}][fb${s}]blend=all_mode=normal:all_opacity=${(strength / 100).toFixed(3)},` +
              `setsar=1,settb=AVTB[gv${s}]`
          )
        } else {
          filters.push(
            `[${i}:v]trim=start=${start.toFixed(3)}:end=${end.toFixed(3)},` +
              `setpts=PTS-STARTPTS,scale=${target.width}:${target.height},` +
              `fps=${targetFps},format=yuv420p,setsar=1,settb=AVTB[gv${s}]`
          )
        }
        if (meta.audioCodec) {
          filters.push(
            `[${i}:a]atrim=start=${start.toFixed(3)}:end=${end.toFixed(3)},` +
              `asetpts=PTS-STARTPTS,aresample=48000,` +
              `aformat=channel_layouts=stereo,volume=${originalVolume.toFixed(3)},` +
              `apad,atrim=duration=${segment.length.toFixed(3)}[ga${s}]`
          )
        } else {
          filters.push(
            `anullsrc=channel_layout=stereo:sample_rate=48000,` +
              `atrim=duration=${segment.length.toFixed(3)}[ga${s}]`
          )
        }
      }
    })

    // Join the segments pairwise: a clip that carries a
    // transition joins the running result with an xfade +
    // acrossfade (0.5s — the two clips overlap by that much);
    // everything else is a plain concat (hard cut, gaps too).
    const XFADE_BY_NAME: Record<string, string> = {
      fade: 'fade',
      dissolve: 'dissolve',
      zoom: 'zoomin',
      slide: 'slideleft',
    }
    const TRANSITION_SECONDS = 0.5
    let joinedV = '[gv0]'
    let joinedA = '[ga0]'
    let joinedLength = segments[0].length
    for (let s = 1; s < segments.length; s++) {
      const segment = segments[s]
      const xfade =
        segment.kind === 'clip'
          ? XFADE_BY_NAME[segment.transition ?? '']
          : undefined
      const canTransition =
        xfade !== undefined &&
        joinedLength > TRANSITION_SECONDS + 0.05 &&
        segment.length > TRANSITION_SECONDS + 0.05
      if (canTransition) {
        const offset = joinedLength - TRANSITION_SECONDS
        filters.push(
          `${joinedV}[gv${s}]xfade=transition=${xfade}:duration=${TRANSITION_SECONDS}:offset=${offset.toFixed(3)}[jv${s}]`
        )
        filters.push(
          `${joinedA}[ga${s}]acrossfade=d=${TRANSITION_SECONDS}:c1=tri:c2=tri[ja${s}]`
        )
        joinedLength += segment.length - TRANSITION_SECONDS
      } else {
        filters.push(
          `${joinedV}${joinedA}[gv${s}][ga${s}]concat=n=2:v=1:a=1[jv${s}][ja${s}]`
        )
        joinedLength += segment.length
      }
      joinedV = `[jv${s}]`
      joinedA = `[ja${s}]`
    }
    const outputDuration = joinedLength
    filters.push(`${joinedV}fps=${targetFps},format=yuv420p[outv]`)

    // Video-track audio fades, applied to the concatenated clip
    // audio before any bed is mixed over it.
    let mainAudio = joinedA
    const vIn = Math.min(request.originalFadeInSeconds ?? 0, outputDuration / 2)
    const vOut = Math.min(request.originalFadeOutSeconds ?? 0, outputDuration / 2)
    const mainFades: string[] = []
    if (vIn > 0.01) mainFades.push(`afade=t=in:st=0:d=${vIn.toFixed(3)}`)
    if (vOut > 0.01) {
      mainFades.push(
        `afade=t=out:st=${(outputDuration - vOut).toFixed(3)}:d=${vOut.toFixed(3)}`
      )
    }
    if (mainFades.length > 0) {
      filters.push(`${joinedA}${mainFades.join(',')}[caf]`)
      mainAudio = '[caf]'
    }

    // Added-audio bed: clips are grouped by lane (Voice / Music /
    // SFX); each lane is mixed on its own and faded as a track,
    // then all lanes are mixed over the main audio.
    let audioOut = mainAudio
    if (request.audioClips.length > 0) {
      const lanes = new Map<string, number[]>()
      request.audioClips.forEach((audio, k) => {
        const lane = audio.lane ?? 'music'
        if (!lanes.has(lane)) lanes.set(lane, [])
        lanes.get(lane)!.push(k)
      })
      const laneLabels: string[] = []
      const laneFinalLabels = new Map<string, string>()
      let laneNo = 0
      for (const [lane, indexes] of lanes) {
        const labels: string[] = []
        let laneStart = Infinity
        let laneEnd = 0
        for (const k of indexes) {
          const audio = request.audioClips[k]
          const inputIndex = request.clips.length + k
          const delayMs = Math.round(Math.max(0, audio.startAtSeconds) * 1000)
          const volume = Math.max(0, Math.min(1, audio.volume))
          const start = Math.max(0, audio.startSeconds)
          const end = Math.max(start + 0.1, audio.endSeconds)
          laneStart = Math.min(laneStart, audio.startAtSeconds)
          laneEnd = Math.max(laneEnd, audio.startAtSeconds + (end - start))
          filters.push(
            `[${inputIndex}:a]atrim=start=${start.toFixed(3)}:end=${end.toFixed(3)},` +
              `asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,` +
              `volume=${volume.toFixed(3)},adelay=${delayMs}[b${k}]`
          )
          labels.push(`[b${k}]`)
        }
        if (labels.length === 1) {
          filters.push(`${labels[0]}anull[lane${laneNo}raw]`)
        } else {
          filters.push(
            `${labels.join('')}amix=inputs=${labels.length}:duration=longest:normalize=0[lane${laneNo}raw]`
          )
        }
        const span = Math.max(0, laneEnd - laneStart)
        const fades = request.audioLaneFades?.[lane]
        const fparts: string[] = []
        if (fades && span > 0.05) {
          const fi = Math.min(fades.fadeInSeconds ?? 0, span / 2)
          const fo = Math.min(fades.fadeOutSeconds ?? 0, span / 2)
          if (fi > 0.01) {
            fparts.push(`afade=t=in:st=${laneStart.toFixed(3)}:d=${fi.toFixed(3)}`)
          }
          if (fo > 0.01) {
            fparts.push(`afade=t=out:st=${(laneEnd - fo).toFixed(3)}:d=${fo.toFixed(3)}`)
          }
        }
        if (fparts.length > 0) {
          filters.push(`[lane${laneNo}raw]${fparts.join(',')}[lane${laneNo}]`)
          laneLabels.push(`[lane${laneNo}]`)
          laneFinalLabels.set(lane, `[lane${laneNo}]`)
        } else {
          laneLabels.push(`[lane${laneNo}raw]`)
          laneFinalLabels.set(lane, `[lane${laneNo}raw]`)
        }
        laneNo++
      }
      // Auto Audio Ducking: the music lane is sidechain-
      // compressed by the voice — the Voice lane plus the video
      // clips' own audio — dipping about 12 dB while anyone
      // speaks and swelling back up when they stop.
      let mixMain = mainAudio
      const mixLanes = [...laneLabels]
      const musicLabel = laneFinalLabels.get('music')
      if (request.ducking && musicLabel) {
        const voiceLabel = laneFinalLabels.get('voice')
        filters.push(`${mainAudio}asplit=2[duckMain][duckKeyMain]`)
        mixMain = '[duckMain]'
        let keyLabel = '[duckKeyMain]'
        if (voiceLabel) {
          filters.push(`${voiceLabel}asplit=2[duckVoice][duckKeyVoice]`)
          filters.push(
            `[duckKeyMain][duckKeyVoice]amix=inputs=2:duration=longest:normalize=0[duckKey]`
          )
          keyLabel = '[duckKey]'
          const vi = mixLanes.indexOf(voiceLabel)
          if (vi >= 0) mixLanes[vi] = '[duckVoice]'
        }
        filters.push(
          `${musicLabel}${keyLabel}sidechaincompress=threshold=0.03:ratio=6:attack=25:release=450:makeup=1:detection=rms[ducked]`
        )
        const mi = mixLanes.indexOf(musicLabel)
        if (mi >= 0) mixLanes[mi] = '[ducked]'
      }
      filters.push(
        `${mixMain}${mixLanes.join('')}amix=inputs=${mixLanes.length + 1}:duration=first:normalize=0[outa]`
      )
      audioOut = '[outa]'
    }

    return new Promise((resolve, reject) => {
      const command = FFmpegService.trackCommand(ffmpeg())
      request.clips.forEach((clip) => command.input(clip.path))
      request.audioClips.forEach((audio) => command.input(audio.path))
      command
        .complexFilter(filters)
        .map('[outv]')
        .map(audioOut)
        .outputOptions([
          '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
          '-c:a', 'aac', '-b:a', '192k',
        ])
        .output(request.outputPath)
        .on('progress', (progress) => {
          if (progress.timemark && outputDuration > 0) {
            const parts = progress.timemark.split(':')
            const seconds =
              parseInt(parts[0], 10) * 3600 +
              parseInt(parts[1], 10) * 60 +
              parseFloat(parts[2])
            const percent = Math.round((seconds / outputDuration) * 100)
            if (Number.isFinite(percent)) {
              onProgress?.(Math.min(100, percent))
            }
          }
        })
        .on('end', () => {
          onProgress?.(100)
          resolve()
        })
        .on('error', reject)
        .run()
    })
  }

  /**
   * Extract a strip of small JPEG thumbnails across [start, end]
   * of a video for the timeline filmstrip. Results are cached
   * under the app's userData folder, keyed by path + range +
   * count, so re-renders of the editor do not re-extract.
   */
  /**
   * Peak levels for drawing an audio waveform: decode the kept
   * range to mono 4 kHz float PCM and take the peak per bucket.
   * Cached as JSON under userData/wave-cache. Files without an
   * audio stream yield all zeros.
   */
  static async extractWaveformPeaks(
    mediaPath: string,
    startSeconds: number,
    endSeconds: number,
    buckets: number
  ): Promise<number[]> {
    const length = Math.max(0.1, endSeconds - startSeconds)
    const count = Math.min(5000, Math.max(8, Math.floor(buckets)))
    const key = createHash('sha1')
      .update(
        `${mediaPath}|${startSeconds.toFixed(2)}|${endSeconds.toFixed(2)}|${count}`
      )
      .digest('hex')
      .slice(0, 16)
    const cacheDir = path.join(app.getPath('userData'), 'wave-cache')
    const cacheFile = path.join(cacheDir, `${key}.json`)
    try {
      if (fs.existsSync(cacheFile)) {
        const parsed = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
        if (
          Array.isArray(parsed) &&
          parsed.length === count &&
          parsed.some((p) => typeof p === 'number' && p > 0)
        ) {
          return parsed as number[]
        }
        // An all-zero cache entry means an earlier decode failed
        // and poisoned the cache — fall through and decode again.
      }
    } catch {
      // unreadable cache: regenerate below
    }
    const decoded = await new Promise<{
      buf: Buffer
      code: number | null
      stderr: string
      spawnError?: string
    }>((resolve) => {
      const child = spawn(resolveBinaryPath(ffmpegStatic), [
        '-v', 'error',
        '-ss', startSeconds.toFixed(3),
        '-i', mediaPath,
        '-t', length.toFixed(3),
        '-vn', '-ac', '1', '-ar', '4000',
        '-f', 'f32le', '-',
      ])
      const chunks: Buffer[] = []
      let stderr = ''
      child.stdout.on('data', (c: Buffer) => chunks.push(c))
      child.stderr.on('data', (c: Buffer) => {
        stderr = (stderr + c.toString()).slice(-300)
      })
      child.on('error', (err) =>
        resolve({
          buf: Buffer.alloc(0),
          code: null,
          stderr,
          spawnError: err.message,
        })
      )
      child.on('close', (code) =>
        resolve({ buf: Buffer.concat(chunks), code, stderr })
      )
    })
    const buf = decoded.buf
    const samples = Math.floor(buf.length / 4)
    if (samples === 0) {
      // Decode failed (missing binary, unreadable file, …). Log
      // the real reason and return flat peaks WITHOUT caching,
      // so the next open retries instead of staying flat forever.
      LogService.log(
        'waveform',
        `no samples decoded for ${mediaPath} [${startSeconds.toFixed(1)}-${endSeconds.toFixed(1)}s] ` +
          `code=${decoded.code} ${decoded.spawnError ?? ''} ${decoded.stderr.trim()}`
      )
      return new Array<number>(count).fill(0)
    }
    const peaks = new Array<number>(count).fill(0)
    if (samples > 0) {
      const view = new Float32Array(buf.buffer, buf.byteOffset, samples)
      const per = samples / count
      for (let b = 0; b < count; b++) {
        const from = Math.floor(b * per)
        const to = Math.max(from + 1, Math.floor((b + 1) * per))
        let peak = 0
        for (let i = from; i < to && i < samples; i++) {
          const v = Math.abs(view[i])
          if (v > peak) peak = v
        }
        peaks[b] = Math.round(Math.min(1, peak) * 1000) / 1000
      }
    }
    try {
      fs.mkdirSync(cacheDir, { recursive: true })
      fs.writeFileSync(cacheFile, JSON.stringify(peaks))
    } catch {
      // cache is best-effort
    }
    // One line per real decode (cache hits stay silent) so a
    // flat waveform can be diagnosed from the App Log: if this
    // line exists with max > 0, the peaks reached the renderer
    // and the problem is on the draw side.
    LogService.log(
      'waveform',
      `decoded ${mediaPath} [${startSeconds.toFixed(1)}-${endSeconds.toFixed(1)}s] ` +
        `buckets=${count} samples=${samples} max=${Math.max(...peaks).toFixed(3)}`
    )
    return peaks
  }

  /**
   * Save one frame of a clip as a PNG next to the source file, in
   * the same "first frame" folder the Last Frame button uses.
   * 'first' takes the frame at timeSeconds; 'last' decodes the
   * final 0.7 s of the kept range and keeps the last frame, so it
   * is the true last kept frame rather than a seek approximation.
   */
  static async extractFrameAt(
    videoPath: string,
    timeSeconds: number,
    which: 'first' | 'last',
    rangeStartSeconds: number
  ): Promise<string> {
    const dir = path.join(path.dirname(videoPath), 'first frame')
    fs.mkdirSync(dir, { recursive: true })
    const base = path.basename(videoPath).replace(/\.[^.]+$/, '')
    const outputPath = path.join(
      dir,
      `${base}_${which === 'first' ? 'firstframe' : 'lastframe'}.png`
    )
    const runOnce = (
      build: (command: ffmpeg.FfmpegCommand) => ffmpeg.FfmpegCommand
    ) =>
      new Promise<void>((resolve, reject) => {
        build(FFmpegService.trackCommand(ffmpeg(videoPath)))
          .on('end', () => resolve())
          .on('error', reject)
          .run()
      })
    if (which === 'first') {
      await runOnce((command) =>
        command
          .seekInput(Math.max(0, timeSeconds))
          .outputOptions(['-frames:v', '1', '-q:v', '2'])
          .output(outputPath)
      )
    } else {
      const winStart = Math.max(rangeStartSeconds, timeSeconds - 0.7)
      const winLen = Math.max(0.05, timeSeconds - winStart)
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'videoai-frame-'))
      try {
        await runOnce((command) =>
          command
            .seekInput(winStart)
            .duration(winLen)
            .outputOptions(['-vsync', 'vfr', '-q:v', '2'])
            .output(path.join(tmpDir, 'f%04d.png'))
        )
        const frames = fs
          .readdirSync(tmpDir)
          .filter((f) => f.endsWith('.png'))
          .sort()
        if (frames.length === 0) {
          throw new Error('No frame found at that position')
        }
        fs.copyFileSync(path.join(tmpDir, frames[frames.length - 1]), outputPath)
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    }
    return outputPath
  }

  static async extractThumbnails(
    videoPath: string,
    startSeconds: number,
    endSeconds: number,
    count: number
  ): Promise<string[]> {
    const key = createHash('sha1')
      .update(`${videoPath}|${startSeconds.toFixed(2)}|${endSeconds.toFixed(2)}|${count}`)
      .digest('hex')
      .slice(0, 16)
    const dir = path.join(app.getPath('userData'), 'thumb-cache', key)
    const wanted = Array.from(
      { length: count },
      (_, i) => path.join(dir, `f${String(i).padStart(2, '0')}.jpg`)
    )
    if (wanted.every((p) => fs.existsSync(p))) return wanted
    fs.mkdirSync(dir, { recursive: true })
    const length = Math.max(0.2, endSeconds - startSeconds)
    const fpsRate = count / length
    await new Promise<void>((resolve, reject) => {
      const command = FFmpegService.trackCommand(ffmpeg(videoPath))
      command
        .seekInput(Math.max(0, startSeconds))
        .duration(length)
        .videoFilters(`fps=${fpsRate.toFixed(4)},scale=144:80:force_original_aspect_ratio=increase,crop=144:80`)
        .outputOptions(['-q:v', '5'])
        .output(path.join(dir, 'f%02d.jpg'))
        .on('end', () => resolve())
        .on('error', reject)
        .run()
    })
    return wanted.filter((p) => fs.existsSync(p))
  }

  /**
   * Lanczos upscale (v0.4.2): faithful resize with no AI invention.
   * Chain: original -> RIFE (optional) -> Lanczos -> sharpen
   * (optional). With neither RIFE nor sharpen it stays the old
   * single ffmpeg pass (fast, no temp files); with either one it
   * runs the frame pipeline below — the same stages as
   * Real-ESRGAN minus the ncnn model — so the face cannot go
   * plastic.
   */
  static async upscaleLanczos(
    request: UpscaleRequest,
    onProgress?: (progress: number, stage?: string) => void
  ): Promise<void> {
    const sharpen = request.sharpen ?? 'off'
    if (!request.rife && sharpen === 'off') {
      return FFmpegService.upscaleLanczosSinglePass(
        request.videoPath,
        request.outputPath,
        request.targetHeight ?? 1080,
        onProgress
      )
    }
    return FFmpegService.upscaleFramePipeline(request, onProgress)
  }

  /**
   * The original quick Lanczos: one ffmpeg pass, scale + encode,
   * audio copied. Kept for the plain case (no RIFE, no sharpen).
   */
  static async upscaleLanczosSinglePass(
    inputPath: string,
    outputPath: string,
    targetHeight: number,
    onProgress?: (progress: number, stage?: string) => void
  ): Promise<void> {
    const metadata = await FFmpegService.getVideoMetadata(inputPath)
    onProgress?.(0, 'Upscale')
    return new Promise((resolve, reject) => {
      FFmpegService.trackCommand(ffmpeg(inputPath))
        .videoFilters(`scale=-2:${targetHeight}:flags=lanczos`)
        .outputOptions([
          '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
          '-pix_fmt', 'yuv420p', '-c:a', 'copy',
        ])
        .output(outputPath)
        .on('progress', (progress) => {
          if (progress.timemark && metadata.duration > 0) {
            const parts = progress.timemark.split(':')
            const seconds =
              parseInt(parts[0], 10) * 3600 +
              parseInt(parts[1], 10) * 60 +
              parseFloat(parts[2])
            const percent = Math.round((seconds / metadata.duration) * 100)
            if (Number.isFinite(percent)) {
              onProgress?.(Math.min(100, percent), 'Upscale')
            }
          }
        })
        .on('end', () => {
          onProgress?.(100, 'Upscale')
          resolve()
        })
        .on('error', reject)
        .run()
    })
  }

  /**
   * The shared frame pipeline for the Lanczos and "none"
   * methods: extract frames, optional RIFE at native size,
   * upscale stage (Lanczos resize of every frame — or skipped
   * entirely when the method is 'none', so a job can be RIFE
   * and/or sharpen only), rebuild with an optional sharpen
   * pass. Same stage layout, progress ranges and frame
   * verification as upscaleRealEsrgan; only the upscale stage
   * differs (ffmpeg scale instead of the ncnn binary), so the
   * methods cannot drift apart silently. Deliberately separate
   * from upscaleRealEsrgan: that path is production and must
   * not change.
   */
  static async upscaleFramePipeline(
    request: UpscaleRequest,
    onProgress?: (progress: number, stage?: string) => void
  ): Promise<void> {
    const targetHeight = request.targetHeight ?? 1080
    const SHARPEN_FILTERS = {
      light: 'unsharp=5:5:0.5:5:5:0.0',
      medium: 'unsharp=5:5:1.0:5:5:0.0',
      strong: 'unsharp=7:7:1.4:5:5:0.0',
    } as const
    const sharpenFilter =
      request.sharpen && request.sharpen !== 'off'
        ? SHARPEN_FILTERS[request.sharpen]
        : null

    // RIFE is optional; validate it up front so the job fails in
    // seconds, not after the frame extraction.
    const rife = request.rife
    let rifeExe = ''
    let rifeModel = ''
    let rifeMultiplier = 1
    if (rife) {
      rifeExe = rife.exePath?.trim() ?? ''
      if (!rifeExe || !fs.existsSync(rifeExe)) {
        throw new Error(
          'RIFE executable not found. Download rife-ncnn-vulkan ' +
            '(Windows release), unzip it, and set its path in Settings.'
        )
      }
      rifeModel =
        rife.modelPath?.trim() ||
        path.join(path.dirname(rifeExe), 'rife-v4.6')
      if (!fs.existsSync(rifeModel)) {
        throw new Error(
          `RIFE model folder not found: ${rifeModel}. ` +
            'Check the RIFE model path in Settings.'
        )
      }
      rifeMultiplier = rife.multiplier === 4 ? 4 : 2
    }

    // A 'none' job with no RIFE and no sharpen would just copy
    // the clip — refuse it here as well as in the job runner.
    if (
      request.method === 'none' &&
      !rife &&
      (!request.sharpen || request.sharpen === 'off')
    ) {
      throw new Error(
        'Nothing to do: pick at least one of RIFE, an upscale method, or Sharpen.'
      )
    }

    const cancelEpoch = FFmpegService.cancelEpoch
    const metadata = await FFmpegService.getVideoMetadata(request.videoPath)
    const fps = metadata.fps > 0 ? metadata.fps : 30
    const totalFrames = Math.max(1, Math.round(metadata.duration * fps))

    LogService.log(
      'upscale',
      `start input=${path.basename(request.videoPath)} ` +
        `${metadata.width}x${metadata.height} ${metadata.duration.toFixed(1)}s ` +
        `${request.method === 'none'
          ? 'upscale=none'
          : `lanczos target=${targetHeight}`} ` +
        `sharpen=${request.sharpen ?? 'off'} ` +
        `rife=${rife ? `${rifeMultiplier}x` : 'off'}`
    )
    const statsSampler = setInterval(async () => {
      try {
        const s = await SystemService.getStats()
        LogService.log(
          'stats',
          `cpu=${s.cpuPercent}% ram=${s.ramUsedGB.toFixed(1)}/${s.ramTotalGB.toFixed(1)}GB ` +
            (s.gpu
              ? `gpu=${s.gpu.utilPercent}% vram=${s.gpu.vramUsedMB}/${s.gpu.vramTotalMB}MB temp=${s.gpu.tempC}C`
              : 'gpu=n/a') +
            (s.cpuTempC !== undefined ? ` cpuTemp=${s.cpuTempC}C` : '')
        )
      } catch {
        // Sampling must never break the job.
      }
    }, 10000)

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'videoai-lanczos-'))
    const framesDir = path.join(tmpDir, 'frames')
    const rifeDir = path.join(tmpDir, 'rife')
    const upscaledDir = path.join(tmpDir, 'upscaled')
    fs.mkdirSync(framesDir)
    fs.mkdirSync(upscaledDir)
    if (rife) fs.mkdirSync(rifeDir)
    try {
      // Stage 1: extract frames as a PNG sequence.
      const extractEnd = rife ? 8 : 10
      onProgress?.(0, 'Extract Frames')
      await new Promise<void>((resolve, reject) => {
        FFmpegService.trackCommand(ffmpeg(request.videoPath))
          .outputOptions(['-vsync', '0'])
          .output(path.join(framesDir, 'frame_%06d.png'))
          .on('progress', (progress) => {
            if (progress.frames) {
              const share =
                Math.min(progress.frames, totalFrames) / totalFrames
              onProgress?.(Math.round(share * extractEnd), 'Extract Frames')
            }
          })
          .on('end', () => resolve())
          .on('error', reject)
          .run()
      })
      const frameCount = fs
        .readdirSync(framesDir)
        .filter((f) => f.endsWith('.png')).length
      if (frameCount === 0) {
        throw new Error('Frame extraction produced no frames')
      }

      FFmpegService.throwIfCancelled(cancelEpoch)

      LogService.log(
        'upscale',
        `extract done: ${totalFrames} frames ${metadata.width}x${metadata.height}`
      )

      // Stage 2 (optional): RIFE interpolation at native size.
      let upscaleInputDir = framesDir
      let finalFrameCount = frameCount
      if (rife) {
        await FFmpegService.runFrameTool({
          exePath: rifeExe,
          args: [
            '-i', framesDir,
            '-o', rifeDir,
            '-m', rifeModel,
            '-n', String(frameCount * rifeMultiplier),
            '-f', '%08d.png',
          ],
          outputDir: rifeDir,
          expectedFrames: frameCount * rifeMultiplier,
          rangeStart: extractEnd,
          rangeEnd: 30,
          stage: 'RIFE Interpolation',
          toolName: 'RIFE',
          onProgress,
        })
        upscaleInputDir = rifeDir
        finalFrameCount = fs
          .readdirSync(rifeDir)
          .filter((f) => f.endsWith('.png')).length
      }

      if (rife) {
        verifyFrameDir(rifeDir, {
          expectedCount: frameCount * rifeMultiplier,
          expectedWidth: metadata.width,
          expectedHeight: metadata.height,
          stage: 'RIFE',
        })
      }

      FFmpegService.throwIfCancelled(cancelEpoch)

      // Stage 3: the upscale stage — skipped entirely when the
      // method is 'none' (RIFE / sharpen only). Lanczos resize
      // of every frame otherwise. No AI — the scaler only
      // interpolates, it cannot invent detail (or plastic).
      // The frame pattern is derived from the actual files
      // (RIFE writes %08d names starting at 0, the extractor
      // writes frame_%06d starting at 1), so either chain
      // scales correctly.
      const skipUpscale = request.method === 'none'
      const outputFps = fps * rifeMultiplier
      if (!skipUpscale) {
      const stageStart = rife ? 30 : 10
      const lanczosWidth =
        2 * Math.round((metadata.width * targetHeight) / metadata.height / 2)
      LogService.log(
        'upscale',
        `lanczos start: ${finalFrameCount} frames -> ~${lanczosWidth}x${targetHeight}`
      )
      const stageFiles = fs
        .readdirSync(upscaleInputDir)
        .filter((f) => f.endsWith('.png'))
        .sort()
      const stageFirst = stageFiles[0]
      const stageDigits = stageFirst.match(/(\d+)\.png$/)
      const stageDigitWidth = stageDigits ? stageDigits[1].length : 6
      const stageStartNumber = stageDigits
        ? parseInt(stageDigits[1], 10)
        : 1
      const stagePrefix = stageFirst.slice(
        0,
        stageFirst.length - stageDigitWidth - '.png'.length
      )
      const stagePattern = path.join(
        upscaleInputDir,
        `${stagePrefix}%0${stageDigitWidth}d.png`
      )
      const stageOutPattern = path.join(
        upscaledDir,
        `${stagePrefix}%0${stageDigitWidth}d.png`
      )
      await new Promise<void>((resolve, reject) => {
        FFmpegService.trackCommand(ffmpeg())
          .input(stagePattern)
          .inputOptions([
            '-framerate', String(outputFps),
            '-start_number', String(stageStartNumber),
          ])
          .videoFilters(`scale=-2:${targetHeight}:flags=lanczos`)
          .output(stageOutPattern)
          .on('progress', (progress) => {
            if (progress.frames) {
              const share =
                Math.min(progress.frames, finalFrameCount) / finalFrameCount
              onProgress?.(
                Math.round(stageStart + share * (85 - stageStart)),
                'Lanczos Upscale'
              )
            }
          })
          .on('end', () => resolve())
          .on('error', reject)
          .run()
      })

      // ffmpeg rounds the -2 width to the nearest even value; read
      // the actual size back instead of trusting the arithmetic,
      // then run the usual count + blank checks on it.
      const outFirst = fs
        .readdirSync(upscaledDir)
        .filter((f) => f.endsWith('.png'))
        .sort()[0]
      const outDims = readPngDimensions(path.join(upscaledDir, outFirst))
      if (
        outDims.height !== targetHeight ||
        outDims.width % 2 !== 0 ||
        Math.abs(outDims.width - lanczosWidth) > 2
      ) {
        throw new Error(
          `Lanczos frame size is ${outDims.width}x${outDims.height}, ` +
            `expected ~${lanczosWidth}x${targetHeight} — scale mismatch?`
        )
      }
      verifyFrameDir(upscaledDir, {
        expectedCount: finalFrameCount,
        expectedWidth: outDims.width,
        expectedHeight: targetHeight,
        stage: 'Lanczos',
      })
      } else {
        // No upscale stage: the rebuild reads the (possibly
        // RIFE'd) frames at native size. Verify them the same
        // way the RIFE stage is verified.
        verifyFrameDir(upscaleInputDir, {
          expectedCount: finalFrameCount,
          expectedWidth: metadata.width,
          expectedHeight: metadata.height,
          stage: 'Frames',
        })
      }

      FFmpegService.throwIfCancelled(cancelEpoch)

      // Stage 4: rebuild. Same as the Real-ESRGAN path: the frame
      // pattern is derived from the actual files, the sharpen pass
      // runs in the encode, and the original audio is stream-copied.
      // With method 'none' there is no upscaled dir — rebuild
      // straight from the (possibly RIFE'd) input frames.
      const rebuildDir = skipUpscale ? upscaleInputDir : upscaledDir
      onProgress?.(85, 'Rebuild Video')
      const upscaledFrames = fs
        .readdirSync(rebuildDir)
        .filter((f) => f.endsWith('.png'))
        .sort()
      const firstFrame = upscaledFrames[0]
      const digitMatch = firstFrame.match(/(\d+)\.png$/)
      const digitWidth = digitMatch ? digitMatch[1].length : 6
      const startNumber = digitMatch ? parseInt(digitMatch[1], 10) : 1
      const prefix = firstFrame.slice(
        0,
        firstFrame.length - digitWidth - '.png'.length
      )
      const pattern = path.join(
        rebuildDir,
        `${prefix}%0${digitWidth}d.png`
      )
      await new Promise<void>((resolve, reject) => {
        const command = FFmpegService.trackCommand(ffmpeg())
          .input(pattern)
          .inputOptions([
            '-framerate', String(outputFps),
            '-start_number', String(startNumber),
          ])
        if (metadata.audioCodec) {
          command.input(request.videoPath)
        }
        command
          .outputOptions([
            '-map', '0:v',
            ...(metadata.audioCodec ? ['-map', '1:a', '-c:a', 'copy'] : []),
            '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
            '-pix_fmt', 'yuv420p',
            ...(sharpenFilter ? ['-vf', sharpenFilter] : []),
            '-r', String(outputFps),
          ])
          .output(request.outputPath)
          .on('progress', (progress) => {
            if (progress.frames) {
              const share =
                Math.min(progress.frames, finalFrameCount) / finalFrameCount
              onProgress?.(85 + Math.round(share * 15), 'Rebuild Video')
            }
          })
          .on('end', () => resolve())
          .on('error', reject)
          .run()
      })
      onProgress?.(100, 'Rebuild Video')
      LogService.log('upscale', `done -> ${request.outputPath}`)
    } finally {
      clearInterval(statsSampler)
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  }

  /**
   * Run one ncnn-vulkan frame tool (Real-ESRGAN or RIFE) over a
   * folder of frames, reporting progress as the share of output
   * frames that have appeared in the output folder.
   */
  private static async runFrameTool(options: {
    exePath: string
    args: string[]
    outputDir: string
    expectedFrames: number
    rangeStart: number
    rangeEnd: number
    stage: string
    toolName: string
    onProgress?: (progress: number, stage?: string) => void
  }): Promise<void> {
    const {
      exePath, args, outputDir, expectedFrames,
      rangeStart, rangeEnd, stage, toolName, onProgress,
    } = options
    onProgress?.(rangeStart, stage)
    await new Promise<void>((resolve, reject) => {
      const child = spawn(exePath, args, { windowsHide: true })
      FFmpegService.trackChild(child)
      let stderrTail = ''
      child.stderr.on('data', (chunk) => {
        stderrTail = (stderrTail + String(chunk)).slice(-2000)
      })
      child.on('error', (err) =>
        reject(new Error(`Could not start ${toolName}: ${err.message}`))
      )
      const poll = setInterval(() => {
        try {
          const doneCount = fs
            .readdirSync(outputDir)
            .filter((f) => f.endsWith('.png')).length
          const share = Math.min(doneCount, expectedFrames) / expectedFrames
          onProgress?.(
            rangeStart + Math.round(share * (rangeEnd - rangeStart)),
            stage
          )
        } catch {
          // output folder briefly unavailable; next poll retries
        }
      }, 500)
      child.on('close', (code) => {
        clearInterval(poll)
        if (code === 0) {
          resolve()
        } else {
          LogService.log(
            'tool',
            `${toolName} exited with code ${code}. ${stderrTail.trim()}`
          )
          reject(
            new Error(
              `${toolName} exited with code ${code}. ${stderrTail.trim()}`
            )
          )
        }
      })
    })
    const produced = fs
      .readdirSync(outputDir)
      .filter((f) => f.endsWith('.png')).length
    if (produced === 0) {
      throw new Error(`${toolName} produced no frames`)
    }
  }

  /**
   * Real-ESRGAN upscale through the realesrgan-ncnn-vulkan
   * executable (NOT the ffmpeg scaler), with an optional RIFE
   * frame-interpolation stage integrated into the same pipeline:
   *
   *   Stage 1 "Extract Frames" — the video is decoded to a PNG
   *     sequence (lossless, so the AI sees the exact frames).
   *   Stage 2 "RIFE Interpolation" (only when RIFE is enabled) —
   *     rife-ncnn-vulkan synthesises the in-between frames at the
   *     ORIGINAL resolution (cheap there, and the upscaler then
   *     treats every final frame the same). The frame rate
   *     multiplier is applied at rebuild time.
   *   Stage 3 "Upscale" — realesrgan-ncnn-vulkan upscales every
   *     frame with the chosen model.
   *   Stage 4 "Rebuild Video" — ffmpeg re-encodes the frames at
   *     the (possibly multiplied) frame rate and re-attaches the
   *     original audio track (stream copy).
   *
   * Overall progress with RIFE: extract 0-8%, RIFE 8-30%,
   * upscale 30-85%, rebuild 85-100%. Without RIFE the upscale
   * stage starts at 10%. The stage label is reported throughout
   * and shown in the Render Queue.
   */
  static async upscaleRealEsrgan(
    request: UpscaleRequest,
    onProgress?: (progress: number, stage?: string) => void
  ): Promise<void> {
    const exePath = request.exePath?.trim()
    if (!exePath || !fs.existsSync(exePath)) {
      throw new Error(
        'Real-ESRGAN executable not found. Download realesrgan-ncnn-vulkan ' +
          '(Windows release), unzip it, and set its path in Settings.'
      )
    }
    const scale = request.scale ?? 4
    const model = request.model ?? 'realesrgan-x4plus'
    // A built-in model only works at its own scale. The job runner
    // already resolves this (see resolveEsrganModel), but a stale or
    // hand-built request must not silently run the wrong scale:
    // 25/11/2026 a "2x" job with a 4x model ran 4x and produced
    // black frames, yet reported "done".
    const ESRGAN_MODEL_SCALES: Record<string, number> = {
      'realesr-animevideov3-x2': 2,
      'realesr-animevideov3-x3': 3,
      'realesr-animevideov3-x4': 4,
      'realesrgan-x4plus': 4,
      'realesrgan-x4plus-anime': 4,
      'realesrnet-x4plus': 4,
    }
    const nativeScale = ESRGAN_MODEL_SCALES[model]
    if (nativeScale !== undefined && nativeScale !== scale) {
      throw new Error(
        `Real-ESRGAN model "${model}" is a ${nativeScale}x model but the job scale is ${scale}x — pick a matching scale and model in Settings.`
      )
    }
    // Optional sharpen pass in the rebuild encode — counters
    // the plastic over-smoothing of the light video models.
    const SHARPEN_FILTERS = {
      light: 'unsharp=5:5:0.5:5:5:0.0',
      medium: 'unsharp=5:5:1.0:5:5:0.0',
      strong: 'unsharp=7:7:1.4:5:5:0.0',
    } as const
    const sharpenFilter =
      request.sharpen && request.sharpen !== 'off'
        ? SHARPEN_FILTERS[request.sharpen]
        : null
    const modelsPath =
      request.modelsPath?.trim() ||
      path.join(path.dirname(exePath), 'models')
    if (!fs.existsSync(path.join(modelsPath, `${model}.param`))) {
      throw new Error(
        `Real-ESRGAN model "${model}" not found in ${modelsPath}. ` +
          'Check the models folder in Settings.'
      )
    }

    // RIFE is optional; validate it up front so the job fails in
    // seconds, not after the frame extraction.
    const rife = request.rife
    let rifeExe = ''
    let rifeModel = ''
    let rifeMultiplier = 1
    if (rife) {
      rifeExe = rife.exePath?.trim() ?? ''
      if (!rifeExe || !fs.existsSync(rifeExe)) {
        throw new Error(
          'RIFE executable not found. Download rife-ncnn-vulkan ' +
            '(Windows release), unzip it, and set its path in Settings.'
        )
      }
      rifeModel =
        rife.modelPath?.trim() ||
        path.join(path.dirname(rifeExe), 'rife-v4.6')
      if (!fs.existsSync(rifeModel)) {
        throw new Error(
          `RIFE model folder not found: ${rifeModel}. ` +
            'Check the RIFE model path in Settings.'
        )
      }
      rifeMultiplier = rife.multiplier === 4 ? 4 : 2
    }

    const cancelEpoch = FFmpegService.cancelEpoch
    const metadata = await FFmpegService.getVideoMetadata(request.videoPath)
    const fps = metadata.fps > 0 ? metadata.fps : 30
    const totalFrames = Math.max(1, Math.round(metadata.duration * fps))

    // Log the run and sample system stats while the heavy stages
    // run. If the machine dies mid-job (power/thermal/driver), the
    // last lines of the log show the load right before the death.
    LogService.log(
      'upscale',
      `start input=${path.basename(request.videoPath)} ` +
        `${metadata.width}x${metadata.height} ${metadata.duration.toFixed(1)}s ` +
        `scale=${scale} model=${model} tile=${request.tileSize ?? 0} ` +
        `sharpen=${request.sharpen ?? 'off'} ` +
        `rife=${rife ? `${rifeMultiplier}x` : 'off'}`
    )
    const statsSampler = setInterval(async () => {
      try {
        const s = await SystemService.getStats()
        LogService.log(
          'stats',
          `cpu=${s.cpuPercent}% ram=${s.ramUsedGB.toFixed(1)}/${s.ramTotalGB.toFixed(1)}GB ` +
            (s.gpu
              ? `gpu=${s.gpu.utilPercent}% vram=${s.gpu.vramUsedMB}/${s.gpu.vramTotalMB}MB temp=${s.gpu.tempC}C`
              : 'gpu=n/a') +
            (s.cpuTempC !== undefined ? ` cpuTemp=${s.cpuTempC}C` : '')
        )
      } catch {
        // Sampling must never break the job.
      }
    }, 10000)

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'videoai-esrgan-'))
    const framesDir = path.join(tmpDir, 'frames')
    const rifeDir = path.join(tmpDir, 'rife')
    const upscaledDir = path.join(tmpDir, 'upscaled')
    fs.mkdirSync(framesDir)
    fs.mkdirSync(upscaledDir)
    if (rife) fs.mkdirSync(rifeDir)
    try {
      // Stage 1: extract frames as a PNG sequence.
      const extractEnd = rife ? 8 : 10
      onProgress?.(0, 'Extract Frames')
      await new Promise<void>((resolve, reject) => {
        FFmpegService.trackCommand(ffmpeg(request.videoPath))
          .outputOptions(['-vsync', '0'])
          .output(path.join(framesDir, 'frame_%06d.png'))
          .on('progress', (progress) => {
            if (progress.frames) {
              const share = Math.min(progress.frames, totalFrames) / totalFrames
              onProgress?.(Math.round(share * extractEnd), 'Extract Frames')
            }
          })
          .on('end', () => resolve())
          .on('error', reject)
          .run()
      })
      const frameCount = fs
        .readdirSync(framesDir)
        .filter((f) => f.endsWith('.png')).length
      if (frameCount === 0) {
        throw new Error('Frame extraction produced no frames')
      }

      FFmpegService.throwIfCancelled(cancelEpoch)

      LogService.log(
        'upscale',
        `extract done: ${totalFrames} frames ${metadata.width}x${metadata.height}`
      )

      // Stage 2 (optional): RIFE interpolation at native size.
      let esrganInputDir = framesDir
      let finalFrameCount = frameCount
      if (rife) {
        await FFmpegService.runFrameTool({
          exePath: rifeExe,
          args: [
            '-i', framesDir,
            '-o', rifeDir,
            '-m', rifeModel,
            '-n', String(frameCount * rifeMultiplier),
            '-f', '%08d.png',
          ],
          outputDir: rifeDir,
          expectedFrames: frameCount * rifeMultiplier,
          rangeStart: extractEnd,
          rangeEnd: 30,
          stage: 'RIFE Interpolation',
          toolName: 'RIFE',
          onProgress,
        })
        esrganInputDir = rifeDir
        finalFrameCount = fs
          .readdirSync(rifeDir)
          .filter((f) => f.endsWith('.png')).length
      }

      // A tool that writes black frames must fail here, not at the
      // end with a corrupt video marked "done".
      if (rife) {
        verifyFrameDir(rifeDir, {
          expectedCount: frameCount * rifeMultiplier,
          expectedWidth: metadata.width,
          expectedHeight: metadata.height,
          stage: 'RIFE',
        })
      }

      FFmpegService.throwIfCancelled(cancelEpoch)

      LogService.log(
        'upscale',
        `esrgan start: ${finalFrameCount} frames, tile=${request.tileSize ?? 0}`
      )

      // Stage 3: Real-ESRGAN upscale of every frame.
      await FFmpegService.runFrameTool({
        exePath,
        args: [
          '-i', esrganInputDir,
          '-o', upscaledDir,
          '-s', String(scale),
          '-m', modelsPath,
          '-n', model,
          '-f', 'png',
          // Tile cap: without it the binary may try to hold a whole
          // large frame (plus the scaled result) in VRAM at once and
          // die out-of-memory near the end of a long upscale.
          ...(request.tileSize && request.tileSize > 0
            ? ['-t', String(request.tileSize)]
            : []),
        ],
        outputDir: upscaledDir,
        expectedFrames: finalFrameCount,
        rangeStart: rife ? 30 : 10,
        rangeEnd: 85,
        stage: 'Upscale',
        toolName: 'Real-ESRGAN',
        onProgress,
      })

      verifyFrameDir(upscaledDir, {
        expectedCount: finalFrameCount,
        expectedWidth: metadata.width * scale,
        expectedHeight: metadata.height * scale,
        stage: 'Real-ESRGAN',
      })

      FFmpegService.throwIfCancelled(cancelEpoch)

      // Stage 4: rebuild. The frame pattern is derived from the
      // actual files (RIFE writes %08d names starting at 0, the
      // extractor writes frame_%06d starting at 1), so either
      // chain rebuilds correctly.
      onProgress?.(85, 'Rebuild Video')
      const upscaledFrames = fs
        .readdirSync(upscaledDir)
        .filter((f) => f.endsWith('.png'))
        .sort()
      const firstFrame = upscaledFrames[0]
      const digitMatch = firstFrame.match(/(\d+)\.png$/)
      const digitWidth = digitMatch ? digitMatch[1].length : 6
      const startNumber = digitMatch ? parseInt(digitMatch[1], 10) : 1
      const prefix = firstFrame.slice(
        0,
        firstFrame.length - digitWidth - '.png'.length
      )
      const pattern = path.join(
        upscaledDir,
        `${prefix}%0${digitWidth}d.png`
      )
      const outputFps = fps * rifeMultiplier
      await new Promise<void>((resolve, reject) => {
        const command = FFmpegService.trackCommand(ffmpeg())
          .input(pattern)
          .inputOptions([
            '-framerate', String(outputFps),
            '-start_number', String(startNumber),
          ])
        if (metadata.audioCodec) {
          command.input(request.videoPath)
        }
        command
          .outputOptions([
            '-map', '0:v',
            ...(metadata.audioCodec ? ['-map', '1:a', '-c:a', 'copy'] : []),
            '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
            '-pix_fmt', 'yuv420p',
            ...(sharpenFilter ? ['-vf', sharpenFilter] : []),
            '-r', String(outputFps),
          ])
          .output(request.outputPath)
          .on('progress', (progress) => {
            if (progress.frames) {
              const share =
                Math.min(progress.frames, finalFrameCount) / finalFrameCount
              onProgress?.(85 + Math.round(share * 15), 'Rebuild Video')
            }
          })
          .on('end', () => resolve())
          .on('error', reject)
          .run()
      })
      onProgress?.(100, 'Rebuild Video')
      LogService.log('upscale', `done -> ${request.outputPath}`)
    } finally {
      clearInterval(statsSampler)
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  }

  /**
   * Export video with quality preset
   */

  /**
   * Trim to [startSeconds, endSeconds]. Re-encoded, so the cut
   * points are frame-accurate.
   */
  static async trimVideo(
    inputPath: string,
    outputPath: string,
    startSeconds: number,
    endSeconds: number,
    onProgress?: (progress: number) => void
  ): Promise<void> {
    const duration = Math.max(0.1, endSeconds - startSeconds)
    return new Promise((resolve, reject) => {
      FFmpegService.trackCommand(ffmpeg(inputPath))
        .seekInput(Math.max(0, startSeconds))
        .duration(duration)
        .output(outputPath)
        .outputOptions(
          '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium',
          '-crf', '20', '-c:a', 'aac'
        )
        .on('progress', (progress) => {
          const done = timemarkSeconds(progress.timemark)
          onProgress?.(Math.min(100, Math.round((done / duration) * 100)))
        })
        .on('end', () => resolve())
        .on('error', reject)
        .run()
    })
  }

  /**
   * Split a video into a parts folder. Mode 'at' cuts once into
   * part1/part2; mode 'segments' cuts every segmentSeconds into
   * part000, part001, ... Returns the produced file paths.
   */
  static async splitVideo(
    inputPath: string,
    partsDir: string,
    options: {
      mode: 'at' | 'segments'
      atSeconds?: number
      segmentSeconds?: number
    },
    onProgress?: (progress: number) => void
  ): Promise<string[]> {
    fs.mkdirSync(partsDir, { recursive: true })
    if (options.mode === 'at') {
      const at = Math.max(0, options.atSeconds ?? 0)
      const metadata = await FFmpegService.getVideoMetadata(inputPath)
      const part1 = path.join(partsDir, 'part1.mp4')
      const part2 = path.join(partsDir, 'part2.mp4')
      await FFmpegService.trimVideo(inputPath, part1, 0, at, (p) =>
        onProgress?.(Math.round(p / 2))
      )
      await FFmpegService.trimVideo(
        inputPath,
        part2,
        at,
        metadata.duration,
        (p) => onProgress?.(50 + Math.round(p / 2))
      )
      return [part1, part2]
    }
    // Segments are cut as a loop of frame-accurate trims. (The
    // ffmpeg segment muxer was tried first and rejected: on the
    // bundled build it skips the first keyframe boundary, so a
    // 12s clip at 4s segments came out as 8s + 4s.)
    const segmentSeconds = Math.max(1, options.segmentSeconds ?? 10)
    const metadata = await FFmpegService.getVideoMetadata(inputPath)
    const totalParts = Math.max(
      1,
      Math.ceil(metadata.duration / segmentSeconds)
    )
    const parts: string[] = []
    for (let i = 0; i < totalParts; i++) {
      const start = i * segmentSeconds
      const end = Math.min(metadata.duration, start + segmentSeconds)
      if (end - start < 0.05) break
      const partPath = path.join(
        partsDir,
        `part${String(i).padStart(3, '0')}.mp4`
      )
      await FFmpegService.trimVideo(inputPath, partPath, start, end, (p) =>
        onProgress?.(Math.round(((i + p / 100) / totalParts) * 100))
      )
      parts.push(partPath)
    }
    return parts
  }

  /** Crop to a rectangle (x, y = top-left corner). */
  static async cropVideo(
    inputPath: string,
    outputPath: string,
    crop: { x: number; y: number; width: number; height: number },
    onProgress?: (progress: number) => void
  ): Promise<void> {
    // yuv420p needs even dimensions.
    const width = crop.width - (crop.width % 2)
    const height = crop.height - (crop.height % 2)
    if (width < 16 || height < 16) {
      throw new Error('Crop rectangle is too small')
    }
    return new Promise((resolve, reject) => {
      FFmpegService.trackCommand(ffmpeg(inputPath))
        .videoFilters(
          `crop=${width}:${height}:${Math.max(0, crop.x)}:${Math.max(0, crop.y)}`
        )
        .output(outputPath)
        .outputOptions(
          '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium',
          '-crf', '20', '-c:a', 'aac'
        )
        .on('progress', (progress) => onProgress?.(progress.percent || 0))
        .on('end', () => resolve())
        .on('error', reject)
        .run()
    })
  }

  /**
   * Change playback speed (video and audio together). Factor >1
   * is faster, <1 is slower.
   */
  static async changeSpeed(
    inputPath: string,
    outputPath: string,
    factor: number,
    onProgress?: (progress: number) => void
  ): Promise<void> {
    if (!(factor > 0)) throw new Error('Speed factor must be positive')
    const metadata = await FFmpegService.getVideoMetadata(inputPath)
    const outDuration = metadata.duration / factor
    // atempo accepts 0.5-2.0 per stage on older ffmpeg builds;
    // chain stages to reach any factor safely.
    const stages: number[] = []
    let rest = factor
    while (rest > 2) {
      stages.push(2)
      rest /= 2
    }
    while (rest < 0.5) {
      stages.push(0.5)
      rest /= 0.5
    }
    stages.push(rest)
    return new Promise((resolve, reject) => {
      const command = FFmpegService.trackCommand(ffmpeg(inputPath))
        .videoFilters(`setpts=${(1 / factor).toFixed(6)}*PTS`)
      if (metadata.audioCodec) {
        command.audioFilters(stages.map((s) => `atempo=${s.toFixed(5)}`))
      } else {
        command.noAudio()
      }
      command
        .output(outputPath)
        .outputOptions(
          '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium',
          '-crf', '20', '-c:a', 'aac'
        )
        .on('progress', (progress) => {
          const done = timemarkSeconds(progress.timemark)
          if (outDuration > 0) {
            onProgress?.(Math.min(100, Math.round((done / outDuration) * 100)))
          }
        })
        .on('end', () => resolve())
        .on('error', reject)
        .run()
    })
  }

  /** Rotate (90 CW / 90 CCW / 180) or flip (horizontal / vertical). */
  static async transformVideo(
    inputPath: string,
    outputPath: string,
    transform: 'rot90' | 'rot-90' | 'rot180' | 'flipH' | 'flipV',
    onProgress?: (progress: number) => void
  ): Promise<void> {
    const filters: Record<string, string> = {
      rot90: 'transpose=1',
      'rot-90': 'transpose=2',
      rot180: 'hflip,vflip',
      flipH: 'hflip',
      flipV: 'vflip',
    }
    const filter = filters[transform]
    if (!filter) throw new Error(`Unknown transform: ${transform}`)
    return new Promise((resolve, reject) => {
      FFmpegService.trackCommand(ffmpeg(inputPath))
        .videoFilters(filter)
        .output(outputPath)
        .outputOptions(
          '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium',
          '-crf', '20', '-c:a', 'aac'
        )
        .on('progress', (progress) => onProgress?.(progress.percent || 0))
        .on('end', () => resolve())
        .on('error', reject)
        .run()
    })
  }

  /**
   * Build a timeline thumbnail sheet: frames sampled evenly
   * across the video, tiled into one PNG (default 5x2 = 10
   * frames) — a contact sheet for eyeballing the whole clip.
   */
  static async timelineThumbnails(
    inputPath: string,
    outputPath: string,
    columns = 5,
    rows = 2,
    onProgress?: (progress: number) => void
  ): Promise<void> {
    const metadata = await FFmpegService.getVideoMetadata(inputPath)
    const count = Math.max(1, columns * rows)
    const interval = Math.max(0.5, metadata.duration / count)
    onProgress?.(10)
    await new Promise<void>((resolve, reject) => {
      FFmpegService.trackCommand(ffmpeg(inputPath))
        .outputOptions(
          '-vf',
          `fps=1/${interval.toFixed(3)},scale=320:-2,tile=${columns}x${rows}`,
          '-frames:v',
          '1'
        )
        .output(outputPath)
        .on('end', () => resolve())
        .on('error', reject)
        .run()
    })
    onProgress?.(100)
  }

  static async exportVideo(
    inputPath: string,
    outputPath: string,
    quality: 'low' | 'medium' | 'high' = 'medium',
    onProgress?: (progress: number) => void
  ): Promise<void> {
    const presets = {
      low: ['-crf', '28', '-preset', 'ultrafast'],
      medium: ['-crf', '23', '-preset', 'medium'],
      high: ['-crf', '18', '-preset', 'slow'],
    }

    return new Promise((resolve, reject) => {
      FFmpegService.trackCommand(ffmpeg(inputPath))
        .output(outputPath)
        .outputOptions(
          ...presets[quality],
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac'
        )
        .on('progress', (progress) => {
          onProgress?.(progress.percent || 0)
        })
        .on('end', () => resolve())
        .on('error', reject)
        .run()
    })
  }
}
