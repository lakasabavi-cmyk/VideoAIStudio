import { useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { Dashboard } from './pages/Dashboard'
import { Import } from './pages/Import'
import { RenderQueue } from './pages/RenderQueue'
import { Settings } from './pages/Settings'
import { Transcript } from './pages/Transcript'

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard')

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard />
      case 'import':
        return <Import />
      case 'queue':
        return <RenderQueue />
      case 'settings':
        return <Settings />
      case 'transcript':
        return <Transcript />
      default:
        return <Dashboard />
    }
  }

  return (
    <div className="flex h-screen bg-dark text-light">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      <main className="flex-1 overflow-y-auto">
        {renderContent()}
      </main>
    </div>
  )
}
