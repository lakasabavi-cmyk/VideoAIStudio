import { app } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'

/**
 * Append-only app log on disk (one file per day, in the app's
 * userData folder under "logs"). Every line is written with a
 * synchronous append, so the log survives even a hard machine
 * shutdown — after a crash the last lines show exactly what the
 * app was doing, plus the system stats it sampled along the way.
 * Logging never throws: a failed log write must not break a job.
 */
export class LogService {
  private static currentFile: string | null = null

  private static ensureFile(): string {
    const today = new Date().toISOString().slice(0, 10)
    if (LogService.currentFile?.endsWith(`videoai-${today}.log`)) {
      return LogService.currentFile
    }
    let base = process.env.VIDEOAI_LOG_DIR
    if (!base) {
      try {
        base = path.join(app.getPath('userData'), 'logs')
      } catch {
        base = path.join(os.tmpdir(), 'videoai-logs')
      }
    }
    fs.mkdirSync(base, { recursive: true })
    LogService.currentFile = path.join(base, `videoai-${today}.log`)
    return LogService.currentFile
  }

  static log(scope: string, message: string): void {
    try {
      const line = `[${new Date().toISOString()}] [${scope}] ${message}\n`
      fs.appendFileSync(LogService.ensureFile(), line, 'utf8')
    } catch {
      // Never break the app over a log line.
    }
  }

  static getFilePath(): string {
    return LogService.ensureFile()
  }

  /** Last N lines of today's log (empty string when there is none). */
  static readTail(maxLines = 300): string {
    try {
      const content = fs.readFileSync(LogService.ensureFile(), 'utf8')
      const lines = content.split('\n')
      return lines.slice(-maxLines).join('\n')
    } catch {
      return ''
    }
  }
}
