import { FC } from 'react'
import { Save } from 'lucide-react'
import { useProjectStore } from '@/stores/projectStore'

export const Settings: FC = () => {
  const { currentProject, updateProjectSettings } = useProjectStore()

  const handleSave = () => {
    alert('Settings saved!')
  }

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-4xl font-bold text-white mb-2">Settings</h1>
        <p className="text-gray-400">Configure your project preferences</p>
      </div>

      <div className="max-w-2xl space-y-6">
        <div className="bg-gray-900 rounded-lg p-6 border border-gray-800 space-y-4">
          <h2 className="text-xl font-bold text-white">Export Quality</h2>
          <div className="space-y-3">
            {['low', 'medium', 'high'].map((quality) => (
              <label key={quality} className="flex items-center gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="quality"
                  value={quality}
                  defaultChecked={quality === 'high'}
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
              <input type="checkbox" defaultChecked className="w-4 h-4" />
              <span className="text-gray-200">Remove Silence</span>
            </label>
            <div>
              <label className="text-gray-300 text-sm">Silence Threshold (dB)</label>
              <input
                type="range"
                min="-80"
                max="0"
                defaultValue="-40"
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
              className="text-gray-400 w-full"
            />
            <div>
              <label className="text-gray-300 text-sm">Volume</label>
              <input
                type="range"
                min="0"
                max="100"
                defaultValue="50"
                className="w-full mt-2"
              />
            </div>
          </div>
        </div>

        <button
          onClick={handleSave}
          className="w-full px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          <Save size={20} />
          Save Settings
        </button>
      </div>
    </div>
  )
}
