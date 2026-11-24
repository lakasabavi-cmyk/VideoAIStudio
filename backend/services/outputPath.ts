import fs from 'fs'
import path from 'path'

/**
 * Never silently overwrite a previous render. Re-running a job
 * with the same input + settings derives the same output
 * filename, so a second run used to destroy the first result:
 * 25/11/2026 a Tile 400 upscale overwrote the good Tile 256
 * output (36 minutes of work) because both were
 * "Thuviendongtac_00007__4x_rife2x.mp4".
 * "clip_4x.mp4" exists -> "clip_4x_2.mp4", then _3, ...
 */
export function uniqueOutputPath(outputPath: string): string {
  if (!fs.existsSync(outputPath)) return outputPath
  const parsed = path.parse(outputPath)
  let n = 2
  let candidate = path.join(parsed.dir, `${parsed.name}_${n}${parsed.ext}`)
  while (fs.existsSync(candidate)) {
    n++
    candidate = path.join(parsed.dir, `${parsed.name}_${n}${parsed.ext}`)
  }
  return candidate
}
