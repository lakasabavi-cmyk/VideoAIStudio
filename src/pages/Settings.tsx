import { FC, useState } from 'react'
import { Save, Check } from 'lucide-react'
import { useSettingsStore } from '@/stores/settingsStore'
import { ESRGAN_MODEL_SCALES } from '@/lib/jobRunner'
import { LogViewer } from '@/components/LogViewer'
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
    esrgan4xModel: stored.esrgan4xModel ?? 'fast',
    esrganModel: stored.esrganModel ?? '',
    esrganCustomModel: stored.esrganCustomModel ?? '',
    esrganSharpen: stored.esrganSharpen ?? 'light',
    esrganTileSize: stored.esrganTileSize,
    esrganPath: stored.esrganPath,
    esrganModelsPath: stored.esrganModelsPath,
    rifeEnabled: stored.rifeEnabled,
    rifeMultiplier: stored.rifeMultiplier,
    rifePath: stored.rifePath,
    rifeModelPath: stored.rifeModelPath,
    whisperPythonPath: stored.whisperPythonPath ?? '',
    whisperModel: stored.whisperModel ?? 'medium',
    whisperLanguage: stored.whisperLanguage ?? 'vi',
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
          <div>
            <label className="text-gray-300 text-sm">Upscale</label>
            <div className="flex gap-2 mt-2">
              {(
                [
                  { value: 'none', label: 'None' },
                  { value: 'lanczos', label: 'Lanczos' },
                  { value: 'realesrgan', label: 'ESRGAN' },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  onClick={() =>
                    setDraft({ ...draft, upscaleMethod: option.value })
                  }
                  className={
                    'px-3 py-1.5 rounded-lg text-sm transition-colors ' +
                    (draft.upscaleMethod === option.value
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-800 text-gray-300 hover:bg-gray-700')
                  }
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-2">
              {draft.upscaleMethod === 'none'
                ? 'No resize — only RIFE and/or Sharpen run (pick at least one of the three).'
                : draft.upscaleMethod === 'lanczos'
                  ? 'Faithful resize, no AI invention — original → RIFE → Lanczos → sharpen.'
                  : 'AI upscale via the ncnn-vulkan executable (extract frames → upscale → rebuild).'}
            </p>
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

          {/* RIFE + Sharpen apply to both upscale methods (v0.4.2);
              the ESRGAN-only parts are gated below. */}
          <div className="space-y-4">
              <div className="space-y-4">
                <div>
                  <label className="text-gray-300 text-sm">
                    RIFE frame interpolation
                  </label>
                  <div className="flex gap-2 mt-2">
                    {([0, 2, 4] as const).map((mult) => (
                      <button
                        key={mult}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            rifeEnabled: mult !== 0,
                            rifeMultiplier: mult === 4 ? 4 : 2,
                          })
                        }
                        className={
                          'px-3 py-1.5 rounded-lg text-sm transition-colors ' +
                          ((mult === 0
                            ? !draft.rifeEnabled
                            : draft.rifeEnabled &&
                              draft.rifeMultiplier === mult)
                            ? 'bg-indigo-600 text-white'
                            : 'bg-gray-800 text-gray-300 hover:bg-gray-700')
                        }
                      >
                        {mult === 0 ? 'None' : `${mult}x fps`}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    Smoother motion — runs before the upscale, inside
                    the same job. A 24 fps clip becomes 48 fps at 2x;
                    the output name gets a _rife2x suffix.
                  </p>
                </div>
                {draft.rifeEnabled && (
                  <>
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
              {draft.upscaleMethod === 'realesrgan' && (
                <div className="space-y-4">
              <div className="border-t border-gray-800 pt-4">
                <label className="text-gray-300 text-sm">ESRGAN model</label>
                <select
                  value={draft.esrganModel}
                  onChange={(e) => {
                    const value = e.target.value
                    // A picked model fixes its own scale (25/11/2026:
                    // "2x" buttons + a 4x model silently ran 4x).
                    // Sync the stored scale so the buttons, the
                    // saved settings and the job all agree.
                    const native = ESRGAN_MODEL_SCALES[value]
                    setDraft({
                      ...draft,
                      esrganModel: value,
                      ...(native !== undefined
                        ? { esrganScale: native }
                        : {}),
                    })
                  }}
                  className="w-full mt-2 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm"
                >
                  <option value="">Auto — model follows the scale below</option>
                  <option value="realesr-animevideov3-x2">realesr-animevideov3-x2 · 2x · light video model (fast, can look plastic)</option>
                  <option value="realesr-animevideov3-x3">realesr-animevideov3-x3 · 3x · light video model (fast, can look plastic)</option>
                  <option value="realesr-animevideov3-x4">realesr-animevideov3-x4 · 4x · light video model (fast, can look plastic)</option>
                  <option value="realesrgan-x4plus">realesrgan-x4plus · 4x · photo model, most detail, slowest</option>
                  <option value="realesrgan-x4plus-anime">realesrgan-x4plus-anime · 4x · lighter photo model (drawn / AI content)</option>
                  <option value="realesrnet-x4plus">realesrnet-x4plus · 4x · photo model without GAN texture (smoother)</option>
                  <option value="custom">Custom — type any model name from the models folder</option>
                </select>
                {draft.esrganModel === 'custom' && (
                  <input
                    type="text"
                    value={draft.esrganCustomModel}
                    onChange={(e) =>
                      setDraft({ ...draft, esrganCustomModel: e.target.value })
                    }
                    placeholder="e.g. realesr-general-x4v3"
                    className="w-full mt-2 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm"
                  />
                )}
                <p className="text-xs text-gray-500 mt-2">
                  A picked model fixes its own scale. If the model file
                  is not in the models folder, the job stops right away
                  with a clear message instead of failing mid-run.
                </p>
                {draft.esrganModel !== '' &&
                  draft.esrganModel !== 'custom' && (
                    <p className="text-xs text-indigo-300 mt-2">
                      Scale: {ESRGAN_MODEL_SCALES[draft.esrganModel] ?? draft.esrganScale}x — fixed by the picked model.
                    </p>
                  )}
                {(draft.esrganModel === '' || draft.esrganModel === 'custom') && (
                  <>
                    <label className="block text-gray-300 text-sm mt-4">Scale</label>
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
                    {draft.esrganModel === '' && (
                      <p className="text-xs text-gray-500 mt-2">
                        Auto: 2x and 3x use realesr-animevideov3. Saved as
                        name_2x.mp4 / name_4x.mp4.
                      </p>
                    )}
                  </>
                )}
                {draft.esrganModel === '' && draft.esrganScale === 4 && (
                  <div className="mt-4">
                    <label className="text-gray-300 text-sm">4x model (Auto)</label>
                    <div className="flex gap-2 mt-2">
                      {(
                        [
                          { value: 'fast', label: 'Fast (video model)' },
                          { value: 'quality', label: 'Quality (photo model)' },
                        ] as const
                      ).map((option) => (
                        <button
                          key={option.value}
                          onClick={() =>
                            setDraft({ ...draft, esrgan4xModel: option.value })
                          }
                          className={
                            'px-3 py-1.5 rounded-lg text-sm transition-colors ' +
                            (draft.esrgan4xModel === option.value
                              ? 'bg-indigo-600 text-white'
                              : 'bg-gray-800 text-gray-300 hover:bg-gray-700')
                          }
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                      Fast uses realesr-animevideov3-x4 — the same light
                      model family as 2x/3x, several times quicker.
                      Quality uses realesrgan-x4plus — heavier photo
                      model, sharper on real photos but much slower.
                    </p>
                  </div>
                )}
              </div>
                </div>
              )}
              <div>
                <label className="text-gray-300 text-sm">
                  Sharpen after upscale
                </label>
                <div className="flex gap-2 mt-2">
                  {(
                    [
                      { value: 'off', label: 'None' },
                      { value: 'light', label: 'Light' },
                      { value: 'medium', label: 'Medium' },
                      { value: 'strong', label: 'Strong' },
                    ] as const
                  ).map((option) => (
                    <button
                      key={option.value}
                      onClick={() =>
                        setDraft({ ...draft, esrganSharpen: option.value })
                      }
                      className={
                        'px-3 py-1.5 rounded-lg text-sm transition-colors ' +
                        (draft.esrganSharpen === option.value
                          ? 'bg-indigo-600 text-white'
                          : 'bg-gray-800 text-gray-300 hover:bg-gray-700')
                      }
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  A sharpen pass while the frames are rebuilt into
                  video — it brings back edge detail the upscale
                  softened: the plastic look on ESRGAN, the softness
                  of a plain Lanczos resize. Light is a gentle
                  default; raise it only if the picture still looks
                  waxy.
                </p>
              </div>
              {draft.upscaleMethod === 'realesrgan' && (
                <div className="space-y-4">
              <div>
                <label className="text-gray-300 text-sm">
                  Tile size (memory control)
                </label>
                <div className="flex gap-2 mt-2">
                  {(
                    [
                      { value: 0, label: 'Auto' },
                      { value: 400, label: '400' },
                      { value: 256, label: '256' },
                      { value: 128, label: '128' },
                    ] as const
                  ).map((option) => (
                    <button
                      key={option.value}
                      onClick={() =>
                        setDraft({ ...draft, esrganTileSize: option.value })
                      }
                      className={
                        'px-3 py-1.5 rounded-lg text-sm transition-colors ' +
                        (draft.esrganTileSize === option.value
                          ? 'bg-indigo-600 text-white'
                          : 'bg-gray-800 text-gray-300 hover:bg-gray-700')
                      }
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Auto lets the tool use as much VRAM as it wants per tile.
                  If an upscale dies with out-of-memory on large frames,
                  pick 256 (or 128) — smaller tiles use much less memory,
                  at a small speed cost.
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
        </div>

        <div className="bg-gray-900 rounded-lg p-6 space-y-4">
          <h2 className="text-xl font-bold text-white">
            Transcript (faster-whisper)
          </h2>
          <p className="text-sm text-gray-400">
            Speech recognition for the Transcript Editor tab. One-time
            setup: run <code>tools\setup-whisper.bat</code> from the
            app folder, then paste the python.exe path it prints.
            The model downloads automatically on the first
            transcription (medium is about 1.5 GB). Prefer medium
            for singing: large-v3 is stronger on clean speech but
            hallucinates stock phrases over music and AI vocals.
          </p>
          <div>
            <label className="text-sm text-gray-300">
              faster-whisper python (python.exe)
              <input
                type="text"
                value={draft.whisperPythonPath}
                onChange={(e) =>
                  setDraft({ ...draft, whisperPythonPath: e.target.value })
                }
                placeholder="C:\\...\\VideoAIStudio\\tools\\whisper-env\\Scripts\\python.exe"
                className="w-full mt-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm"
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-gray-300">
                Model
                <select
                  value={draft.whisperModel}
                  onChange={(e) =>
                    setDraft({ ...draft, whisperModel: e.target.value })
                  }
                  className="w-full mt-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm"
                >
                  <option value="medium">medium (recommended — reliable on singing)</option>
                  <option value="large-v3">large-v3 (strong speech, hallucinates on singing)</option>
                  <option value="large-v3-turbo">large-v3-turbo (faster)</option>
                  <option value="small">small</option>
                  <option value="base">base</option>
                  <option value="tiny">tiny (test only)</option>
                </select>
              </label>
            </div>
            <div>
              <label className="text-sm text-gray-300">
                Language
                <select
                  value={draft.whisperLanguage}
                  onChange={(e) =>
                    setDraft({ ...draft, whisperLanguage: e.target.value })
                  }
                  className="w-full mt-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm"
                >
                  <option value="vi">Vietnamese</option>
                  <option value="auto">Auto-detect</option>
                  <option value="en">English</option>
                </select>
              </label>
            </div>
          </div>
        </div>

        <button
          onClick={handleSave}
          className="w-full px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          {saved ? <Check size={20} /> : <Save size={20} />}
          {saved ? 'Saved!' : 'Save Settings'}
        </button>

        <LogViewer />
      </div>
    </div>
  )
}
