# Development Guide - VideoAIStudio

## Quick Start

### Prerequisites
- Node.js >= 16.0.0
- npm >= 8.0.0

### Setup

1. Clone or navigate to the project:
\\\ash
cd C:\VideoAIStudio
\\\

2. Install dependencies:
\\\ash
npm install
\\\

### Running Development

#### Option 1: Full Dev Environment (Recommended)
\\\ash
npm run dev
\\\
This starts:
- Vite dev server on http://localhost:5173
- Electron app connected to dev server with hot reload

#### Option 2: Vite Only (Frontend Development)
\\\ash
npm run vite
\\\
Then open http://localhost:5173 in your browser

#### Option 3: Check Build
\\\ash
npm run build
\\\

## Project Structure

### Frontend (src/)
- **components/** - Reusable React components
  - \Sidebar.tsx\ - Navigation sidebar
  - \VideoPreview.tsx\ - Video player and metadata display

- **pages/** - Page components
  - \Dashboard.tsx\ - Main dashboard with stats
  - \Import.tsx\ - Video import interface
  - \RenderQueue.tsx\ - Render queue monitor
  - \Settings.tsx\ - App settings

- **stores/** - Zustand state management
  - \ideoStore.ts\ - Video file management
  - \projectStore.ts\ - Project management
  - \enderQueue.ts\ - Render queue state

- **types/** - TypeScript type definitions
  - \index.ts\ - Core types
  - \ipc.ts\ - IPC message types

- **utils/** - Utility functions

### Electron (electron/)
- **main/** - Main process
  - \main.ts\ - App initialization, window creation
  - \utils.ts\ - Helper functions

- **preload/** - Preload scripts
  - \index.ts\ - Secure IPC bridge

### Backend (backend/)
- **services/** - Service implementations
  - \fmpeg.service.ts\ - FFmpeg wrapper for video processing

- **workers/** - IPC handlers
  - \fmpeg.worker.ts\ - IPC message handlers

## Development Workflow

### Adding a New Component

1. Create component file in \src/components/\:
\\\	sx
// src/components/MyComponent.tsx
import { FC } from 'react'

interface MyComponentProps {
  // Define props
}

export const MyComponent: FC<MyComponentProps> = (props) => {
  return <div>Component content</div>
}
\\\

2. Import and use in pages or other components:
\\\	sx
import { MyComponent } from '@/components/MyComponent'
\\\

### Adding a New Store

1. Create store in \src/stores/\:
\\\	sx
// src/stores/myStore.ts
import { create } from 'zustand'

interface MyState {
  value: string
  setValue: (value: string) => void
}

export const useMyStore = create<MyState>((set) => ({
  value: '',
  setValue: (value) =>
    set({
      value,
    }),
}))
\\\

2. Use in components:
\\\	sx
import { useMyStore } from '@/stores/myStore'

function MyComponent() {
  const { value, setValue } = useMyStore()
  // ...
}
\\\

### Adding a New Backend Service

1. Create service in \ackend/services/\:
\\\	sx
// backend/services/myService.ts
export class MyService {
  static async doSomething() {
    // Service implementation
  }
}
\\\

2. Create IPC handler in \ackend/workers/\:
\\\	sx
// In backend/workers/myWorker.ts
ipcMain.handle('my:action', async (_, data) => {
  try {
    const result = await MyService.doSomething()
    return { success: true, data: result }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
})
\\\

3. Call from frontend:
\\\	sx
// In React component
const result = await window.electronAPI.myAction(data)
\\\

## Styling

The project uses **Tailwind CSS** for styling. All styles are defined using Tailwind utility classes.

### Color Scheme
- Primary: Indigo (\g-indigo-600\)
- Secondary: Purple (\g-purple-600\)
- Dark: \g-dark\ (gray-950)
- Light: \g-light\ (gray-50)

### Adding Custom Styles

Edit \	ailwind.config.js\:
\\\js
export default {
  theme: {
    extend: {
      colors: {
        // Add custom colors
      },
    },
  },
}
\\\

## Debugging

### React Components
- Use React DevTools browser extension
- Vite dev server includes source maps

### Electron
- Main process logs appear in console
- Renderer process can use browser DevTools (automatically opened in dev)

### IPC Communication
- Add console logs in both main and renderer processes
- Check \electron/main/main.ts\ for IPC handler registration

## Building

### Development Build
\\\ash
npm run build
\\\
Outputs:
- App: \dist/app/\
- Electron: \dist/electron/main.js\

### Production Build
Modify package.json scripts if needed for production optimization.

## Troubleshooting

### Vite Server Not Starting
- Check if port 5173 is in use
- Try: \
pm run vite -- --port 5174\

### Electron Not Connecting to Dev Server
- Ensure Vite server is running first
- Check firewall settings
- Verify \http://localhost:5173\ is accessible

### Build Errors
- Clear node_modules and reinstall: \m -r node_modules && npm install\
- Clear dist folder: \m -r dist\
- Run \
pm run build\ again

## Next Steps

1. Implement video import functionality using Electron file dialog
2. Add video metadata reading with FFmpeg
3. Create render queue system
4. Add background music selection UI
5. Test video processing with actual files

## Resources

- [Electron Documentation](https://www.electronjs.org/docs)
- [React Documentation](https://react.dev)
- [Vite Documentation](https://vitejs.dev)
- [Tailwind CSS](https://tailwindcss.com)
- [Zustand](https://github.com/pmndrs/zustand)
- [FFmpeg.js](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg)
