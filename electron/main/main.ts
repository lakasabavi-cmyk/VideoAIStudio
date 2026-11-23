import {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  dialog,
  shell,
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



// GPU safe mode: Chromium's GPU process can crash-loop on
// laptop GPUs whose driver resets under load (exit 0xC0000409).
// Count GPU crashes per run; after two, arm a flag file so the
// NEXT launch disables hardware acceleration and starts clean
// in software rendering. The heavy GPU work in this app runs in
// external tools (Real-ESRGAN / RIFE), not in Chromium, so
// software rendering costs the UI almost nothing. Delete
// gpu-safemode.json in the userData folder to re-enable.
const gpuFlagPath = path.join(app.getPath('userData'), 'gpu-safemode.json')
try {
  const flag = JSON.parse(fs.readFileSync(gpuFlagPath, 'utf8'))
  if (flag && flag.disableHardwareAcceleration) {
    app.disableHardwareAcceleration()
    LogService.log(
      'gpu',
      'hardware acceleration OFF (safe mode armed by an earlier GPU crash)'
    )
  }
} catch {
  // no flag file yet — normal hardware-accelerated start
}
let gpuCrashCount = 0
app.on('child-process-gone', (_event, details) => {
  if (details.type !== 'GPU') return
  gpuCrashCount++
  LogService.log(
    'gpu',
    `GPU process gone: reason=${details.reason} exitCode=${details.exitCode} (crash ${gpuCrashCount} this run)`
  )
  if (gpuCrashCount >= 2) {
    try {
      fs.mkdirSync(path.dirname(gpuFlagPath), { recursive: true })
      fs.writeFileSync(
        gpuFlagPath,
        JSON.stringify({
          disableHardwareAcceleration: true,
          at: new Date().toISOString(),
        })
      )
      LogService.log(
        'gpu',
        'safe mode armed — hardware acceleration will be OFF from the next launch'
      )
    } catch {
      // best effort; the log line above already records the crash
    }
  }
})

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

ipcMain.handle('shell:openFolder', async (_, filePath: string) => {
  try {
    shell.showItemInFolder(filePath)
    return { success: true }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
})

// Delete a file for real — into the Recycle Bin, so a mistaken
// delete is recoverable from Windows Explorer.
ipcMain.handle('file:deleteFile', async (_, filePath: string) => {
  try {
    await shell.trashItem(filePath)
    LogService.log('file', `moved to recycle bin: ${filePath}`)
    return { success: true }
  } catch (error) {
    return { success: false, error: (error as Error).message }
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
