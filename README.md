# VideoAIStudio v0.1

Professional video editing and AI processing studio built with Electron, React, TypeScript, and Vite.

## Features v0.1

- **Import Video Files** - Add video files to your project
- **Video Preview** - Preview and inspect video metadata
- **Remove Silence** - Remove silent parts from videos using FFmpeg
- **Add Background Music** - Add background music tracks to videos
- **Export MP4** - Export processed videos in various qualities

## Tech Stack

- **Frontend**: React 18 + TypeScript
- **Desktop**: Electron 27
- **Build Tool**: Vite 5
- **Styling**: Tailwind CSS
- **State Management**: Zustand
- **Icons**: Lucide React
- **Video Processing**: FFmpeg

## Project Structure

\\\
VideoAIStudio/
+-- src/                    # React app
¦   +-- components/        # Reusable components
¦   +-- pages/            # Page components
¦   +-- stores/           # Zustand stores
¦   +-- types/            # TypeScript types
¦   +-- App.tsx           # Main app component
¦   +-- main.tsx          # React entry point
+-- electron/             # Electron main process
¦   +-- main/            # Main process
¦   +-- preload/         # Preload scripts
+-- backend/             # Backend services
¦   +-- services/        # FFmpeg service
¦   +-- workers/         # IPC workers
+-- assets/              # Static assets
+-- projects/            # User projects
+-- vite.config.ts       # Vite configuration
+-- tsconfig.json        # TypeScript configuration
+-- package.json         # Project dependencies
\\\

## Installation

\\\ash
npm install
\\\

## Development

Start the development server:

\\\ash
npm run dev
\\\

This will start:
- Vite dev server on http://localhost:5173
- Electron app connected to the dev server

## Building

Build the application:

\\\ash
npm run build
\\\

Build only the app:
\\\ash
npm run build:app
\\\

Build only Electron:
\\\ash
npm run build:electron
\\\

## Available Scripts

- \
pm run dev\ - Start development server
- \
pm run vite\ - Start Vite dev server only
- \
pm run electron\ - Start Electron app
- \
pm run build\ - Build both app and Electron
- \
pm run build:app\ - Build Vite app
- \
pm run build:electron\ - Build Electron process
- \
pm run type-check\ - Check TypeScript types
- \
pm run lint\ - Run ESLint

## Planned Features

### v0.2
- Whisper integration for speech recognition
- Subtitle generation
- Advanced audio editing

### v0.3
- Remotion integration for animations
- AI voice synthesis
- Template system

### v0.4
- Collaboration features
- Cloud integration
- Plugin system

## Architecture

### Frontend (React + Vite)
- Component-based UI with React
- State management with Zustand
- Styling with Tailwind CSS
- Type-safe with TypeScript

### Desktop (Electron)
- Native desktop application
- Context isolation for security
- Main process handles IPC and backend operations

### Backend (Node.js)
- FFmpeg service for video processing
- IPC workers for async operations
- File system operations

## IPC Communication

The app uses Electron IPC for communication between renderer and main process:

`
Renderer (React)
    ? ipcRenderer.invoke
Main Process
    ?
Backend Service (FFmpeg)
    ? ipcRenderer.send
Renderer (React)
`

## Security

- Context isolation enabled
- Node integration disabled
- Preload script for safe IPC exposure

## Requirements

- Node.js >= 16.0.0
- FFmpeg (automatically installed via ffmpeg-static)

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
