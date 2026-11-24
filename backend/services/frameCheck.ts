import fs from 'fs'
import path from 'path'

/**
 * Post-stage verification for frame-sequence folders (RIFE /
 * Real-ESRGAN output). The runner used to only check that *some*
 * frames were produced, so a tool that wrote black frames after
 * the first one still reported "done" (25/11/2026: a 4x + RIFE 2x
 * job finished in 01:55 with every frame after the first pure
 * black). These checks fail loudly instead:
 *  - exact frame count,
 *  - first-frame dimensions against the expected size,
 *  - sampled frames must not be blank.
 *
 * A blank PNG (all-black frame) compresses to ~0.01% of raw size,
 * so a frame whose file is under 0.5% of raw RGB bytes is blank.
 * At least 3 of up to 5 samples must be blank to fail, so a brief
 * fade-to-black in the source does not trip it.
 */

export function readPngDimensions(filePath: string): {
  width: number
  height: number
} {
  const buf = fs.readFileSync(filePath)
  if (
    buf.length < 33 ||
    buf.readUInt32BE(0) !== 0x89504e47 ||
    buf.readUInt32BE(4) !== 0x0d0a1a0a
  ) {
    throw new Error(`Not a PNG file: ${path.basename(filePath)}`)
  }
  // IHDR chunk: length at 8, type 'IHDR' at 12, width at 16, height at 20.
  if (buf.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error(`PNG without IHDR: ${path.basename(filePath)}`)
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

export interface FrameDirCheck {
  expectedCount: number
  expectedWidth: number
  expectedHeight: number
  stage: string
}

function sampleIndices(n: number): number[] {
  if (n <= 5) return Array.from({ length: n }, (_, i) => i)
  return [0, Math.floor(n * 0.25), Math.floor(n * 0.5), Math.floor(n * 0.75), n - 1]
}

export function verifyFrameDir(dir: string, check: FrameDirCheck): void {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.png'))
    .sort()
  if (files.length !== check.expectedCount) {
    throw new Error(
      `${check.stage} produced ${files.length} frames, expected ${check.expectedCount} — the tool stopped early or skipped frames. Check the App Log [tool] lines.`
    )
  }
  if (files.length === 0) {
    throw new Error(`${check.stage} produced no frames`)
  }
  const firstPath = path.join(dir, files[0])
  const dims = readPngDimensions(firstPath)
  if (dims.width !== check.expectedWidth || dims.height !== check.expectedHeight) {
    throw new Error(
      `${check.stage} frame size is ${dims.width}x${dims.height}, expected ${check.expectedWidth}x${check.expectedHeight} — scale/model mismatch? Check ESRGAN scale and model in Settings.`
    )
  }
  const rawBytes = check.expectedWidth * check.expectedHeight * 3
  const blankThreshold = Math.max(4096, rawBytes * 0.005)
  const idxs = sampleIndices(files.length)
  let blank = 0
  for (const i of idxs) {
    const size = fs.statSync(path.join(dir, files[i])).size
    if (size < blankThreshold) blank++
  }
  if (blank >= 3) {
    throw new Error(
      `${check.stage} frames look blank (${blank} of ${idxs.length} sampled frames are near-empty) — the tool wrote black frames. Check the source clip, the tile size, and the App Log [tool] lines.`
    )
  }
}
