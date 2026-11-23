import {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  dialog,
  type MenuItemConstructorOptions,
} from 'electron'
import { isDev } from './utils'
import {
  registerMediaSchemePrivileges,
  registerMediaProtocol,
} from './mediaProtocol'
import { setupFFmpegWorkers } from '../../backend/workers/ffmpeg.worker'
import { LogService } from '../../backend/services/log.service'
import path from 'path'
// (no fileURLToPath shim: the main bundle is CommonJS — see
// build:electron in package.json — so __dirname is available
// natively; an import.meta.url shim breaks under CJS.)
import fs from 'fs'



let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      // The preload is a bundled CommonJS file; Electron's sandboxed
      // renderer loader will not execute it, which silently leaves
      // window.electronAPI undefined in the page. contextIsolation
      // stays on and nodeIntegration stays off, so the renderer
      // still has no direct Node access.
      sandbox: false,
    },
  })

  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`[preload] failed to load ${preloadPath}:`, error)
  })

  const startUrl = isDev
    ? 'http://localhost:5173'
    : `file://${path.join(__dirname, '../app/index.html')}`

  mainWindow.loadURL(startUrl)

  // DevTools is NOT opened automatically (it used to pop up on
  // every launch). Press F12 or Ctrl+Shift+I in the app window
  // when you need it.

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// Privileges for the media:// scheme must be registered before
// the app is ready; the handler itself is registered on ready.
registerMediaSchemePrivileges()

app.on('ready', () => {
  LogService.log(
    'app',
    `VideoAI Studio started (platform ${process.platform}, node ${process.versions.node})`
  )
  registerMediaProtocol()
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow()
  }
})

// Setup IPC workers
setupFFmpegWorkers()

// File dialog handler for video selection
ipcMain.handle('dialog:selectVideo', async () => {
  if (!mainWindow) {
    return { success: false, error: 'Main window not found' }
  }

  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Video File',
      filters: [
        {
          name: 'Video Files',
          extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'flv', 'wmv'],
        },
        {
          name: 'All Files',
          extensions: ['*'],
        },
      ],
      properties: ['openFile'],
    })

    if (result.canceled) {
      return { success: false, error: 'User canceled selection' }
    }

    const filePath = result.filePaths[0]
    
    // Get file size
    const stats = fs.statSync(filePath)
    const fileSize = stats.size

    return {
      success: true,
      data: {
        filePath,
        fileSize,
        fileName: path.basename(filePath),
      },
    }
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
    }
  }
})

// Multi-file picker for the timeline editor (videos or audio).
ipcMain.handle(
  'dialog:selectFiles',
  async (_, kind: 'video' | 'audio') => {
    if (!mainWindow) {
      return { success: false, error: 'Main window not found' }
    }
    try {
      const isVideo = kind === 'video'
      const result = await dialog.showOpenDialog(mainWindow, {
        title: isVideo ? 'Select Video Files' : 'Select Audio Files',
        filters: [
          isVideo
            ? {
                name: 'Video Files',
                extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'flv', 'wmv'],
              }
            : {
                name: 'Audio Files',
                extensions: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg'],
              },
          { name: 'All Files', extensions: ['*'] },
        ],
        properties: ['openFile', 'multiSelections'],
      })
      if (result.canceled) {
        return { success: false, error: 'User canceled selection' }
      }
      const files = result.filePaths.map((filePath) => ({
        filePath,
        fileName: path.basename(filePath),
        fileSize: fs.statSync(filePath).size,
      }))
      return { success: true, data: files }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  }
)

// Create menu
const template: MenuItemConstructorOptions[] = [
  {
    label: 'File',
    submenu: [
      {
        label: 'Exit',
        accelerator: 'CmdOrCtrl+Q',
        click: () => {
          app.quit()
        },
      },
    ],
  },
  {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
    ],
  },
  {
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
    ],
  },
]

Menu.setApplicationMenu(Menu.buildFromTemplate(template))
