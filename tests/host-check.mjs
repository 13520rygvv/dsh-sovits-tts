// Offline harness for the Host half: registers the route against a fake Host
// context (fake sessionQuery + fake connection) and drives it with real
// Requests, so the text extraction, worker boot and binary Response are all
// exercised without the app. Run: node test/host-check.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'

/**
 * The settings round-trip below patches the real settings file, so snapshot it
 * first and put the exact bytes back on the way out (an earlier version reset
 * unrelated fields to their defaults and lost the user's voice/pitch).
 */
const SETTINGS_PATH = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'sovits-tts', 'settings.json')
let settingsBackup = null
try {
  settingsBackup = readFileSync(SETTINGS_PATH, 'utf8')
} catch {
  settingsBackup = null
}

function restoreSettingsFile() {
  if (settingsBackup === null) return
  try {
    writeFileSync(SETTINGS_PATH, settingsBackup, 'utf8')
    console.log('settings file restored')
  } catch (error) {
    console.log('settings file restore failed:', error.message)
  }
}

const routes = []
const events = [
  { type: 'user/message', data: { message: { id: 'u1', role: 'user', content: [{ type: 'text', text: '你好' }] } } },
  {
    type: 'assistant/message',
    data: {
      message: {
        id: 'm1',
        role: 'assistant',
        content: [
          { type: 'reasoning', text: '这里不应该被读出来' },
          { type: 'text', text: '你好，我是优香。现在用我的声音为你朗读这条回答。' },
          { type: 'tool-call', name: 'bash', input: {} },
          { type: 'text', text: '第二段正文也能接上。' },
        ],
      },
      stream: [],
    },
  },
]

const ctx = {
  effect: (run) => run(),
  get: (name) => (name === 'sessionQuery'
    ? {
        readSurface: async () => ({ events }),
        readSession: async () => ({ events }),
      }
    : undefined),
  connection: { fetch: { register: (route) => { routes.push(route); return () => {} } } },
}

apply(ctx, {})

if (routes.length !== 1) throw new Error(`expected one route, got ${String(routes.length)}`)
const [route] = routes
if (route.path !== '/api/dsh-sovits' || route.methods.includes('POST') !== true) {
  throw new Error(`unexpected route ${JSON.stringify({ path: route.path, methods: route.methods })}`)
}

const call = (payload) => route.fetch(new Request('http://127.0.0.1/api/dsh-sovits', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload),
}))

const health = await (await call({ action: 'health', start: true })).json()
console.log('health:', JSON.stringify({ running: health.running, ready: health.ready, voices: (health.voices ?? []).length }))

const started = Date.now()
const spoken = await call({ action: 'speak', sessionId: 's1', messageId: 'm1', voice: 'yuuka' })
console.log('speak:', spoken.status, spoken.headers.get('content-type'), 'chars=', spoken.headers.get('x-sovits-chars'), 'truncated=', spoken.headers.get('x-sovits-truncated'), `${String(Date.now() - started)}ms`)
const bytes = Buffer.from(await spoken.arrayBuffer())
writeFileSync('test/host-check.wav', bytes)
console.log('wav bytes:', bytes.length)

const unknown = await call({ action: 'speak', sessionId: 's1', messageId: 'nope' })
console.log('missing message ->', unknown.status, JSON.stringify(await unknown.json()).slice(0, 140))

const noId = await call({ action: 'speak', sessionId: 's1' })
console.log('no message id ->', noId.status, noId.headers.get('content-type'))

const truncated = await call({ action: 'speak', text: '这是一句会被截断的测试文本，用来检查长度限制是否生效。', voice: 'kazusa' })
console.log('explicit text:', truncated.status, 'chars=', truncated.headers.get('x-sovits-chars'), 'truncated=', truncated.headers.get('x-sovits-truncated'))

// Settings round-trip: the page saves a patch, and the next speak must obey it.
console.log('settings before:', JSON.stringify(health.settings))
const patched = await (await call({ action: 'settings-set', patch: { voice: 'kazusa', rate: 40, pitch: 1, maxChars: 10 } })).json()
console.log('settings patched:', JSON.stringify({ ok: patched.ok, persisted: patched.persisted, voice: patched.settings?.voice, rate: patched.settings?.rate, maxChars: patched.settings?.maxChars }))
if (patched.settings?.maxChars !== 10) throw new Error('settings patch did not take the new budget')
const clamped = await call({ action: 'speak', sessionId: 's1', messageId: 'm1' })
console.log('budget applied:', clamped.status, 'chars=', clamped.headers.get('x-sovits-chars'), 'truncated=', clamped.headers.get('x-sovits-truncated'))
if (clamped.headers.get('x-sovits-truncated') !== '1') throw new Error('maxChars patch did not cut the answer')
const restored = await (await call({ action: 'settings-set', patch: health.settings })).json()
console.log('settings restored:', JSON.stringify({ persisted: restored.persisted, settings: restored.settings }))
restoreSettingsFile()
if (JSON.stringify(restored.settings) !== JSON.stringify(health.settings)) throw new Error('settings were not restored to their original values')

