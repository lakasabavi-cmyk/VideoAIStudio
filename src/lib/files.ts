/**
 * Small path helpers for the renderer, which has no access to
 * Node's path module. They handle both Windows and POSIX separators.
 */

/** "C:\v\clip.mp4" + ".nosil" -> "C:\v\clip.nosil.mp4" */
export function withSuffix(filePath: string, suffix: string): string {
  const sep = filePath.includes('\\') ? '\\' : '/'
  const parts = filePath.split(sep)
  const file = parts.pop() ?? filePath
  const dot = file.lastIndexOf('.')
  const stamped =
    dot > 0
      ? `${file.slice(0, dot)}${suffix}${file.slice(dot)}`
      : `${file}${suffix}.mp4`
  return [...parts, stamped].join(sep)
}

/**
 * Convert a local filesystem path into a media:// URL for the
 * <video> element. A raw path is not a URL at all, and a file://
 * URL is refused when the page itself is served from
 * http://localhost in dev ("Not allowed to load local resource").
 * The media:// scheme is served by the main process with HTTP
 * Range support - see electron/main/mediaProtocol.ts. A raw path like
 * "C:\v\clip.mp4" is not a URL and fails both in dev (page served
 * from http://localhost) and in production.
 */
export function toFileUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const prefix = normalized.startsWith('/') ? 'media://' : 'media:///'
  const encoded = normalized
    .split('/')
    .map((segment, i) =>
      // Keep a Windows drive letter ("C:") intact.
      i === 0 && /^[A-Za-z]:$/.test(segment)
        ? segment
        : encodeURIComponent(segment)
    )
    .join('/')
  return prefix + encoded
}
