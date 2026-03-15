import { app, BrowserWindow } from 'electron'
import path from 'path'
import { registerStorageHandlers } from './ipc/storage'
import { registerAuthHandlers } from './ipc/auth'
import { registerAgentHandlers } from './ipc/agent'
import { registerKeychainHandlers } from './ipc/keychain'

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 480,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
    titleBarStyle: 'hiddenInset',
    show: false,
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  // In dev, load from Vite dev server; in prod, load built files
  const isDev = !app.isPackaged
  if (isDev) {
    const devUrl = 'http://localhost:5173'
    const loadDevServer = async () => {
      for (let i = 0; i < 30; i++) {
        try {
          await mainWindow!.loadURL(devUrl)
          return
        } catch {
          await new Promise((r) => setTimeout(r, 1000))
        }
      }
      console.error('Failed to connect to Vite dev server at', devUrl)
      app.quit()
    }
    loadDevServer()
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Register IPC handlers
  registerStorageHandlers()
  registerAuthHandlers()
  registerAgentHandlers(mainWindow)
  registerKeychainHandlers()
}

app.whenReady().then(createWindow)

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
