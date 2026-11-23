import os from 'os'
import { execFile } from 'child_process'
import type { SystemStats } from '@/types/ipc'

/**
 * Live machine stats for the Settings page monitor: CPU load,
 * RAM, and — via nvidia-smi — GPU utilisation, VRAM and GPU
 * temperature. CPU temperature is best-effort: Windows exposes
 * it only through the WMI thermal-zone class, which many
 * machines do not populate; it is polled at most every 15s and
 * simply stays undefined when unavailable.
 */
export class SystemService {
  private static lastCpu: { idle: number; total: number } | null = null
  private static cpuTempCache: { at: number; value?: number } | null = null

  private static cpuSnapshot(): { idle: number; total: number } {
    let idle = 0
    let total = 0
    for (const cpu of os.cpus()) {
      const times = cpu.times as unknown as Record<string, number>
      for (const key of Object.keys(times)) total += times[key]
      idle += cpu.times.idle
    }
    return { idle, total }
  }

  private static cpuPercent(): number {
    const snap = SystemService.cpuSnapshot()
    const prev = SystemService.lastCpu
    SystemService.lastCpu = snap
    if (!prev) return 0
    const dTotal = snap.total - prev.total
    const dIdle = snap.idle - prev.idle
    if (dTotal <= 0) return 0
    return Math.max(0, Math.min(100, Math.round((1 - dIdle / dTotal) * 100)))
  }

  private static queryGpu(): Promise<SystemStats['gpu']> {
    return new Promise((resolve) => {
      execFile(
        'nvidia-smi',
        [
          '--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu',
          '--format=csv,noheader,nounits',
        ],
        { timeout: 4000, windowsHide: true },
        (error, stdout) => {
          if (error || !stdout) {
            resolve(undefined)
            return
          }
          const first = stdout.trim().split('\n')[0] ?? ''
          const parts = first.split(',').map((p) => p.trim())
          if (parts.length < 5) {
            resolve(undefined)
            return
          }
          const [name, util, used, totalMB, temp] = parts
          resolve({
            name,
            utilPercent: Number(util) || 0,
            vramUsedMB: Number(used) || 0,
            vramTotalMB: Number(totalMB) || 0,
            tempC: Number(temp) || 0,
          })
        }
      )
    })
  }

  private static queryCpuTemp(): Promise<number | undefined> {
    const cache = SystemService.cpuTempCache
    if (cache && Date.now() - cache.at < 15000) {
      return Promise.resolve(cache.value)
    }
    if (process.platform !== 'win32') {
      SystemService.cpuTempCache = { at: Date.now(), value: undefined }
      return Promise.resolve(undefined)
    }
    return new Promise((resolve) => {
      execFile(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          '(Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue | Select-Object -First 1).CurrentTemperature',
        ],
        { timeout: 5000, windowsHide: true },
        (error, stdout) => {
          let value: number | undefined
          if (!error && stdout) {
            // WMI reports tenths of a degree Kelvin.
            const raw = parseFloat(stdout.trim())
            if (Number.isFinite(raw) && raw > 0) {
              value = Math.round((raw / 10 - 273.15) * 10) / 10
            }
          }
          SystemService.cpuTempCache = { at: Date.now(), value }
          resolve(value)
        }
      )
    })
  }

  static async getStats(): Promise<SystemStats> {
    const totalMem = os.totalmem()
    const freeMem = os.freemem()
    const usedMem = totalMem - freeMem
    const [gpu, cpuTempC] = await Promise.all([
      SystemService.queryGpu(),
      SystemService.queryCpuTemp(),
    ])
    return {
      cpuPercent: SystemService.cpuPercent(),
      ramUsedGB: Math.round((usedMem / 1073741824) * 10) / 10,
      ramTotalGB: Math.round((totalMem / 1073741824) * 10) / 10,
      ramPercent: Math.round((usedMem / totalMem) * 100),
      gpu,
      cpuTempC,
    }
  }
}
