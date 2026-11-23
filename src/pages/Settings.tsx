import { FC, useState } from 'react'
import { Save, Check } from 'lucide-react'
import { useSettingsStore } from '@/stores/settingsStore'
import { SystemMonitor } from '@/components/SystemMonitor'
import type { ProjectSettings } from '@/types'

export const Settings: FC = () => {
  const stored = useSettingsStore()
  const [draft, setDraft] = useState<ProjectSettings>({
    removeSilence: stored.removeSilence,
    silenceThreshold: stored.silenceThreshold,
    backgroundMusic: stored.backgroundMusic,
    musicVolume: stored.musicVolume,
    originalVolume: stored.originalVolume,
    exportFormat: stored.exportFormat,
    exportQuality: stored.exportQuality,
    upscaleMethod: stored.upscaleMethod,
    lanczosTarget: stored.lanczosTarget,
    esrganScale: stored.esrganScale,
    esrganPath: stored.esrganPath,
    esrganModelsPath: stored.esrganModelsPath,
    rifeEnabled: stored.rifeEnabled,
    rifeMultiplier: stored.rifeMultiplier,
    rifePath: stored.rifePath,
    rifeModelPath: stored.rifeModelPath,
  })
  const [saved, setSaved] = useState(false)

  const handleSave = () => {
    // Committing to the persisted store is what makes the settings
    // survive an app restart; they reload automatically on launch.
    stored.updateSettings(draft)
    setSaved(true)
    window.setTimeout(() => setSaved(false), 2000)
  }

  const handleMusicFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    // In Electron the picked File carries its absolute filesystem
    // path; ffmpeg needs that path, not the file name.
    const filePath = (file as File & { path?: string }).path ?? file.name
    setDraft({ ...draft, backgroundMusic: filePath })
  }

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-4xl font-bold text-white mb-2">Settings</h1>
        <p className="text-gray-400">
          Configure processing preferences. Settings are saved on this
          device and reload automatically when the app starts.
        </p>
      </div>

      <div className="max-w-2xl space-y-6">
        <div className="bg-gray-900 rounded-lg p-6 border border-gray-800 space-y-4">
          <h2 className="text-xl font-bold text-white">Export Quality</h2>
          <div className="space-y-3">
            {(['low', 'medium', 'high'] as const).map((quality) => (
              <label key={quality} className="flex items-center gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="quality"
                  value={quality}
                  checked={draft.exportQuality === quality}
                  onChange={() => setDraft({ ...draft, exportQuality: quality })}
                  className="w-4 h-4"
                />
                <span className="text-gray-200 capitalize">{quality}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="bg-gray-900 rounded-lg p-6 border border-gray-800 space-y-4">
          <h2 className="text-xl font-bold text-white">Audio Settings</h2>
          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.removeSilence}
                onChange={(e) =>
                  setDraft({ ...draft, removeSilence: e.target.checked })
                }
                className="w-4 h-4"
              />
              <span className="text-gray-200">Remove Silence</span>
            </label>
            <div>
              <label className="text-gray-300 text-sm">
                Silence Threshold (dB): {draft.silenceThreshold}
              </label>
              <input
                type="range"
                min="-80"
                max="0"
                value={draft.silenceThreshold}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    silenceThreshold: parseInt(e.target.value, 10),
                  })
                }
                className="w-full mt-2"
              />
            </div>
            <div>
              <label className="text-gray-300 text-sm">
                Original Volume: {draft.originalVolume}%
              </label>
              <input
                type="range"
                min="0"
                max="100"
                value={draft.originalVolume}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    originalVolume: parseInt(e.target.value, 10),
                  })
                }
                className="w-full mt-2"
              />
              <p className="text-xs text-gray-500 mt-1">
                Volume of the video's own audio track. Used by the
                Adjust Volume job and by Add Music mixes — set it to
                0% to mute the original audio completely before
                adding new music.
              </p>
            </div>
          </div>
        </div>

        <div className="bg-gray-900 rounded-lg p-6 border border-gray-800 space-y-4">
          <h2 className="text-xl font-bold text-white">Background Music</h2>
          <div className="space-y-3">
            <input
              type="file"
              accept="audio/*"
              onChange={handleMusicFile}
              className="text-gray-400 w-full"
            />
            {draft.backgroundMusic && (
              <p className="text-sm text-gray-400 break-all">
                Selected: {draft.backgroundMusic}
              </p>
            )}
            <div>
              <label className="text-gray-300 text-sm">
                Volume: {draft.musicVolume}%
              </label>
              <input
                type="range"
                min="0"
                max="100"
                value={draft.musicVolume}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    musicVolume: parseInt(e.target.value, 10),
                  })
                }
                className="w-full mt-2"
              />
            </div>
          </div>
        </div>

        <div className="bg-gray-900 rounded-lg p-6 border border-gray-800 space-y-4">
          <h2 className="text-xl font-bold text-white">Upscale</h2>
          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="radio"
                name="upscaleMethod"
                checked={draft.upscaleMethod === 'lanczos'}
                onChange={() => setDraft({ ...draft, upscaleMethod: 'lanczos' })}
                className="w-4 h-4"
              />
              <span className="text-gray-200">
                Lanczos (quick) — resize in one ffmpeg pass
              </span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="radio"
                name="upscaleMethod"
                checked={draft.upscaleMethod === 'realesrgan'}
                onChange={() => setDraft({ ...draft, upscaleMethod: 'realesrgan' })}
                className="w-4 h-4"
              />
              <span className="text-gray-200">
                Real-ESRGAN — AI upscale via the ncnn-vulkan executable
                (extract frames → upscale → rebuild)
              </span>
            </label>
          </div>

          {draft.upscaleMethod === 'lanczos' && (
            <div>
              <label className="text-gray-300 text-sm">Target resolution</label>
              <div className="flex gap-2 mt-2">
                {(['1080p', '2k', '4k', '8k'] as const).map((target) => (
                  <button
                    key={target}
                    onClick={() => setDraft({ ...draft, lanczosTarget: target })}
                    className={
                      'px-3 py-1.5 rounded-lg text-sm transition-colors ' +
                      (draft.lanczosTarget === target
                        ? 'bg-indigo-600 text-white'
                        : 'bg-gray-800 text-gray-300 hover:bg-gray-700')
                    }
                  >
                    {target.toUpperCase()}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Output height 1080 / 1440 / 2160 / 4320 px, aspect ratio
                kept. Saved as name_1080p.mp4, name_2k.mp4, and so on.
              </p>
            </div>
          )}

          {draft.upscaleMethod === 'realesrgan' && (
            <div className="space-y-4">
              <div className="space-y-4">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.rifeEnabled}
                    onChange={(e) =>
                      setDraft({ ...draft, rifeEnabled: e.target.checked })
                    }
                    className="w-4 h-4"
                  />
                  <span className="text-gray-200">
                    RIFE frame interpolation (smoother motion, runs before
                    the upscale, inside the same job)
                  </span>
                </label>
                {draft.rifeEnabled && (
                  <>
                    <div>
                      <label className="text-gray-300 text-sm">
                        Frame-rate multiplier
                      </label>
                      <div className="flex gap-2 mt-2">
                        {([2, 4] as const).map((mult) => (
                          <button
                            key={mult}
                            onClick={() =>
                              setDraft({ ...draft, rifeMultiplier: mult })
                            }
                            className={
                              'px-3 py-1.5 rounded-lg text-sm transition-colors ' +
                              (draft.rifeMultiplier === mult
                                ? 'bg-indigo-600 text-white'
                                : 'bg-gray-800 text-gray-300 hover:bg-gray-700')
                            }
                          >
                            {mult}x fps
                          </button>
                        ))}
                      </div>
                      <p className="text-xs text-gray-500 mt-2">
                        A 24 fps clip becomes 48 fps at 2x. Saved as
                        name_4x_rife2x.mp4.
                      </p>
                    </div>
                    <div>
                      <label className="text-gray-300 text-sm">
                        RIFE executable (rife-ncnn-vulkan.exe)
                      </label>
                      <input
                        type="text"
                        value={draft.rifePath}
                        onChange={(e) =>
                          setDraft({ ...draft, rifePath: e.target.value })
                        }
                        placeholder="C:\\tools\\rife\\rife-ncnn-vulkan.exe"
                        className="w-full mt-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-gray-300 text-sm">
                        RIFE model folder (blank = "rife-v4.6" next to the
                        executable)
                      </label>
                      <input
                        type="text"
                        value={draft.rifeModelPath}
                        onChange={(e) =>
                          setDraft({ ...draft, rifeModelPath: e.target.value })
                        }
                        placeholder="C:\\tools\\rife\\rife-v4.6"
                        className="w-full mt-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm"
                      />
                    </div>
                  </>
                )}
              </div>
              <div className="border-t border-gray-800 pt-4">
                <label className="text-gray-300 text-sm">Scale / model</label>
                <div className="flex gap-2 mt-2">
                  {([2, 3, 4] as const).map((scale) => (
                    <button
                      key={scale}
                      onClick={() => setDraft({ ...draft, esrganScale: scale })}
                      className={
                        'px-3 py-1.5 rounded-lg text-sm transition-colors ' +
                        (draft.esrganScale === scale
                          ? 'bg-indigo-600 text-white'
                          : 'bg-gray-800 text-gray-300 hover:bg-gray-700')
                      }
                    >
                      {scale}x
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  2x and 3x use realesr-animevideov3 (video model), 4x uses
                  realesrgan-x4plus. Saved as name_2x.mp4 / name_4x.mp4.
                </p>
              </div>
              <div>
                <label className="text-gray-300 text-sm">
                  Real-ESRGAN executable (realesrgan-ncnn-vulkan.exe)
                </label>
                <input
                  type="text"
                  value={draft.esrganPath}
                  onChange={(e) =>
                    setDraft({ ...draft, esrganPath: e.target.value })
                  }
                  placeholder="C:\\tools\\realesrgan\\realesrgan-ncnn-vulkan.exe"
                  className="w-full mt-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm"
                />
              </div>
              <div>
                <label className="text-gray-300 text-sm">
                  Models folder (blank = "models" next to the executable)
                </label>
                <input
                  type="text"
                  value={draft.esrganModelsPath}
                  onChange={(e) =>
                    setDraft({ ...draft, esrganModelsPath: e.target.value })
                  }
                  placeholder="C:\\tools\\realesrgan\\models"
                  className="w-full mt-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm"
                />
              </div>


            </div>
          )}
        </div>

        <button
          onClick={handleSave}
          className="w-full px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          {saved ? <Check size={20} /> : <Save size={20} />}
          {saved ? 'Saved!' : 'Save Settings'}
        </button>

        <SystemMonitor />
      </div>
    </div>
  )
}
