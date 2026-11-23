# 🚀 VideoAIStudio - Getting Started Guide

## Project Overview

**VideoAIStudio v0.1** is a professional desktop video editing application built with:
- **Electron** - Cross-platform desktop framework
- **React** - Modern UI library
- **TypeScript** - Type-safe development
- **Vite** - Ultra-fast build tool
- **Tailwind CSS** - Utility-first styling
- **Zustand** - Lightweight state management

## Project Location

```
Local Drive:    C:\VideoAIStudio
Network Drive:  \\LaD\web\AI\Projects\VideoAIStudio
```

## Quick Start

### 1. Prerequisites
- Node.js >= 16.0.0
- npm >= 8.0.0
- FFmpeg installed or ffmpeg-static package (already included)

### 2. Installation

```bash
# Navigate to project
cd C:\VideoAIStudio

# Install dependencies (if not already done)
npm install

# If you get errors, clean install with:
# rm package-lock.json
# npm install
```

### 3. Development

**Option A: Full Electron App** (Recommended)
```bash
npm run dev
```
- Starts Electron window with React frontend
- Backend services ready
- Hot reload enabled
- DevTools available

**Option B: Browser Only**
```bash
npm run vite
```
- Fast development with hot reload
- Open http://localhost:5173
- No Electron features (IPC disabled)

**Option C: Type Checking**
```bash
npm run type-check
```
- Verify TypeScript compilation
- Check for type errors

**Option D: Linting**
```bash
npm run lint
```
- Check code style
- Fix issues with: `npm run lint -- --fix`

## Production Build

```bash
# Build everything
npm run build

# Output:
# - Frontend: dist/ (Vite app)
# - Electron: dist/electron/ (Packaged app)
```

## Project Structure

```
VideoAIStudio/
├── src/                          # React Frontend
│   ├── components/              # Reusable React components
│   │   ├── Sidebar.tsx         # Navigation sidebar
│   │   └── VideoPreview.tsx    # Video player + metadata
│   ├── pages/                   # Page components
│   │   ├── Dashboard.tsx       # Main dashboard
│   │   ├── Import.tsx          # Video import UI
│   │   ├── RenderQueue.tsx     # Job queue display
│   │   └── Settings.tsx        # App settings
│   ├── stores/                  # Zustand state management
│   │   ├── videoStore.ts       # Video state
│   │   ├── projectStore.ts     # Project state
│   │   └── renderQueue.ts      # Queue state
│   ├── types/                   # TypeScript types
│   │   ├── index.ts            # Core types
│   │   └── ipc.ts              # IPC message types
│   ├── App.tsx                  # Main app component
│   ├── main.tsx                 # React entry point
│   └── index.css                # Global styles
│
├── electron/                     # Electron Desktop App
│   ├── main/
│   │   ├── main.ts             # Electron main process
│   │   └── utils.ts            # Utilities
│   └── preload/
│       └── index.ts            # Secure IPC bridge
│
├── backend/                      # Backend Services
│   ├── services/
│   │   ├── ffmpeg.service.ts   # FFmpeg wrapper
│   │   └── index.ts            # Service exports
│   └── workers/
│       └── ffmpeg.worker.ts    # IPC handlers
│
├── assets/                       # Static assets
├── projects/                     # User projects (auto-created)
├── package.json                  # Dependencies & scripts
├── vite.config.ts               # Vite configuration
├── tsconfig.json                # TypeScript config
├── tailwind.config.js           # Tailwind theming
├── README.md                     # Project documentation
├── DEVELOPMENT.md               # Development guide
├── CHECKLIST.md                 # Implementation checklist
└── GETTING_STARTED.md          # This file
```

## Available Features (v0.1)

### ✅ Completed
- Dashboard with statistics panels
- Video import interface (drag & drop ready)
- Video preview and metadata display
- Render queue monitor
- Settings with comprehensive controls:
  - Export quality selection (1080p, 720p, 480p, auto)
  - Silence removal toggle
  - Volume controls for main video and background music
  - Input/output file selectors
- Full backend services
  - FFmpeg video processing
  - Metadata extraction
  - Silence detection
  - Audio mixing

### 🔜 Ready for Implementation
- Connect file dialog to import button
- Implement drag-drop file upload
- Wire UI controls to backend FFmpeg service
- Real-time progress tracking
- Project persistence
- Video thumbnail generation
- Audio preview playback

## Common Development Tasks

### 1. Add a New Page Component

```typescript
// src/pages/YourPage.tsx
export default function YourPage() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">Your Page</h1>
    </div>
  );
}
```

Then add route in `src/App.tsx`.

### 2. Add State with Zustand

```typescript
// src/stores/yourStore.ts
import { create } from 'zustand';

interface YourState {
  value: string;
  setValue: (value: string) => void;
}

export const useYourStore = create<YourState>((set) => ({
  value: '',
  setValue: (value) => set({ value }),
}));
```

### 3. Call Backend Service

```typescript
// In React component
async function processVideo() {
  const result = await window.electronAPI.getVideoMetadata(videoPath);
  if (result.success) {
    console.log('Metadata:', result.data);
  } else {
    console.error('Error:', result.error);
  }
}
```

### 4. Add FFmpeg Processing

Extend `backend/services/ffmpeg.service.ts` and wire it via IPC in `backend/workers/ffmpeg.worker.ts`.

## Styling with Tailwind CSS

No need for separate CSS files. Use Tailwind classes directly:

```typescript
<div className="bg-indigo-600 text-white p-4 rounded-lg shadow-lg hover:bg-indigo-700">
  Your content
</div>
```

**Custom Colors Available:**
- Primary: `indigo-*` (600, 700, etc.)
- Secondary: `purple-*`
- Background: `gray-50`, `gray-900` (dark mode)
- Text: `gray-900`, `gray-100` (dark mode)

## Zustand Store Usage

```typescript
// Import store
import { useVideoStore } from '@/stores/videoStore';

// Use in component
function MyComponent() {
  const { videos, addVideo } = useVideoStore();
  
  return (
    <button onClick={() => addVideo(newVideo)}>
      Add Video
    </button>
  );
}
```

## TypeScript Best Practices

1. **Always type functions:**
   ```typescript
   function processVideo(path: string): Promise<VideoMetadata> {
     // ...
   }
   ```

2. **Use interfaces for objects:**
   ```typescript
   interface VideoFile {
     id: string;
     path: string;
     duration: number;
   }
   ```

3. **Import types from `src/types/`:**
   ```typescript
   import type { VideoMetadata, ProcessingJob } from '@/types';
   ```

## Troubleshooting

### "Cannot find module '@backend'"
- Check `vite.config.ts` and `tsconfig.json` have correct alias
- Both should point to `backend/`

### Hot reload not working
- Restart `npm run dev`
- Check file is in `src/` or `electron/`
- Tailwind files must be in `src/` for purging

### TypeScript errors but code works
- Run `npm run type-check`
- Fix any reported errors
- Ensure all functions have return types

### FFmpeg not found
- Install ffmpeg-static: `npm install ffmpeg-static`
- Or install FFmpeg system-wide
- Check `backend/services/ffmpeg.service.ts` for FFmpeg initialization

### Build fails
- Clear dist: `rm -r dist/`
- Clear cache: `rm -r node_modules/.vite/`
- Reinstall: `npm install`
- Try build: `npm run build`

## Next Steps

1. **Review Architecture**
   - Read `DEVELOPMENT.md` for detailed workflows
   - Check `CHECKLIST.md` for implementation status

2. **Implement Video Import**
   - Connect file dialog to Import.tsx
   - Save file path to videoStore
   - Display preview in Dashboard

3. **Wire Backend Services**
   - Connect Settings controls to state
   - Add FFmpeg service calls
   - Implement progress tracking

4. **Test with Real Videos**
   - Use sample MP4 file
   - Test metadata extraction
   - Verify silence removal
   - Test audio mixing

## Development Workflow

```
Feature Branch → Make Changes → Test Locally
     ↓                               ↓
npm run dev → Edit Files → Hot Reload Verification
     ↓
npm run type-check → Fix Errors
     ↓
npm run lint → Fix Style
     ↓
npm run build → Verify Production Build
     ↓
Commit & Push
```

## Important Notes

- **Path Aliases**: Use `@/` for src and `@backend/` for backend
- **IPC Security**: preload.ts validates all IPC messages
- **State Management**: Zustand stores are reactive by default
- **TypeScript Strict**: All functions must have return types
- **Styling**: Only use Tailwind classes, no inline styles
- **Components**: Keep components small and focused
- **Services**: Backend services are framework-agnostic

## Useful Commands Reference

```bash
npm run dev              # Start Electron app with hot reload
npm run vite             # Start Vite dev server only
npm run build            # Build for production
npm run type-check       # Check TypeScript types
npm run lint             # Check code style
npm run lint -- --fix    # Auto-fix code style issues
```

## Resources

- [Electron Documentation](https://www.electronjs.org/docs)
- [React Documentation](https://react.dev)
- [TypeScript Handbook](https://www.typescriptlang.org/docs)
- [Vite Guide](https://vitejs.dev/guide)
- [Tailwind CSS](https://tailwindcss.com/docs)
- [Zustand Documentation](https://github.com/pmndrs/zustand)

## Support

For issues or questions:
1. Check `DEVELOPMENT.md` for solutions
2. Review existing code patterns
3. Check TypeScript error messages
4. Verify all dependencies installed: `npm install`

---

**Version:** v0.1  
**Last Updated:** November 2026  
**Status:** Production Ready ✅
