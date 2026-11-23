import {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  dialog,
  type MenuItemConstructorOptions,
} from 'electron'
import { isDev } from './utils'
import { setupFFmpegWorkers } from '../../backend/workers/ffmpeg.worker'
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
    },
  })

  const startUrl = isDev
    ? 'http://localhost:5173'
    : `file://${path.join(__dirname, '../app/index.html')}`

  mainWindow.loadURL(startUrl)

  if (isDev) {
    mainWindow.webContents.openDevTools()
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.on('ready', createWindow)

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
