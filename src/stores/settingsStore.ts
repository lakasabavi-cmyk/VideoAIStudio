import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ProjectSettings } from '@/types'

/**
 * App-wide processing settings, persisted to localStorage so they
 * survive restarts ("save and reload"). The Settings page edits a
 * draft and commits it here; the job runner reads from here.
 *
 * musicVolume is stored as a percentage (0-100), matching the UI
 * slider; the runner converts it to the 0-1 range ffmpeg expects.
 */
interface SettingsState extends ProjectSettings {
  updateSettings: (partial: Partial<ProjectSettings>) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      removeSilence: true,
      silenceThreshold: -40,
      backgroundMusic: undefined,
      musicVolume: 50,
      originalVolume: 100,
      exportFormat: 'mp4',
      exportQuality: 'high',
      upscaleMethod: 'lanczos',
      lanczosTarget: '1080p',
      esrganScale: 4,
      esrgan4xModel: 'fast',
      esrganTileSize: 0,
      esrganPath: '',
      esrganModelsPath: '',
      rifeEnabled: false,
      rifeMultiplier: 2,
      rifePath: '',
      rifeModelPath: '',
      updateSettings: (partial) => set(partial),
    }),
    {
      name: 'videoai-settings',
      partialize: ({
        removeSilence,
        silenceThreshold,
        backgroundMusic,
        musicVolume,
        originalVolume,
        exportFormat,
        exportQuality,
        upscaleMethod,
        lanczosTarget,
        esrganScale,
        esrgan4xModel,
        esrganTileSize,
        esrganPath,
        esrganModelsPath,
        rifeEnabled,
        rifeMultiplier,
        rifePath,
        rifeModelPath,
      }) => ({
        removeSilence,
        silenceThreshold,
        backgroundMusic,
        musicVolume,
        originalVolume,
        exportFormat,
        exportQuality,
        upscaleMethod,
        lanczosTarget,
        esrganScale,
        esrgan4xModel,
        esrganTileSize,
        esrganPath,
        esrganModelsPath,
        rifeEnabled,
        rifeMultiplier,
        rifePath,
        rifeModelPath,
      }),
    }
  )
)
