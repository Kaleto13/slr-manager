const { app, BrowserWindow, shell, ipcMain } = require('electron')
const path = require('path')
const { spawn } = require('child_process')

// ──────────────────────────────────────────────
// Configuración
// ──────────────────────────────────────────────
const BACKEND_PORT = 8000
const VITE_DEV_PORT = 5173
const isDev = !app.isPackaged

// Ruta al ejecutable del backend
// En producción, electron-builder copia la carpeta backend/ junto al ejecutable
function getBackendPath() {
  if (isDev) {
    return path.join(__dirname, '..', '..', 'backend')
  }
  // En producción, los recursos extras van a resources/backend/
  return path.join(process.resourcesPath, 'backend')
}

// ──────────────────────────────────────────────
// Proceso del backend
// ──────────────────────────────────────────────
let backendProcess = null

function startBackend() {
  const backendDir = getBackendPath()
  const pythonExe = isDev ? 'python' : path.join(process.resourcesPath, 'backend', 'venv', 'Scripts', 'python.exe')

  console.log(`[Electron] Iniciando backend en: ${backendDir}`)

  backendProcess = spawn(
    pythonExe,
    ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(BACKEND_PORT), '--no-access-log'],
    {
      cwd: backendDir,
      // Heredar las variables de entorno del sistema (incluye PATH, .env se carga en config.py)
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      // En Windows evitar mostrar ventana de consola
      windowsHide: true,
    }
  )

  backendProcess.stdout.on('data', (data) => console.log(`[backend] ${data.toString().trim()}`))
  backendProcess.stderr.on('data', (data) => console.error(`[backend] ${data.toString().trim()}`))
  backendProcess.on('exit', (code) => console.log(`[backend] proceso terminó con código ${code}`))
}

function stopBackend() {
  if (backendProcess) {
    backendProcess.kill()
    backendProcess = null
  }
}

// ──────────────────────────────────────────────
// Esperar a que el backend esté listo
// ──────────────────────────────────────────────
function waitForBackend(retries = 30, interval = 500) {
  return new Promise((resolve, reject) => {
    const http = require('http')
    let attempts = 0

    const check = () => {
      const req = http.get(`http://127.0.0.1:${BACKEND_PORT}/health`, (res) => {
        if (res.statusCode === 200) return resolve()
        retry()
      })
      req.on('error', retry)
      req.setTimeout(300, () => { req.destroy(); retry() })
    }

    const retry = () => {
      attempts++
      if (attempts >= retries) return reject(new Error('Backend no respondió a tiempo'))
      setTimeout(check, interval)
    }

    check()
  })
}

// ──────────────────────────────────────────────
// Ventana principal
// ──────────────────────────────────────────────
let mainWindow = null

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'SLR Manager',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false, // mostrar cuando esté listo
    backgroundColor: '#0f172a',
  })

  // Abrir links externos en el navegador del sistema, no en Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url)
    return { action: 'deny' }
  })

  // Mostrar la ventana una vez cargada para evitar el flash blanco
  mainWindow.once('ready-to-show', () => mainWindow.show())

  if (isDev) {
    // En dev se usa el servidor de Vite
    mainWindow.loadURL(`http://localhost:${VITE_DEV_PORT}`)
    mainWindow.webContents.openDevTools()
  } else {
    // En producción se carga el build estático
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

// ──────────────────────────────────────────────
// Ciclo de vida de la app
// ──────────────────────────────────────────────
app.whenReady().then(async () => {
  startBackend()

  try {
    // Esperar a que FastAPI arranque antes de mostrar la UI
    await waitForBackend()
  } catch (err) {
    console.error('[Electron] Backend no disponible:', err.message)
    // Continuar de todos modos; el frontend mostrará el error de conexión
  }

  await createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopBackend()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => stopBackend())

// IPC: permitir que el renderer sepa si está en Electron
ipcMain.handle('is-electron', () => true)
ipcMain.handle('get-backend-url', () => `http://127.0.0.1:${BACKEND_PORT}`)
