import { FC, useState } from 'react'
import { Save, Check } from 'lucide-react'
import { useSettingsStore } from '@/stores/settingsStore'
import type { ProjectSettings } from '@/types'

export const Settings: FC = () => {
  const stored = useSettingsStore()
  const [draft, setDraft] = useState<ProjectSettings>({
    removeSilence: stored.removeSilence,
    silenceThreshold: stored.silenceThreshold,
    backgroundMusic: stored.backgroundMusic,
    musicVolume: stored.musicVolume,
    exportFormat: stored.exportFormat,
    exportQuality: stored.exportQuality,
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

        <button
          onClick={handleSave}
          className="w-full px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          {saved ? <Check size={20} /> : <Save size={20} />}
          {saved ? 'Saved!' : 'Save Settings'}
        </button>
      </div>
    </div>
  )
}
