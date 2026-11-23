import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'

ffmpeg.setFfmpegPath(ffmpegStatic!)

export class FFmpegService {
  /**
   * Get video metadata
   */
  static async getVideoMetadata(videoPath: string) {
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

        resolve({
          format: metadata.format.format_name || 'unknown',
          duration: metadata.format.duration || 0,
          bitrate: metadata.format.bit_rate || 0,
          width: stream.width || 0,
          height: stream.height || 0,
          fps: parseFloat(stream.r_frame_rate?.split('/')[0] || '30'),
          codec: stream.codec_name || 'unknown',
          audioCodec: metadata.streams.find((s) => s.codec_type === 'audio')?.codec_name,
        })
      })
    })
  }

  /**
   * Remove silence from video
   */
  static async removeSilence(
    inputPath: string,
    outputPath: string,
    threshold: number = -40,
    onProgress?: (progress: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const silenceFilter = `silenceremove=1=1dB=0.1:1=${threshold}dB=0.1`
      ffmpeg(inputPath)
        .audioFilter(silenceFilter)
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
   * Add background music to video
   */
  static async addBackgroundMusic(
    videoPath: string,
    audioPath: string,
    outputPath: string,
    audioVolume: number = 0.5,
    onProgress?: (progress: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const volumeFilter = `[1]volume=${audioVolume}[a1]`
      ffmpeg()
        .input(videoPath)
        .input(audioPath)
        .complexFilter([
          volumeFilter,
          '[0:a][a1]amix=inputs=2:duration=first[a]',
        ])
        .map('[0:v]')
        .map('[a]')
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
        .outputOptions(...presets[quality])
        .on('progress', (progress) => {
          onProgress?.(progress.percent || 0)
        })
        .on('end', () => resolve())
        .on('error', reject)
        .run()
    })
  }
}
