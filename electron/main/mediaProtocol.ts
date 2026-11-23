import { protocol } from 'electron'
import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'

/**
 * Local media playback for the renderer.
 *
 * The renderer page is served from http://localhost in dev, and
 * Chromium refuses to load file:// resources from an http page
 * ("Not allowed to load local resource"), so a plain file:// URL
 * in a <video> element never plays. Instead the renderer uses
 * media:// URLs (see toFileUrl in src/lib/files.ts) and this
 * handler streams the file from disk with HTTP Range support,
 * which is what makes playback *and seeking* work.
 */

export const MEDIA_SCHEME = 'media'

const MIME_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
}

/** Must run before the app 'ready' event. */
export function registerMediaSchemePrivileges() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: { secure: true, stream: true, supportFetchAPI: true },
    },
  ])
}

/** "media:///C:/v/clip%201.mp4" -> "C:/v/clip 1.mp4" (POSIX paths pass through). */
export function mediaPathFromUrl(url: string): string {
  const pathname = decodeURIComponent(new URL(url).pathname)
  // Strip the leading slash only when it precedes a Windows drive letter.
  return /^\/[A-Za-z]:/.test(pathname) ? pathname.slice(1) : pathname
}

/**
 * Parse a single-range "bytes=..." header against the file size.
 * Returns inclusive { start, end }, or null when there is no usable
 * range (serve the whole file instead).
 */
export function parseRange(
  rangeHeader: string | null,
  size: number
): { start: number; end: number } | null {
  if (!rangeHeader || size === 0) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
  if (!match) return null
  const [, startText, endText] = match
  if (startText === '' && endText === '') return null
  if (startText === '') {
    // Suffix range: the last N bytes.
    const suffix = Number(endText)
    if (!Number.isFinite(suffix) || suffix <= 0) return null
    return { start: Math.max(size - suffix, 0), end: size - 1 }
  }
  const start = Number(startText)
  if (!Number.isFinite(start) || start >= size) return null
  const end =
    endText === ''
      ? size - 1
      : Math.min(Number(endText), size - 1)
  if (!Number.isFinite(end) || end < start) return null
  return { start, end }
}

/** Must run after the app 'ready' event. */
export function registerMediaProtocol() {
  // Electron's main process exposes the standard fetch Response.
  const WebResponse: any = (globalThis as any).Response

  protocol.handle(MEDIA_SCHEME, (request) => {
    const filePath = mediaPathFromUrl(request.url)
    let size: number
    try {
      size = fs.statSync(filePath).size
    } catch {
      return new WebResponse('Not found', { status: 404 })
    }
    const contentType =
      MIME_TYPES[path.extname(filePath).toLowerCase()] ??
      'application/octet-stream'
    const range = parseRange(request.headers.get('range'), size)

    if (range) {
      const { start, end } = range
      const body: any = Readable.toWeb(
        fs.createReadStream(filePath, { start, end })
      )
      return new WebResponse(body, {
        status: 206,
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Accept-Ranges': 'bytes',
        },
      })
    }

    const body: any = Readable.toWeb(fs.createReadStream(filePath))
    return new WebResponse(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(size),
        'Accept-Ranges': 'bytes',
      },
    })
  })
}
