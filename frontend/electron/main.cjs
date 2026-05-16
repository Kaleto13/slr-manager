const { app, BrowserWindow, shell, ipcMain } = require('electron')
const path = require('path')
const fs   = require('fs')
const { spawn } = require('child_process')


const BACKEND_PORT = 8000
const VITE_DEV_PORT = 5173
const isDev = !app.isPackaged


let configPath = null

function loadConfig() {
  try {
    if (configPath && fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'))
    }
  } catch (e) {
    console.error('[Config] Error leyendo config:', e.message)
  }
  return null
}

function buildDatabaseUrl(cfg) {
  const pass = encodeURIComponent(cfg.password || '')
  const user = encodeURIComponent(cfg.user     || 'postgres')
  const host = cfg.host   || 'localhost'
  const port = cfg.port   || '5432'
  const db   = cfg.dbname || 'slr_manager'
  return `postgresql://${user}:${pass}@${host}:${port}/${db}`
}


function getBackendPath() {
  if (isDev) {
    return path.join(__dirname, '..', '..', 'backend')
  }

  return path.join(process.resourcesPath, 'backend')
}


let backendProcess = null
let backendExited   = false
let backendExitCode = null
let backendLogPath  = null

function startBackend(databaseUrl) {

  backendExited   = false
  backendExitCode = null

  const backendCwd = getBackendPath()
  let command, args

  if (isDev) {
    command = 'python'
    args = ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(BACKEND_PORT), '--no-access-log']
  } else {
    command = path.join(backendCwd, 'backend.exe')
    args = []
  }

  console.log(`[Electron] Iniciando backend: ${command}`)

  const userDataDir = app.getPath('userData')
  backendLogPath    = path.join(userDataDir, 'backend.log')
  const logPath     = backendLogPath

 
  fs.mkdirSync(userDataDir, { recursive: true })

  const env = {
    ...process.env,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
    SLR_USER_DATA: userDataDir,   // cwd escribible para data/PDFs etc.
  }
  if (databaseUrl) env.DATABASE_URL = databaseUrl

  // Escribir stdout/stderr al log y a la consola de Electron
  const logStream = fs.createWriteStream(logPath, { flags: 'w' })
  logStream.on('error', (e) => console.error('[LogStream] Error escribiendo log:', e.message))

  const exeExists = !isDev && fs.existsSync(command)
  logStream.write(
    `[start] ${new Date().toISOString()}\n` +
    `[start] command = ${command}\n` +
    `[start] cwd     = ${backendCwd}\n` +
    `[start] exe?    = ${isDev ? 'dev-mode' : String(exeExists)}\n` +
    `[start] userData= ${userDataDir}\n`
  )

  if (!isDev && !exeExists) {
    const msg = `ERROR: backend.exe no encontrado en ${command}`
    console.error(`[Electron] ${msg}`)
    logStream.write(`[error] ${msg}\n`)
    logStream.end()
    return
  }

  backendProcess = spawn(command, args, {
    cwd: backendCwd,
    env,
    windowsHide: true,
  })

  backendProcess.on('error', (err) => {
    const msg = `spawn error: ${err.code} – ${err.message}`
    console.error(`[backend] ${msg}`)
    logStream.write(`[error] ${msg}\n`)
    logStream.end()
  })

  backendProcess.stdout.on('data', (d) => {
    const msg = d.toString().trim()
    console.log(`[backend] ${msg}`)
    logStream.write(`[out] ${msg}\n`)
  })
  backendProcess.stderr.on('data', (d) => {
    const msg = d.toString().trim()
    console.error(`[backend] ${msg}`)
    logStream.write(`[err] ${msg}\n`)
  })
  backendProcess.on('exit', (code) => {
    backendExited   = true
    backendExitCode = code
    const msg = `proceso terminó con código ${code}`
    console.log(`[backend] ${msg}`)
    logStream.write(`[exit] ${msg}\n`)
    logStream.end()
  })
}

function stopBackend() {
  if (backendProcess) {
    backendProcess.kill()
    backendProcess = null
  }

  backendExited   = false
  backendExitCode = null
}


function waitForBackend(retries = 60, interval = 1000) {
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

      if (backendExited) {
        return reject(new Error(`Backend terminó inesperadamente (código: ${backendExitCode ?? 'desconocido'}). Ver log para detalles.`))
      }
      attempts++
      if (attempts >= retries) return reject(new Error('Backend no respondió a tiempo'))
      setTimeout(check, interval)
    }

    check()
  })
}


let setupWindow = null

function showSetupWindow() {
  return new Promise((resolve) => {
    setupWindow = new BrowserWindow({
      width: 480,
      height: 560,
      resizable: false,
      title: 'SLR Manager - Configuracion',
      backgroundColor: '#0f172a',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'setup-preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    setupWindow.loadFile(path.join(__dirname, 'setup.html'))


    ipcMain.handleOnce('setup:save-config', async (_event, cfg) => {
      // 1. Conectar a PostgreSQL y crear la base de datos si no existe
      const { Client } = require('pg')
      const client = new Client({
        host:                    cfg.host     || 'localhost',
        port:                    parseInt(cfg.port || '5432'),
        user:                    cfg.user     || 'postgres',
        password:                cfg.password,
        database:                'postgres',   
        connectionTimeoutMillis: 5000,
      })

      try {
        await client.connect()
      } catch (e) {
        throw new Error('No se pudo conectar a PostgreSQL: ' + e.message)
      }

      try {
        const dbName = (cfg.dbname || 'slr_manager').replace(/[^a-zA-Z0-9_]/g, '_')
        const res = await client.query(
          'SELECT 1 FROM pg_database WHERE datname = $1',
          [dbName]
        )
        if (res.rowCount === 0) {
          await client.query(`CREATE DATABASE "${dbName}"`)
        }
      } finally {
        await client.end().catch(() => {})
      }

      // 2. Guardar archivo de configuración
      try {
        fs.mkdirSync(path.dirname(configPath), { recursive: true })
        fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2))
        console.log('[Config] Guardado en:', configPath)
      } catch (e) {
        throw new Error('No se pudo guardar la configuracion: ' + e.message)
      }

      // 3. Cerrar ventana y resolver la promesa externa (showSetupWindow)
      setTimeout(() => {
        if (setupWindow && !setupWindow.isDestroyed()) setupWindow.close()
        setupWindow = null
        resolve(cfg)
      }, 800)
    })

    setupWindow.on('closed', () => {
      setupWindow = null
      resolve(null)
    })
  })
}


let mainWindow = null

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'SLR Manager',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false, 
    backgroundColor: '#0f172a',
  })

 
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url)
    return { action: 'deny' }
  })


  mainWindow.once('ready-to-show', () => mainWindow.show())

  if (isDev) {
    mainWindow.loadURL(`http://localhost:${VITE_DEV_PORT}`)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}


app.whenReady().then(async () => {

  configPath = path.join(app.getPath('userData'), 'db-config.json')

  let cfg = loadConfig()

  if (!isDev && !cfg) {
    cfg = await showSetupWindow()
  }

  const databaseUrl = cfg ? buildDatabaseUrl(cfg) : null


  startBackend(databaseUrl)
  await createWindow()

  waitForBackend(30, 1000).catch(async (err) => {
    console.error('[Electron] Backend no disponible:', err.message)
    const logPath = backendLogPath || path.join(app.getPath('userData'), 'backend.log')
    let logContent = ''
    try { logContent = fs.readFileSync(logPath, 'utf8').slice(-2000) } catch (_) {}

    try { if (configPath) fs.unlinkSync(configPath) } catch (_) {}

    const { dialog } = require('electron')
    const { response } = await dialog.showMessageBox({
      type: 'error',
      title: 'Error al iniciar el backend',
      message: 'No se pudo conectar al servidor interno.',
      detail:
        'Posibles causas:\n' +
        '\u2022 PostgreSQL no está corriendo\n' +
        '\u2022 Credenciales incorrectas\n' +
        '\u2022 Puerto 5432 bloqueado\n\n' +
        `Log: ${logPath}\n\n${logContent.slice(-600) || '(sin output)'}`,
      buttons: ['Reconfigurar y reiniciar', 'Cerrar'],
      defaultId: 0,
    })

    if (response === 0) app.relaunch()
    app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopBackend()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => stopBackend())

ipcMain.handle('is-electron', () => true)
ipcMain.handle('get-backend-url', () => `http://127.0.0.1:${BACKEND_PORT}`)
ipcMain.handle('reconfigure-db', () => {
  try { if (configPath) fs.unlinkSync(configPath) } catch (_) {}
  app.relaunch()
  app.quit()
})

ipcMain.handle('get-log-path', () => backendLogPath || path.join(app.getPath('userData'), 'backend.log'))

ipcMain.handle('setup:check-postgres', () => {
  return new Promise((resolve) => {
    const net = require('net')
    const socket = net.createConnection({ port: 5432, host: 'localhost' })
    socket.setTimeout(3000)
    socket.once('connect',  () => { socket.destroy(); resolve({ found: true  }) })
    socket.once('error',    ()  => resolve({ found: false }))
    socket.once('timeout',  () => { socket.destroy(); resolve({ found: false }) })
  })
})
