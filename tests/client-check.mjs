// Smoke test for the Client half, with the smallest React that can render once.
// It cannot prove the buttons look right, but it does prove the module loads,
// registers all three surfaces, and that each component renders without throwing.
// Run: node test/client-check.mjs

/** Rendered element nodes, so a crash inside a component surfaces as a throw. */
const React = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children }
  },
  useState(initial) {
    return [typeof initial === 'function' ? initial() : initial, () => {}]
  },
  useEffect() {},
  useRef(value) {
    return { current: value }
  },
}

/** The captured module the loader was handed. */
let loaded = null

globalThis.window = {
  __ModuleLoader__: { load: (mod) => { loaded = mod } },
  localStorage: { getItem: () => null, setItem: () => {} },
  addEventListener: () => {},
}
globalThis.Audio = class {
  addEventListener() {}
  play() { return Promise.resolve() }
  pause() {}
  removeAttribute() {}
  load() {}
}
globalThis.document = {
  createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
  head: { append() {} },
  querySelectorAll: () => [],
}
globalThis.URL = { createObjectURL: () => 'blob:mock', revokeObjectURL() {} }
globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  headers: { get: () => '0' },
  json: async () => ({
    ok: true,
    running: true,
    ready: true,
    device: 'cuda',
    voices: [{ id: 'yuuka', name: '优香' }, { id: 'kazusa', name: '和纱' }],
    sourceVoices: ['zh-CN-XiaoxiaoNeural'],
    settings: {
      workerDir: 'E:\\TOOL\\AI\\sovits-tts',
      pythonPath: '',
      port: 8765,
      autoStart: true,
      maxChars: 1200,
      pitch: 0,
      rate: 0,
      voice: 'yuuka',
      sourceVoice: '',
    },
  }),
  blob: async () => new Blob([new Uint8Array(8)]),
})

await import('../client.js')
if (loaded === null) throw new Error('client bundle did not call __ModuleLoader__.load')
if (loaded.id !== '@local/dsh-sovits-tts') throw new Error(`unexpected bundle id ${String(loaded.id)}`)

const require = (name) => {
  if (name === 'react') return React
  throw new Error(`client bundle required ${name}`)
}
const bundle = loaded.factory(require)

/** Slot registrations made by apply, by id. */
const registered = new Map()
const ctx = {
  locale: { bind: () => (key) => key, register: () => () => {} },
  effect: (run) => run(),
  slots: {
    inject: (name, run) => run(),
    register: (options, component) => {
      registered.set(options.id, { slot: options.name, component, options })
      return () => {}
    },
  },
}
bundle.apply(ctx)

if (registered.size !== 3) throw new Error(`expected three slot registrations, got ${String(registered.size)}`)
const speak = registered.get('sovits-speak')
const dock = registered.get('sovits-voice')
const section = registered.get('sovits-tts')
if (speak.slot !== 'conversation.chat.assistant-actions') throw new Error(`speak slot is ${String(speak.slot)}`)
if (dock.slot !== 'conversation.composer.dock') throw new Error(`dock slot is ${String(dock.slot)}`)
if (section.slot !== 'settings.section') throw new Error(`settings slot is ${String(section.slot)}`)
if (speak.options.order !== 30) throw new Error(`speak order is ${String(speak.options.order)}`)

/** Walk a rendered tree and collect every node type. */
function types(node, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) types(child, out)
    return out
  }
  out.push(node.type)
  for (const child of node.children ?? []) types(child, out)
  return out
}

const speakTree = speak.component({ messageId: 'm1', sessionId: 's1', t: (key) => key })
const speakTypes = types(speakTree)
if (speakTree.type !== 'button') throw new Error(`speak root is ${String(speakTree.type)}`)
if (speakTypes.includes('svg') !== true) throw new Error('speak button has no icon')
console.log('speak button:', JSON.stringify({ type: speakTree.type, label: speakTree.props['aria-label'], order: speak.options.order }))

const dockTree = dock.component({ t: (key) => key })
const dockTypes = types(dockTree)
if (dockTypes.includes('select') !== true) throw new Error('dock renders no select')
if (dockTypes.includes('button') !== true) throw new Error('dock renders no preview button')
console.log('dock entry:', JSON.stringify({ root: dockTree.type, nodes: dockTypes.length, order: dock.options.order }))

const label = typeof section.options.label === 'function' ? section.options.label() : section.options.label
const sectionTree = section.component({ t: (key) => key, close: () => {} })
const sectionTypes = types(sectionTree)
if (sectionTree.type !== 'div') throw new Error(`settings root is ${String(sectionTree.type)}`)
console.log('settings section:', JSON.stringify({ root: sectionTree.type, label, order: section.options.order, nodes: sectionTypes.length }))
console.log('ok')
