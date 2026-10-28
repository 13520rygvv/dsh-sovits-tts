/**
 * Host half of the so-vits-svc speech bundle.
 *
 * The Web UI cannot run the synthesis engine, so this package owns one Python
 * worker process (`worker.py`, venv under the worker directory) and answers the
 * Client half over an exact Connection Fetch route. The route is same-origin and
 * carrier-authenticated, which is why the Client half can `fetch()` it directly.
 *
 * Two things are worth knowing about the split:
 *
 * - The answer text is read from the session log through `sessionQuery`, not
 *   from the browser. The Client half only says *which* message to read, so a
 *   long answer never has to be re-uploaded (and a rendered message cannot
 *   disagree with what gets spoken).
 * - The worker is detached on purpose: it holds a loaded checkpoint and the
 *   HuBERT model, so keeping it alive across app restarts makes the first click
 *   fast instead of a ten-second wait. `action: 'shutdown'` stops it.
 */
import { spawn } from 'node:child_process'
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { request as httpRequest } from 'node:http'

/** Exact Fetch route the Client half posts to; the carrier authenticates it. */
const ROUTE = '/api/dsh-sovits'

/** This package's directory. Not the worker directory: that is configurable. */
const packageDir = dirname(fileURLToPath(import.meta.url))

/** Where the user-level settings document lives (survives restarts). */
const SETTINGS_FILE = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'sovits-tts', 'settings.json')

/** Where the client half reports failures it cannot show any other way. */
const CLIENT_ERROR_FILE = join(dirname(SETTINGS_FILE), 'client-errors.log')

/** Hard dependency: the authenticated Fetch-route registry and its carrier. */
export const inject = ['connection']

/**
 * Default worker dir: the `engine/` folder shipped next to this bundle, falling
 * back to the author's own install when the folder is not there.
 */
const DEFAULT_WORKER_DIR = existsSync(join(packageDir, 'engine'))
  ? join(packageDir, 'engine')
  : 'E:\\TOOL\\AI\\sovits-tts'

/** Worker defaults; every field can be overridden from the bundle config. */
const DEFAULTS = {
  /** Directory holding worker.py, engine.py and the venv. */
  workerDir: DEFAULT_WORKER_DIR,
  /** Python interpreter; empty means `<workerDir>\\venv\\Scripts\\python.exe`. */
  pythonPath: '',
  /** Loopback port the worker listens on. */
  port: 8765,
  /** Start the worker on demand instead of requiring it to run already. */
  autoStart: true,
  /** Answers longer than this many characters are cut before synthesis. */
  maxChars: 1200,
  /** Pitch shift in semitones applied to every request unless one is given. */
  pitch: 0,
  /** Speaking-rate percentage handed to the source TTS (-50..100). */
  rate: 0,
  /** Playback volume percentage used by the browser (0..100; the worker ignores it). */
  volume: 100,
  /** Voice used when a request does not name one. Empty means the first one. */
  voice: 'yuuka',
  /** Source TTS voice used for the speech that gets converted. Empty means the default. */
  sourceVoice: '',
}

/** How long a cold start may take before the request fails loudly. */
const BOOT_TIMEOUT_MS = 120_000

/** A health probe must answer within this window to count as alive. */
const PROBE_TIMEOUT_MS = 1500

/** One synthesis at a time is enough; the worker serializes internally too. */
let queue = Promise.resolve()

/**
 * Coerce a settings object into the supported shape with validated ranges.
 * @param input - bundle config, stored document, or a user patch.
 * @returns a complete, validated settings object.
 */
function sanitize(input) {
  const out = { ...DEFAULTS }
  if (input !== null && typeof input === 'object') {
    for (const [key, value] of Object.entries(input)) {
      if (!(key in out) || value === undefined || value === null) continue
      out[key] = value
    }
  }
  const number = (value, min, max, fallback) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback
  }
  out.pitch = number(out.pitch, -24, 24, DEFAULTS.pitch)
  out.rate = number(out.rate, -50, 100, DEFAULTS.rate)
  out.volume = number(out.volume, 0, 100, DEFAULTS.volume)
  out.maxChars = number(out.maxChars, 0, 5000, DEFAULTS.maxChars)
  out.port = number(out.port, 1024, 65535, DEFAULTS.port)
  out.workerDir = String(out.workerDir ?? DEFAULTS.workerDir).trim() || DEFAULTS.workerDir
  out.pythonPath = String(out.pythonPath ?? '').trim()
  out.voice = String(out.voice ?? '').trim()
  out.sourceVoice = String(out.sourceVoice ?? '').trim()
  out.autoStart = out.autoStart !== false
  return out
}

/**
 * Read the persisted user settings, ignoring anything unreadable.
 * @returns stored keys, or an empty object.
 */
function readSettingsFile() {
  try {
    const parsed = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * Persist the user settings document.
 * @param value - complete settings object.
 * @returns whether the file was written.
 */
function writeSettingsFile(value) {
  try {
    mkdirSync(dirname(SETTINGS_FILE), { recursive: true })
    writeFileSync(SETTINGS_FILE, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    return true
  } catch {
    return false
  }
}

/**
 * Append one client-side failure report to the diagnostics log.
 *
 * The renderer console only exists inside DevTools, so a client half that fails
 * during boot would otherwise leave no trace at all. Reporting is best effort:
 * it must never fail the caller.
 * @param body - reported payload.
 */
function appendClientError(body) {
  try {
    mkdirSync(dirname(CLIENT_ERROR_FILE), { recursive: true })
    const record = {
      time: new Date().toISOString(),
      where: String(body.where ?? ''),
      message: String(body.message ?? ''),
      stack: String(body.stack ?? ''),
      href: String(body.href ?? ''),
    }
    appendFileSync(CLIENT_ERROR_FILE, `${JSON.stringify(record)}\n`, 'utf8')
  } catch {
    // Diagnostics are best effort.
  }
}

/**
 * Merge bundle config over the defaults, then the stored user settings on top.
 * @param config - value from the bundle patch.
 * @returns effective settings.
 */
function settings(config) {
  return sanitize({ ...DEFAULTS, ...(config ?? {}), ...readSettingsFile() })
}

/**
 * Resolve the interpreter that runs the worker.
 *
 * The windowed build (`pythonw.exe`) is preferred over `python.exe`: the console
 * build allocates a console for the child process, which flashes a black window
 * on every cold start. Both run the same interpreter, and the worker already
 * logs to its own file, so it loses nothing without standard streams.
 * @param cfg - effective settings.
 * @returns absolute path to a python executable.
 */
function pythonExecutable(cfg) {
  const explicit = typeof cfg.pythonPath === 'string' ? cfg.pythonPath.trim() : ''
  const base = explicit === '' ? join(cfg.workerDir, 'venv', 'Scripts', 'python.exe') : explicit
  const windowed = base.replace(/python\.exe$/i, 'pythonw.exe')
  if (windowed !== base && existsSync(windowed)) return windowed
  return base
}

/**
 * Send one HTTP request to the worker and buffer its whole answer.
 * @param cfg - effective settings (port is used).
 * @param path - request path.
 * @param options - method, JSON body, and timeout.
 * @returns status, headers and body bytes.
 */
function requestWorker(cfg, path, options = {}) {
  const method = options.method ?? 'GET'
  const timeout = options.timeout ?? 120_000
  const payload = options.body === undefined || options.body === null
    ? null
    : Buffer.from(JSON.stringify(options.body), 'utf8')
  return new Promise((resolve, reject) => {
    const headers = payload === null
      ? {}
      : { 'content-type': 'application/json; charset=utf-8', 'content-length': payload.length }
    const req = httpRequest({ host: '127.0.0.1', port: cfg.port, path, method, headers }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => resolve({
        status: res.statusCode ?? 500,
        headers: res.headers,
        body: Buffer.concat(chunks),
      }))
      res.on('error', reject)
    })
    req.setTimeout(timeout, () => {
      req.destroy(new Error(`speech worker did not answer within ${String(Math.round(timeout / 1000))}s`))
    })
    req.on('error', reject)
    if (payload !== null) req.write(payload)
    req.end()
  })
}

/**
 * Read the worker's health document, or nothing when it is not listening.
 * @param cfg - effective settings.
 * @returns parsed health JSON, or null.
 */
async function probe(cfg) {
  try {
    const answer = await requestWorker(cfg, '/health', { timeout: PROBE_TIMEOUT_MS })
    if (answer.status !== 200) return null
    return JSON.parse(answer.body.toString('utf8'))
  } catch {
    return null
  }
}

/** Cold-start attempt shared by every caller that arrives while it runs. */
let booting = null

/**
 * Start the detached worker and wait until it reports health.
 * @param cfg - effective settings.
 * @returns the first health document.
 */
function boot(cfg) {
  if (booting !== null) return booting
  booting = (async () => {
    const running = await probe(cfg)
    if (running !== null) return running
    const python = pythonExecutable(cfg)
    const script = join(cfg.workerDir, 'worker.py')
    if (!existsSync(python)) throw new Error(`python for the speech worker is missing: ${python}`)
    if (!existsSync(script)) throw new Error(`speech worker script is missing: ${script}`)
    // The worker's output goes to a file it inherits as an open descriptor; a
    // WriteStream is rejected by `spawn` because its descriptor is not open yet.
    const logPath = join(cfg.workerDir, 'worker.host.log')
    const logFd = openSync(logPath, 'a')
    let child
    try {
      child = spawn(python, ['-u', 'worker.py', '--port', String(cfg.port)], {
        cwd: cfg.workerDir,
        detached: true,
        windowsHide: true,
        stdio: ['ignore', logFd, logFd],
      })
    } finally {
      closeSync(logFd)
    }
    let spawnError = null
    child.once('error', (error) => { spawnError = error })
    child.unref()
    const deadline = Date.now() + BOOT_TIMEOUT_MS
    while (Date.now() < deadline) {
      await new Promise((done) => setTimeout(done, 400))
      if (spawnError !== null) throw new Error(`cannot start the speech worker: ${spawnError.message}`)
      const health = await probe(cfg)
      if (health !== null) return health
    }
    throw new Error(`the speech worker did not become ready; see ${logPath}`)
  })().finally(() => {
    booting = null
  })
  return booting
}

/**
 * Health for the UI, optionally starting the worker on the way.
 * @param cfg - effective settings.
 * @param start - true to start a worker that is not running.
 * @returns the payload the Client half renders.
 */
async function health(cfg, start) {
  const live = await probe(cfg)
  if (live !== null) return { ok: true, running: true, ...live, pending: booting !== null }
  if (start !== true || cfg.autoStart !== true) {
    return { ok: true, running: false, ready: false, voices: [], error: 'speech worker is not running' }
  }
  void boot(cfg).catch(() => { /* the next poll reports the reason */ })
  return { ok: true, running: false, ready: false, voices: [], pending: true }
}

/**
 * Pull the answer text of one assistant message out of the session log.
 *
 * `readSurface` is tried first because it only carries the events still on the
 * model surface, which is far cheaper than the full log of a long session. The
 * requested message is preferred; when it is gone (for example a truncated
 * session) the last assistant message is used instead.
 * @param ctx - Host context carrying `sessionQuery`.
 * @param sessionId - session owning the message.
 * @param messageId - message the user clicked.
 * @returns plain text of that answer.
 */
async function answerText(ctx, sessionId, messageId) {
  const query = ctx.get('sessionQuery')
  if (query === undefined) throw new Error('sessionQuery is unavailable, so the answer cannot be read')
  let events = []
  try {
    const surface = await query.readSurface(sessionId)
    events = Array.isArray(surface?.events) ? surface.events : []
  } catch {
    events = []
  }
  if (events.length === 0) {
    const snapshot = await query.readSession(sessionId)
    events = Array.isArray(snapshot?.events) ? snapshot.events : []
  }
  const messages = events.filter((event) => event?.data?.message !== undefined && event.data.message !== null)
  if (messages.length === 0) throw new Error('that answer is no longer in the session log')
  let chosen
  if (messageId === undefined || messageId === null || String(messageId) === '') {
    const assistant = messages.filter((event) => event?.data?.message?.role === 'assistant')
    chosen = assistant[assistant.length - 1] ?? messages[messages.length - 1]
  } else {
    chosen = messages.find((event) => String(event.data.message.id) === String(messageId))
    // A click on a message that has left the surface must not silently read a
    // different answer, so a given id has to resolve.
    if (chosen === undefined) throw new Error('that answer is no longer in the session log')
  }
  const text = textOf(chosen)
  if (text === '') throw new Error('that answer has no readable text')
  return text
}

/**
 * Join the speakable text of one message event.
 *
 * Only `text` content blocks are used: reasoning and tool-call blocks are not
 * something a voice should read out. The streamed chunks are the fallback for
 * an event whose content was projected away.
 * @param event - session event carrying `data.message`.
 * @returns joined text, possibly empty.
 */
function textOf(event) {
  const message = event?.data?.message ?? {}
  const blocks = Array.isArray(message.content) ? message.content : []
  const direct = blocks
    .filter((block) => block !== null && typeof block === 'object' && block.type === 'text')
    .map((block) => String(block.text ?? ''))
    .join('\n')
    .trim()
  if (direct !== '') return direct
  const stream = Array.isArray(event?.data?.stream) ? event.data.stream : []
  const chunks = stream
    .filter((record) => record !== null && typeof record === 'object' && record.type === 'text-chunks')
    .flatMap((record) => (Array.isArray(record.texts) ? record.texts.map(String) : []))
  if (chunks.length > 0) return chunks.join('').trim()
  return typeof message.text === 'string' ? message.text.trim() : ''
}

/**
 * Cut a long answer at the configured budget without splitting a code point.
 * @param text - full answer.
 * @param max - character budget.
 * @returns the text to synthesize and whether it was cut.
 */
function clamp(text, max) {
  const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : 0
  if (limit === 0) return { text, truncated: false }
  const points = Array.from(text)
  if (points.length <= limit) return { text, truncated: false }
  return { text: points.slice(0, limit).join(''), truncated: true }
}

/**
 * Ask the worker to exit and wait until its port is free.
 * @param cfg - effective settings.
 * @returns nothing; a worker that never answered is treated as already stopped.
 */
async function stopWorker(cfg) {
  try {
    await requestWorker(cfg, '/shutdown', { method: 'POST', body: {}, timeout: 2000 })
  } catch {
    return
  }
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (await probe(cfg) === null) return
    await new Promise((done) => setTimeout(done, 150))
  }
}

/**
 * Answer one request on the Fetch route.
 * @param ctx - Host context.
 * @param state - mutable holder of the effective settings.
 * @param request - authenticated POST whose JSON body carries `action`.
 * @returns JSON or `audio/wav`.
 */
async function answer(ctx, state, request) {
  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ ok: false, error: 'request body is not JSON' }, { status: 400 })
  }
  if (body === null || typeof body !== 'object') {
    return Response.json({ ok: false, error: 'request body must be an object' }, { status: 400 })
  }
  const action = typeof body.action === 'string' ? body.action : 'speak'

  if (action === 'client-error') {
    appendClientError(body)
    return Response.json({ ok: true })
  }

  if (action === 'health') {
    const live = await health(state.cfg, body.start === true)
    return Response.json({ ...live, settings: state.cfg })
  }

  if (action === 'settings-set') {
    const patch = body.patch
    if (patch === null || typeof patch !== 'object') {
      return Response.json({ ok: false, error: 'patch must be an object' }, { status: 400 })
    }
    const previous = state.cfg
    const next = sanitize({ ...previous, ...patch })
    // A worker reached over a different address cannot be reused, so retire the
    // old one before the new address becomes effective.
    const moved = previous.port !== next.port
      || previous.workerDir !== next.workerDir
      || previous.pythonPath !== next.pythonPath
    if (moved) await stopWorker(previous)
    state.cfg = next
    const persisted = writeSettingsFile(next)
    return Response.json({ ok: true, settings: next, persisted, moved })
  }

  if (action === 'restart') {
    await stopWorker(state.cfg)
    try {
      await boot(state.cfg)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return Response.json({ ok: false, error: message }, { status: 503 })
    }
    return Response.json({ ...(await health(state.cfg, false)), settings: state.cfg })
  }

  if (action === 'shutdown') {
    await stopWorker(state.cfg)
    return Response.json({ ok: true, running: false })
  }

  if (action !== 'speak') return Response.json({ ok: false, error: `unknown action ${JSON.stringify(action)}` }, { status: 400 })

  let text = typeof body.text === 'string' ? body.text : ''
  if (text.trim() === '') {
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    if (sessionId === '') return Response.json({ ok: false, error: 'sessionId is required' }, { status: 400 })
    try {
      text = await answerText(ctx, sessionId, body.messageId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return Response.json({ ok: false, error: message }, { status: 409 })
    }
  }

  const cfg = state.cfg
  const cut = clamp(text, cfg.maxChars)
  if (await probe(cfg) === null && cfg.autoStart !== true) {
    return Response.json({ ok: false, error: 'speech worker is not running' }, { status: 503 })
  }
  let spoken
  try {
    await boot(cfg)
    const pick = (value, fallback) => (typeof value === 'string' && value !== '' ? value : fallback)
    const numberOr = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback)
    const run = () => requestWorker(cfg, '/speak', {
      method: 'POST',
      body: {
        text: cut.text,
        voice: pick(body.voice, cfg.voice) || undefined,
        pitch: numberOr(body.pitch, cfg.pitch),
        rate: numberOr(body.rate, cfg.rate),
        sourceVoice: pick(body.sourceVoice, cfg.sourceVoice) || undefined,
        maxChars: cfg.maxChars,
      },
      timeout: 600_000,
    })
    const chained = queue.then(run, run)
    queue = chained.then(() => undefined, () => undefined)
    spoken = await chained
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return Response.json({ ok: false, error: message }, { status: 503 })
  }

  if (spoken.status !== 200) {
    let detail = `speech worker answered HTTP ${String(spoken.status)}`
    try {
      const parsed = JSON.parse(spoken.body.toString('utf8'))
      if (typeof parsed?.error === 'string') detail = parsed.error
    } catch {
      // Keep the status-based detail.
    }
    return Response.json({ ok: false, error: detail }, { status: 502 })
  }

  return new Response(spoken.body, {
    status: 200,
    headers: {
      'content-type': 'audio/wav',
      'cache-control': 'no-store',
      'x-sovits-chars': String(Array.from(cut.text).length),
      'x-sovits-truncated': cut.truncated ? '1' : '0',
    },
  })
}

/**
 * Register the speech route for the lifetime of this plugin context.
 * @param ctx - Host context; `connection` is required by {@link inject}.
 * @param config - bundle config, if any.
 */
export function apply(ctx, config) {
  const state = { cfg: settings(config) }
  ctx.effect(() => ctx.connection.fetch.register({
    path: ROUTE,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: (request) => answer(ctx, state, request),
  }), 'dsh-sovits-tts: speech route')
}
