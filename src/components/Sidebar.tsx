import { FC } from 'react'
import { Home, FileVideo, Settings, BarChart3 } from 'lucide-react'

interface SidebarProps {
  activeTab: string
  setActiveTab: (tab: string) => void
}

export const Sidebar: FC<SidebarProps> = ({ activeTab, setActiveTab }) => {
  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: Home },
    { id: 'import', label: 'Import', icon: FileVideo },
    { id: 'queue', label: 'Render Queue', icon: BarChart3 },
    { id: 'settings', label: 'Settings', icon: Settings },
  ]

  return (
    <aside className="w-64 bg-gray-900 border-r border-gray-800 h-full overflow-y-auto">
      <div className="p-6">
        <h1 className="text-2xl font-bold text-indigo-500">VideoAI</h1>
        <p className="text-sm text-gray-400">Studio v0.1</p>
      </div>

      <nav className="space-y-2 px-4">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                isActive
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-white'
              }`}
            >
              <Icon size={20} />
              <span className="font-medium">{tab.label}</span>
            </button>
          )
        })}
      </nav>
    </aside>
  )
}
