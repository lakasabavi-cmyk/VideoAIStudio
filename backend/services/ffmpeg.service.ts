import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import fs from 'fs'

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
}

interface SilenceRange {
  start: number
  end: number
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
        })
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

      ffmpeg(inputPath)
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
      ffmpeg(inputPath)
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
   * Add background music to video.
   * The music is looped so it covers the whole video, and amix runs
   * with normalize=0 so the original audio keeps its level.
   */
  static async addBackgroundMusic(
    videoPath: string,
    audioPath: string,
    outputPath: string,
    audioVolume: number = 0.5,
    onProgress?: (progress: number) => void
  ): Promise<void> {
    const metadata = await FFmpegService.getVideoMetadata(videoPath)

    return new Promise((resolve, reject) => {
      const command = ffmpeg()
        .input(videoPath)
        .input(audioPath)
        .inputOptions(['-stream_loop', '-1'])

      // Note: the video stream must be mapped as the raw option
      // '-map 0:v'. fluent-ffmpeg's .map() helper wraps its argument
      // in brackets (it is meant for filter-graph labels), producing
      // '-map [0:v]', which ffmpeg rejects because 0:v is a raw input
      // stream, not a filter output.
      if (metadata.audioCodec) {
        command
          .complexFilter([
            `[1:a]volume=${audioVolume}[a1]`,
            '[0:a][a1]amix=inputs=2:duration=first:normalize=0[a]',
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
   * Reduce the original background music while keeping dialogue.
   *
   * ffmpeg has no AI source separation, so this uses the classic
   * center-channel approach: dialogue in typical stereo content
   * sits in the phantom center while music spreads across the
   * sides. The track is widened to 3.0 with a derived center
   * (L+R)/2, ffmpeg's dialoguenhance filter lifts that center,
   * and the downmix folds the center back in with the sides
   * turned down. Strength 0 leaves the mix almost untouched;
   * strength 1 is the most aggressive. Music whose lead vocal is
   * also centered will not separate cleanly — that needs a
   * dedicated AI separator, which this is not.
   */
  static async removeBackgroundMusic(
    inputPath: string,
    outputPath: string,
    strength: number = 0.7,
    onProgress?: (progress: number) => void
  ): Promise<void> {
    const metadata = await FFmpegService.getVideoMetadata(inputPath)
    if (!metadata.audioCodec) {
      throw new Error('Video has no audio track to remove music from')
    }

    const s = Math.min(1, Math.max(0, strength))
    const original = (1 - 0.8 * s).toFixed(2)
    const enhance = (1 + 2 * s).toFixed(2)
    const sideGain = (1 - 0.5 * s).toFixed(2)

    const filters: string[] = []
    const channels = metadata.audioChannels ?? 2
    if (channels === 1) {
      filters.push('pan=stereo|c0=c0|c1=c0')
    } else if (channels > 2) {
      // Standard surround order FL FR FC LFE BL BR: fold the
      // center into a stereo pair first.
      filters.push('pan=stereo|c0=c0+0.7*c2|c1=c1+0.7*c2')
    }
    filters.push(
      'pan=3.0|c0=c0|c1=c1|c2=0.5*c0+0.5*c1',
      `dialoguenhance=original=${original}:enhance=${enhance}:voice=4`,
      `pan=stereo|c0=${sideGain}*c0+0.8*c2|c1=${sideGain}*c1+0.8*c2`,
      'alimiter=limit=0.95'
    )

    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .audioFilter(filters.join(','))
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
   * Export video with quality preset
   */
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
      ffmpeg(inputPath)
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
