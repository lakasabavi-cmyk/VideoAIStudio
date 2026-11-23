import { FC, useEffect, useState } from 'react'
import type { SystemStats } from '@/types/ipc'

/**
 * Compact live machine monitor pinned to the bottom of the
 * sidebar, visible from every tab: CPU, RAM, GPU utilisation,
 * VRAM and temperatures, refreshed every 2 seconds. Heavy jobs
 * (Real-ESRGAN, RIFE) push the GPU hard for a long time, so the
 * load and the temperature stay in sight while they run.
 * In a plain browser (no Electron API) it shows a short note.
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
    <div className="w-full bg-gray-800 rounded-full h-1">
      <div
        className={
          'h-1 rounded-full ' +
          (hot || percent >= 90
            ? 'bg-red-500'
            : percent >= 70
              ? 'bg-amber-500'
              : 'bg-indigo-500')
        }
        style={{ width: Math.max(0, Math.min(100, percent)) + '%' }}
      />
    </div>
  )

  const row = (label: string, value: string, percent: number, hot = false) => (
    <div>
      <div className="flex justify-between items-baseline text-[11px] leading-tight">
        <span className="text-gray-400">{label}</span>
        <span className="text-gray-300 tabular-nums">{value}</span>
      </div>
      <div className="mt-1">{bar(percent, hot)}</div>
    </div>
  )

  return (
    <div className="px-4 py-4 border-t border-gray-800 space-y-2.5">
      <p className="text-[10px] font-semibold tracking-widest text-gray-500 uppercase">
        System
      </p>
      {unavailable ? (
        <p className="text-[11px] text-gray-500">
          Live stats are available in the desktop app.
        </p>
      ) : !stats ? (
        <p className="text-[11px] text-gray-500">Loading…</p>
      ) : (
        <>
          {row(
            'CPU',
            `${stats.cpuPercent}%` +
              (stats.cpuTempC !== undefined ? ` · ${stats.cpuTempC}°C` : ''),
            stats.cpuPercent
          )}
          {row(
            'RAM',
            `${stats.ramUsedGB}/${stats.ramTotalGB} GB`,
            stats.ramPercent
          )}
          {stats.gpu ? (
            <>
              {row(
                'GPU',
                `${stats.gpu.utilPercent}% · ${stats.gpu.tempC}°C`,
                stats.gpu.utilPercent,
                stats.gpu.tempC >= 85
              )}
              {row(
                'VRAM',
                `${(stats.gpu.vramUsedMB / 1024).toFixed(1)}/${(stats.gpu.vramTotalMB / 1024).toFixed(1)} GB`,
                stats.gpu.vramTotalMB > 0
                  ? (stats.gpu.vramUsedMB / stats.gpu.vramTotalMB) * 100
                  : 0
              )}
              <p className="text-[10px] text-gray-600 truncate">
                {stats.gpu.name}
              </p>
            </>
          ) : (
            <p className="text-[11px] text-gray-500">
              GPU stats unavailable (nvidia-smi not found).
            </p>
          )}
        </>
      )}
    </div>
  )
}
