/**
 * Small path helpers for the renderer, which has no access to
 * Node's path module. They handle both Windows and POSIX separators.
 */

/** "C:\v\clip.mp4" + ".nosil" -> "C:\v\clip.nosil.mp4" */
/**
 * Make a user-typed project name safe as a single folder name
 * (Windows + POSIX): strip path separators and illegal chars.
 */
export function sanitizeFolderName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
}

/**
 * Output path inside a project folder sitting next to the
 * source file: <dir>/<project>/<file><suffix>.mp4 — one folder
 * per project so renders do not pile up in a single directory.
 */
export function projectOutputPath(
  filePath: string,
  projectName: string,
  suffix: string
): string {
  const sep = filePath.includes('\\') ? '\\' : '/'
  const parts = filePath.split(sep)
  const file = parts.pop() ?? filePath
  const dot = file.lastIndexOf('.')
  const stamped =
    dot > 0
      ? `${file.slice(0, dot)}${suffix}${file.slice(dot)}`
      : `${file}${suffix}.mp4`
  return [...parts, projectName, stamped].join(sep)
}

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
/**
 * Where a video's extracted last frame goes:
 * "C:\\v\\clip.mp4" -> "C:\\v\\first frame\\clip_lastframe.png".
 * The frame lands in a "first frame" folder next to the video,
 * ready to be used as the first frame of the next generated clip.
 */
/** Folder a split job writes its parts into: "<name>_parts" next to the video. */
export function partsDirPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const slash = normalized.lastIndexOf('/')
  const dir = slash >= 0 ? normalized.slice(0, slash) : '.'
  const base = (slash >= 0 ? normalized.slice(slash + 1) : normalized).replace(
    /\.[^.]+$/,
    ''
  )
  const sep = filePath.includes('\\') ? '\\' : '/'
  return dir.split('/').join(sep) + sep + base + '_parts'
}

export function lastFramePath(filePath: string): string {
  const sep = filePath.includes('\\') ? '\\' : '/'
  const parts = filePath.split(sep)
  const file = parts.pop() ?? filePath
  const dot = file.lastIndexOf('.')
  const base = dot > 0 ? file.slice(0, dot) : file
  return [...parts, 'first frame', `${base}_lastframe.png`].join(sep)
}

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
