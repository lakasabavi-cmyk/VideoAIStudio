import { FC, useEffect, useState } from 'react'
import type { SystemStats } from '@/types/ipc'

/**
 * Live machine monitor shown at the bottom of the Settings page:
 * CPU, RAM, GPU utilisation, VRAM and temperatures, refreshed
 * every 2 seconds while the page is open. Heavy jobs (Real-ESRGAN,
 * RIFE) push the GPU hard, so this sits where the user configures
 * them. In a plain browser (no Electron API) it shows a note
 * instead of numbers.
 */
export const SystemMonitor: FC = () => {
  const [stats, setStats] = useState<SystemStats | null>(null)
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.getSystemStats) {
      setUnavailable(true)
      return
    }
    let cancelled = false
    const poll = async () => {
      try {
        const next = await api.getSystemStats()
        if (!cancelled) setStats(next)
      } catch {
        if (!cancelled) setUnavailable(true)
      }
    }
    void poll()
    const timer = window.setInterval(poll, 2000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  const bar = (percent: number, hot = false) => (
    <div className="w-full bg-gray-800 rounded-full h-2">
      <div
        className={
          'h-2 rounded-full ' +
          (hot || percent >= 90
            ? 'bg-red-500'
            : percent >= 70
              ? 'bg-amber-500'
              : 'bg-indigo-600')
        }
        style={{ width: Math.max(0, Math.min(100, percent)) + '%' }}
      />
    </div>
  )

  const tempText = (celsius?: number) =>
    celsius === undefined ? 'n/a' : `${celsius}°C`

  return (
    <div className="bg-gray-900 rounded-lg p-6 border border-gray-800 space-y-4">
      <h2 className="text-xl font-bold text-white">System Monitor</h2>
      {unavailable ? (
        <p className="text-sm text-gray-500">
          Live stats are available in the desktop app.
        </p>
      ) : !stats ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <div className="space-y-4">
          <div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-300">CPU</span>
              <span className="text-gray-400">
                {stats.cpuPercent}% · Temp {tempText(stats.cpuTempC)}
              </span>
            </div>
            <div className="mt-1">{bar(stats.cpuPercent)}</div>
          </div>
          <div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-300">RAM</span>
              <span className="text-gray-400">
                {stats.ramUsedGB} / {stats.ramTotalGB} GB ({stats.ramPercent}%)
              </span>
            </div>
            <div className="mt-1">{bar(stats.ramPercent)}</div>
          </div>
          {stats.gpu ? (
            <>
              <div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-300">GPU — {stats.gpu.name}</span>
                  <span className="text-gray-400">
                    {stats.gpu.utilPercent}% · Temp {tempText(stats.gpu.tempC)}
                  </span>
                </div>
                <div className="mt-1">
                  {bar(stats.gpu.utilPercent, stats.gpu.tempC >= 85)}
                </div>
              </div>
              <div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-300">VRAM</span>
                  <span className="text-gray-400">
                    {Math.round(stats.gpu.vramUsedMB)} /{' '}
                    {Math.round(stats.gpu.vramTotalMB)} MB (
                    {stats.gpu.vramTotalMB > 0
                      ? Math.round(
                          (stats.gpu.vramUsedMB / stats.gpu.vramTotalMB) * 100
                        )
                      : 0}
                    %)
                  </span>
                </div>
                <div className="mt-1">
                  {bar(
                    stats.gpu.vramTotalMB > 0
                      ? (stats.gpu.vramUsedMB / stats.gpu.vramTotalMB) * 100
                      : 0
                  )}
                </div>
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-500">
              GPU stats unavailable (nvidia-smi not found — NVIDIA driver
              required).
            </p>
          )}
        </div>
      )}
    </div>
  )
}
