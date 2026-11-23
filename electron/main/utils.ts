import { app } from 'electron'

// Packaged build = production. The old check treated "no NODE_ENV"
// as dev, so a real production build still pointed at localhost:5173
// and opened DevTools. app.isPackaged is the canonical Electron test.
export const isDev = !app.isPackaged
