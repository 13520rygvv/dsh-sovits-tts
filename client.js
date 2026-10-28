window.__ModuleLoader__.load({
  id: '@local/dsh-sovits-tts',
  factory(require) {
    try {
    const React = require('react')
    const h = React.createElement

    /** Dictionary namespace of this package. */
    const NS = 'dsh-sovits-tts'
    /** Exact Fetch route served by the Host twin of this package. */
    const ROUTE = '/api/dsh-sovits'
    /** Playback key of the dock's preview button, which owns no message. */
    const PREVIEW_KEY = '__preview__'

    /** Action glyph and dock styles, prefixed so nothing can collide with the host. */
    const CSS = `
      .dsvt-action { display:inline-flex; align-items:center; justify-content:center; width:24px; height:24px; padding:0; border:0; border-radius:6px; background:transparent; color:var(--dsw-alias-label-secondary); cursor:pointer; transition:color .12s ease, background .12s ease; }
      .dsvt-action:hover { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }
      .dsvt-action:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:1px; }
      .dsvt-action[data-playing="1"] { color:var(--dsw-alias-brand-primary); }
      .dsvt-action[data-loading="1"] { animation:dsvt-pulse 1.1s ease-in-out infinite; cursor:progress; }
      .dsvt-action svg { width:16px; height:16px; display:block; }
      @keyframes dsvt-pulse { 0%,100% { opacity:.35; } 50% { opacity:1; } }
      .dsvt-dock { display:inline-flex; align-items:center; gap:6px; font-size:12px; line-height:18px; color:var(--dsw-alias-label-secondary); }
      .dsvt-label { color:var(--dsw-alias-label-tertiary); }
      .dsvt-select { height:22px; max-width:110px; padding:0 4px; border-radius:6px; border:1px solid var(--dsw-alias-border-l1); background:transparent; color:var(--dsw-alias-label-primary); font:inherit; font-size:12px; cursor:pointer; }
      .dsvt-select:disabled { opacity:.55; cursor:default; }
      .dsvt-select:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:1px; }
      .dsvt-button { height:22px; padding:0 8px; border-radius:6px; border:1px solid var(--dsw-alias-border-l1); background:transparent; color:var(--dsw-alias-label-secondary); font:inherit; font-size:12px; cursor:pointer; }
      .dsvt-button:hover:enabled { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }
      .dsvt-button:disabled { opacity:.55; cursor:default; }
      .dsvt-status { color:var(--dsw-alias-label-tertiary); }
      .dsvt-status[data-tone="error"] { color:var(--dsw-alias-state-error-primary); }
      .dsvt-page { display:flex; flex-direction:column; gap:16px; padding:4px 2px 32px; max-width:760px; color:var(--dsw-alias-label-primary); font-size:13px; line-height:1.6; }
      .dsvt-page h2 { margin:0; font-size:15px; font-weight:600; }
      .dsvt-page p { margin:0; color:var(--dsw-alias-label-secondary); }
      .dsvt-card { border:1px solid var(--dsw-alias-border-l1); border-radius:10px; background:var(--dsw-alias-bg-layer-1); padding:14px 16px; display:flex; flex-direction:column; gap:12px; }
      .dsvt-card-title { display:flex; align-items:center; gap:8px; font-weight:600; font-size:13px; }
      .dsvt-badge { display:inline-flex; align-items:center; gap:5px; padding:1px 8px; border-radius:999px; font-size:11px; font-weight:500; border:1px solid var(--dsw-alias-border-l1); color:var(--dsw-alias-label-secondary); }
      .dsvt-badge[data-tone="ok"] { color:var(--dsw-alias-brand-primary); border-color:var(--dsw-alias-brand-primary); }
      .dsvt-badge[data-tone="busy"] { color:var(--dsw-alias-label-secondary); }
      .dsvt-badge[data-tone="off"] { color:var(--dsw-alias-state-error-primary); border-color:var(--dsw-alias-state-error-primary); }
      .dsvt-grid { display:flex; flex-direction:column; gap:10px; }
      .dsvt-field { display:grid; grid-template-columns:132px 1fr; align-items:center; gap:12px; }
      .dsvt-field > span { color:var(--dsw-alias-label-secondary); }
      .dsvt-field-wide { grid-template-columns:1fr; gap:4px; }
      .dsvt-control { display:flex; align-items:center; gap:10px; min-width:0; }
      .dsvt-control > input[type="text"], .dsvt-control > input[type="number"] { width:100%; height:28px; padding:0 8px; border-radius:6px; border:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-primary); font:inherit; font-size:12px; }
      .dsvt-control > input[type="range"] { flex:1; min-width:80px; accent-color:var(--dsw-alias-brand-primary); }
      .dsvt-control > select { height:28px; padding:0 6px; border-radius:6px; border:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-primary); font:inherit; font-size:12px; cursor:pointer; min-width:180px; }
      .dsvt-value { min-width:72px; text-align:right; color:var(--dsw-alias-label-tertiary); font-variant-numeric:tabular-nums; }
      .dsvt-hint { margin:-4px 0 0; color:var(--dsw-alias-label-tertiary); font-size:12px; }
      .dsvt-footer { display:flex; align-items:center; gap:10px; min-height:24px; }
      .dsvt-footer .dsvt-status { font-size:12px; }
      .dsvt-check { display:flex; align-items:center; gap:8px; }
      .dsvt-check input { accent-color:var(--dsw-alias-brand-primary); }
      .dsvt-page details { border:1px solid var(--dsw-alias-border-l1); border-radius:10px; background:var(--dsw-alias-bg-layer-1); padding:10px 16px; }
      .dsvt-page summary { cursor:pointer; font-weight:600; font-size:13px; color:var(--dsw-alias-label-secondary); }
      .dsvt-page details[open] summary { margin-bottom:12px; }
    `

    /** Simplified Chinese copy. */
    const zh = {
      'speak': '用我的声音朗读',
      'stop': '停止朗读',
      'loading': '正在合成语音…',
      'empty': '这条回答没有可以朗读的正文',
      'failed': '朗读失败：{message}',
      'truncated': '只朗读了前面一部分',
      'voice.label': '语音',
      'preview': '试听',
      'preview.text': '试听一下，这是{name}的声音。',
      'warming': '语音模型预热中…',
      'offline': '语音服务未就绪',
      'retry': '重试',
      'section.label': '语音朗读',
      'section.title': '角色音色朗读',
      'section.desc': '把每条回答读出来。文字先由在线语音念成人声，再用你自己的 so-vits 模型换成角色声音。',
      'section.restart': '重启服务',
      'section.voice': '音色',
      'section.pitch': '音调',
      'section.rate': '语速',
      'section.volume': '朗读音量',
      'section.source': '源语音',
      'section.maxChars': '单次字数上限',
      'section.maxChars.hint': '超出部分不朗读，避免一次合成好几分钟的音频。',
      'section.idleMinutes': '空闲自动退出',
      'section.idleMinutes.hint': '这么久没朗读就关掉语音服务，把显存还给游戏和其他程序；下次点喇叭会自动重启（首次慢十几秒）。0 表示常驻。',
      'section.minutes': '{value} 分钟',
      'section.autoStart': '需要时自动启动语音服务',
      'section.advanced': '高级',
      'section.workerDir': '服务目录',
      'section.pythonPath': 'Python 解释器',
      'section.pythonPath.hint': '留空则使用「服务目录\\venv\\Scripts\\python.exe」。',
      'section.port': '端口',
      'section.saved': '已保存',
      'section.saving': '保存中…',
      'section.saveFailed': '保存失败：{message}',
      'section.unpersisted': '已生效，但没能写入设置文件',
      'section.loading': '正在读取设置…',
      'section.semitones': '{value} 半音',
      'section.percent': '{value}%',
      'section.chars': '{value} 字',
      'section.device': '设备',
      'section.voiceCount': '{value} 个音色',
    }

    /** English copy. */
    const en = {
      'speak': 'Read this answer aloud',
      'stop': 'Stop reading',
      'loading': 'Synthesizing speech…',
      'empty': 'This answer has no text to read',
      'failed': 'Reading failed: {message}',
      'truncated': 'Only the beginning was read',
      'voice.label': 'Voice',
      'preview': 'Preview',
      'preview.text': 'This is {name} speaking.',
      'warming': 'Warming the voice model…',
      'offline': 'Speech service is not ready',
      'retry': 'Retry',
      'section.label': 'Spoken answers',
      'section.title': 'Answers in your character voice',
      'section.desc': 'Reads each answer aloud: an online voice speaks the text first, then your own so-vits model turns it into the character voice.',
      'section.restart': 'Restart service',
      'section.voice': 'Voice',
      'section.pitch': 'Pitch',
      'section.rate': 'Speed',
      'section.volume': 'Volume',
      'section.source': 'Source voice',
      'section.maxChars': 'Characters per answer',
      'section.maxChars.hint': 'The rest is skipped so one click cannot synthesize minutes of audio.',
      'section.idleMinutes': 'Leave when idle',
      'section.idleMinutes.hint': 'Stop the speech service after this long without playback so the GPU goes back to games and other apps; the next click restarts it (slower the first time). 0 keeps it resident.',
      'section.minutes': '{value} min',
      'section.autoStart': 'Start the speech service when needed',
      'section.advanced': 'Advanced',
      'section.workerDir': 'Service directory',
      'section.pythonPath': 'Python interpreter',
      'section.pythonPath.hint': 'Empty means <service directory>\\venv\\Scripts\\python.exe.',
      'section.port': 'Port',
      'section.saved': 'Saved',
      'section.saving': 'Saving…',
      'section.saveFailed': 'Save failed: {message}',
      'section.unpersisted': 'Applied, but the settings file could not be written',
      'section.loading': 'Loading settings…',
      'section.semitones': '{value} semitones',
      'section.percent': '{value}%',
      'section.chars': '{value} chars',
      'section.device': 'Device',
      'section.voiceCount': '{value} voices',
    }

    /**
     * Resolve copy without the slot's `t`, so every surface stays readable when
     * a composition does not bind this package's dictionary.
     * @param key - dictionary key.
     * @param params - placeholder values.
     * @returns the localized sentence.
     */
    function fallbackText(key, params) {
      const template = zh[key] ?? en[key] ?? key
      if (params === undefined) return template
      return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
    }

    /** Dictionary binding installed by `apply`; the locale service keeps it live. */
    let translate = null

    /**
     * Localized copy for surfaces that own no `t` prop.
     * @param key - dictionary key.
     * @param params - placeholder values.
     * @returns the localized sentence.
     */
    function copy(key, params) {
      return translate === null ? fallbackText(key, params) : translate(key, params)
    }

    /**
     * One shared settings/status store for every surface of this package: the
     * composer dock and the settings page must not disagree about the voice,
     * and an answer button applies whatever the page saved.
     */
    const store = {
      state: {
        phase: 'idle',
        settings: null,
        voices: [],
        sourceVoices: [],
        device: '',
        error: '',
        ready: false,
      },
      listeners: new Set(),
      started: false,
    }

    /**
     * Replace part of the shared state and wake every subscriber.
     * @param patch - keys to change.
     */
    function setState(patch) {
      store.state = { ...store.state, ...patch }
      for (const listener of [...store.listeners]) listener(store.state)
    }

    /**
     * Subscribe one component to the shared settings/status state.
     * @returns the current state.
     */
    function useStore() {
      const [state, setLocal] = React.useState(store.state)
      React.useEffect(() => {
        const listener = (next) => setLocal(next)
        store.listeners.add(listener)
        listener(store.state)
        return () => {
          store.listeners.delete(listener)
        }
      }, [])
      return state
    }

    /** Poll bookkeeping, so the dock and the page share one cold start. */
    const polling = { timer: null, tries: 0, start: true }

    /**
     * Read the worker status once and fold it into the store.
     * @param start - ask the Host to start a worker that is not running.
     * @returns whether a voice list is available.
     */
    async function healthOnce(start) {
      const response = await post({ action: 'health', start })
      const data = await response.json()
      const voices = Array.isArray(data.voices)
        ? data.voices.map((item) => ({ id: String(item.id), name: String(item.name) }))
        : []
      const settings = data.settings !== null && typeof data.settings === 'object' ? data.settings : null
      setState({
        settings: settings ?? store.state.settings,
        voices: voices.length > 0 ? voices : store.state.voices,
        sourceVoices: Array.isArray(data.sourceVoices) && data.sourceVoices.length > 0
          ? data.sourceVoices.map(String)
          : store.state.sourceVoices,
        device: typeof data.device === 'string' ? data.device : '',
        error: typeof data.error === 'string' ? data.error : '',
        ready: data.ready === true,
        phase: voices.length > 0 ? 'ready' : data.pending === true ? 'warming' : 'idle',
      })
      return voices.length > 0
    }

    /**
     * Poll until the worker answers with its voice list. A cold start loads a
     * 667 MB checkpoint, so a `pending` worker gets a much longer budget.
     */
    async function pollHealth() {
      polling.timer = null
      let ready = false
      try {
        ready = await healthOnce(polling.start)
      } catch {
        ready = false
      }
      if (ready) return
      polling.tries += 1
      const pending = store.state.phase === 'warming'
      if (polling.tries >= (pending ? 60 : 3)) {
        polling.tries = 0
        polling.start = false
        setState({ phase: 'offline' })
        return
      }
      polling.timer = setTimeout(pollHealth, pending ? 2000 : 2500)
    }

    /** Start the shared status poll exactly once per page load. */
    function ensureLoaded() {
      if (store.started) return
      store.started = true
      void pollHealth()
    }

    /** Forget an offline verdict and poll again from scratch. */
    function retryLoad() {
      if (polling.timer !== null) clearTimeout(polling.timer)
      polling.timer = null
      polling.tries = 0
      polling.start = true
      setState({ phase: 'warming' })
      void pollHealth()
    }

    /**
     * Persist one settings patch through the Host.
     * @param patch - settings keys to change.
     * @returns the Host answer, including whether it reached the disk.
     */
    async function saveSettings(patch) {
      const response = await post({ action: 'settings-set', patch })
      const data = await response.json()
      if (data.settings !== null && typeof data.settings === 'object') setState({ settings: data.settings })
      return data
    }

    /** Friendly names for the source TTS voices the worker offers. */
    const SOURCE_LABELS = {
      'zh-CN-XiaoxiaoNeural': '晓晓 · 女声',
      'zh-CN-XiaoyiNeural': '晓伊 · 女声',
      'zh-CN-YunxiNeural': '云希 · 男声',
      'zh-CN-YunjianNeural': '云健 · 男声',
      'ja-JP-NanamiNeural': '七海 · 日语女声',
      'en-US-AriaNeural': 'Aria · English',
      'en-US-GuyNeural': 'Guy · English',
    }

    /**
     * One audio element for the whole page, so two answers never talk at once.
     * The active key tells every button which one is currently playing.
     */
    const playback = { audio: null, url: null, key: null, listeners: new Set() }

    /**
     * Re-render every subscribed button after the playback state changed.
     */
    function notifyPlayback() {
      for (const listener of [...playback.listeners]) listener()
    }

    /**
     * Playback volume as a 0..1 factor, taken from the shared settings.
     * @returns the clamped element volume; a missing setting means full volume.
     */
    function currentVolume() {
      const settings = store.state.settings
      const value = settings === null || settings === undefined ? 100 : Number(settings.volume)
      const percent = Number.isFinite(value) ? value : 100
      return Math.min(1, Math.max(0, percent / 100))
    }

    /**
     * Apply a volume percentage to the element that is playing right now, so the
     * slider takes effect on the current answer instead of the next one.
     * @param percent - 0..100.
     */
    function applyVolume(percent) {
      if (playback.audio === null) return
      const value = Number.isFinite(Number(percent)) ? Number(percent) : 100
      playback.audio.volume = Math.min(1, Math.max(0, value / 100))
    }

    /**
     * The shared audio element, created on first use.
     * @returns the element.
     */
    function audioElement() {
      if (playback.audio === null) {
        const audio = new Audio()
        audio.preload = 'auto'
        audio.volume = currentVolume()
        audio.addEventListener('ended', () => {
          playback.key = null
          notifyPlayback()
        })
        audio.addEventListener('error', () => {
          if (playback.key === null) return
          playback.key = null
          notifyPlayback()
        })
        playback.audio = audio
      }
      return playback.audio
    }

    /**
     * Stop whatever is playing and clear every button's active state.
     */
    function stopPlayback() {
      const audio = playback.audio
      if (audio !== null) {
        try {
          audio.pause()
          audio.removeAttribute('src')
          audio.load()
        } catch {
          // A stopped element is already in the state we want.
        }
      }
      playback.key = null
      notifyPlayback()
    }

    /**
     * Play one synthesized answer and mark its button active.
     * @param key - message id, or {@link PREVIEW_KEY}.
     * @param blob - `audio/wav` body returned by the Host.
     */
    function playBlob(key, blob) {
      const audio = audioElement()
      audio.volume = currentVolume()
      if (playback.url !== null) {
        try {
          URL.revokeObjectURL(playback.url)
        } catch {
          // An already-revoked URL is harmless.
        }
      }
      const url = URL.createObjectURL(blob)
      playback.url = url
      audio.src = url
      playback.key = key
      notifyPlayback()
      Promise.resolve(audio.play()).catch(() => {
        playback.key = null
        notifyPlayback()
      })
    }

    /**
     * Subscribe one component to this playback key's active state.
     * @param key - message id, or {@link PREVIEW_KEY}.
     * @returns whether that key is the one currently playing.
     */
    function usePlayback(key) {
      const [active, setActive] = React.useState(playback.key === key)
      React.useEffect(() => {
        const listener = () => setActive(playback.key === key)
        playback.listeners.add(listener)
        listener()
        return () => {
          playback.listeners.delete(listener)
        }
      }, [key])
      return active
    }

    /**
     * POST one action to the Host twin.
     * @param payload - JSON body, always carrying `action`.
     * @returns the raw response, so a binary answer stays available.
     */
    async function post(payload) {
      const response = await fetch(ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        let detail = `HTTP ${response.status}`
        try {
          const data = await response.json()
          if (typeof data?.error === 'string' && data.error !== '') detail = data.error
        } catch {
          // Keep the status-based detail.
        }
        throw new Error(detail)
      }
      return response
    }

    /**
     * Speaker glyph: silent, playing, or spinning while the answer is built.
     * @param props - `playing` and `loading` flags.
     * @returns the svg node.
     */
    function SpeakerIcon(props) {
      const wave = props.playing === true
      return h('svg', {
        viewBox: '0 0 16 16',
        'aria-hidden': 'true',
        focusable: 'false',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }, [
        h('path', {
          key: 'body',
          d: 'M8.4 2.5 5.1 5.3H2.9v5.4h2.2l3.3 2.8V2.5Z',
        }),
        wave
          ? h('path', { key: 'wave', d: 'M11 5.6a3.2 3.2 0 0 1 0 4.8M12.7 3.9a5.6 5.6 0 0 1 0 8.2' })
          : h('path', { key: 'mute', d: 'M11.2 6.1l2.6 3.8M13.8 6.1l-2.6 3.8' }),
      ])
    }

    /**
     * Speaker button beside the copy / feedback actions of one answer.
     * @param props - slot props; carries `messageId` and the owning `sessionId`.
     * @returns the button.
     */
    function SpeakAction(props) {
      const tr = typeof props.t === 'function' ? props.t : copy
      const messageId = props.messageId === undefined || props.messageId === null ? '' : String(props.messageId)
      const sessionId = props.sessionId === undefined || props.sessionId === null ? '' : String(props.sessionId)
      const key = messageId === '' ? 'unknown-message' : messageId
      const playing = usePlayback(key)
      const [busy, setBusy] = React.useState(false)
      const [hint, setHint] = React.useState(null)
      const token = React.useRef(0)

      React.useEffect(() => () => {
        token.current += 1
      }, [])

      const label = playing ? tr('stop') : busy ? tr('loading') : hint ?? tr('speak')

      const onClick = () => {
        if (playing) {
          stopPlayback()
          return
        }
        if (busy) return
        if (sessionId === '' || messageId === '') {
          setHint(tr('failed', { message: 'message is unknown' }))
          return
        }
        const mine = token.current + 1
        token.current = mine
        setBusy(true)
        setHint(null)
        post({ action: 'speak', sessionId, messageId })
          .then(async (response) => {
            const blob = await response.blob()
            if (token.current !== mine) return
            setBusy(false)
            if (response.headers.get('x-sovits-truncated') === '1') setHint(tr('truncated'))
            playBlob(key, blob)
          })
          .catch((error) => {
            if (token.current !== mine) return
            setBusy(false)
            const message = error instanceof Error ? error.message : String(error)
            setHint(tr('failed', { message }))
          })
      }

      return h('button', {
        type: 'button',
        className: 'dsvt-action',
        'data-playing': playing ? '1' : '0',
        'data-loading': busy ? '1' : '0',
        'aria-label': label,
        'aria-pressed': playing ? 'true' : 'false',
        title: label,
        onClick,
      }, SpeakerIcon({ playing, loading: busy }))
    }

    /**
     * Voice picker under the composer: which checkpoint reads the answers, plus
     * a one-sentence preview so a bad checkpoint is obvious before using it.
     * @param props - slot props; only localization is used.
     * @returns the dock entry.
     */
    function VoiceDock(props) {
      const tr = typeof props.t === 'function' ? props.t : copy
      const state = useStore()
      const [notice, setNotice] = React.useState(null)
      const playing = usePlayback(PREVIEW_KEY)

      React.useEffect(() => {
        ensureLoaded()
      }, [])

      const voice = state.settings === null ? '' : String(state.settings.voice ?? '')
      const current = state.voices.some((item) => item.id === voice) ? voice : state.voices[0]?.id ?? ''
      const phase = state.phase

      const onVoice = (next) => {
        setNotice(null)
        saveSettings({ voice: next }).catch((error) => {
          setNotice(tr('failed', { message: error instanceof Error ? error.message : String(error) }))
        })
      }

      const onPreview = () => {
        if (playing) {
          stopPlayback()
          return
        }
        if (current === '') return
        const chosen = state.voices.find((item) => item.id === current)
        setNotice(null)
        post({ action: 'speak', text: tr('preview.text', { name: chosen?.name ?? current }), voice: current })
          .then(async (response) => {
            const blob = await response.blob()
            playBlob(PREVIEW_KEY, blob)
          })
          .catch((error) => {
            setNotice(tr('failed', { message: error instanceof Error ? error.message : String(error) }))
          })
      }

      const status = phase === 'ready'
        ? null
        : h('span', {
            key: 'status',
            className: 'dsvt-status',
            'data-tone': phase === 'offline' ? 'error' : 'muted',
          }, phase === 'offline' ? tr('offline') : tr('warming'))

      return h('div', { className: 'dsvt-dock' }, [
        h('span', { key: 'label', className: 'dsvt-label' }, tr('voice.label')),
        h('select', {
          key: 'voice',
          className: 'dsvt-select',
          value: current,
          disabled: phase !== 'ready',
          'aria-label': tr('voice.label'),
          onChange: (event) => {
            onVoice(event.target.value)
          },
        }, state.voices.length === 0
          ? [h('option', { key: 'none', value: '' }, '—')]
          : state.voices.map((item) => h('option', { key: item.id, value: item.id }, item.name))),
        h('button', {
          key: 'preview',
          type: 'button',
          className: 'dsvt-button',
          disabled: phase !== 'ready',
          onClick: onPreview,
        }, playing ? tr('stop') : tr('preview')),
        status,
        phase === 'offline'
          ? h('button', {
              key: 'retry',
              type: 'button',
              className: 'dsvt-button',
              onClick: retryLoad,
            }, tr('retry'))
          : null,
        notice === null || phase !== 'ready'
          ? null
          : h('span', { key: 'notice', className: 'dsvt-status', 'data-tone': 'error', role: 'alert' }, notice),
      ])
    }

    /**
     * One labelled settings row.
     * @param key - React key.
     * @param label - row caption.
     * @param control - control nodes.
     * @returns the row.
     */
    function field(key, label, control) {
      return h('div', { key, className: 'dsvt-field' }, [
        h('span', { key: 'label' }, label),
        h('div', { key: 'control', className: 'dsvt-control' }, control),
      ])
    }

    /**
     * The settings page: every knob of the speech pipeline, the live service
     * status, and a preview button. Changes save on their own after a short
     * pause, so there is no Apply button to forget.
     * @param props - settings-section props; localization is the only useful one.
     * @returns the page.
     */
    function SettingsPage(props) {
      const tr = typeof props.t === 'function' ? props.t : copy
      const state = useStore()
      const [draft, setDraft] = React.useState(null)
      const [saved, setSaved] = React.useState({ tone: 'muted', text: '' })
      const timer = React.useRef(null)
      const playing = usePlayback(PREVIEW_KEY)

      React.useEffect(() => {
        ensureLoaded()
      }, [])

      React.useEffect(() => {
        if (state.settings !== null && draft === null) setDraft(state.settings)
      }, [state.settings, draft])

      React.useEffect(() => () => {
        if (timer.current !== null) clearTimeout(timer.current)
      }, [])

      /**
       * Show one value immediately and persist it once the user stops moving.
       * @param key - settings key.
       * @param value - new value.
       */
      const commit = (key, value) => {
        setDraft((current) => ({ ...(current ?? {}), [key]: value }))
        setSaved({ tone: 'muted', text: tr('section.saving') })
        if (timer.current !== null) clearTimeout(timer.current)
        timer.current = setTimeout(() => {
          timer.current = null
          saveSettings({ [key]: value })
            .then((data) => {
              setSaved(data.persisted === false
                ? { tone: 'error', text: tr('section.unpersisted') }
                : { tone: 'muted', text: tr('section.saved') })
            })
            .catch((error) => {
              setSaved({ tone: 'error', text: tr('failed', { message: error instanceof Error ? error.message : String(error) }) })
            })
        }, 400)
      }

      const s = draft ?? state.settings
      if (s === null) {
        return h('div', { className: 'dsvt-page' }, [h('p', { key: 'loading' }, tr('section.loading'))])
      }

      const voiceOptions = state.voices.length === 0
        ? [h('option', { key: 'none', value: '' }, '—')]
        : state.voices.map((item) => h('option', { key: item.id, value: item.id }, item.name))

      const sourceIds = state.sourceVoices.length === 0 ? [] : [...state.sourceVoices]
      if (s.sourceVoice !== '' && !sourceIds.includes(s.sourceVoice)) sourceIds.unshift(s.sourceVoice)
      const sourceOptions = [h('option', { key: 'default', value: '' }, '—')]
        .concat(sourceIds.map((id) => h('option', { key: id, value: id }, SOURCE_LABELS[id] ?? id)))

      const preview = () => {
        if (playing) {
          stopPlayback()
          return
        }
        const chosen = state.voices.find((item) => item.id === s.voice)
        setSaved({ tone: 'muted', text: tr('section.saving') })
        post({ action: 'speak', text: tr('preview.text', { name: chosen?.name ?? s.voice }) })
          .then(async (response) => {
            const blob = await response.blob()
            setSaved({ tone: 'muted', text: '' })
            playBlob(PREVIEW_KEY, blob)
          })
          .catch((error) => {
            setSaved({ tone: 'error', text: tr('failed', { message: error instanceof Error ? error.message : String(error) }) })
          })
      }

      const restart = () => {
        setSaved({ tone: 'muted', text: tr('section.saving') })
        post({ action: 'restart' })
          .then(async (response) => {
            const data = await response.json()
            if (data.settings !== null && typeof data.settings === 'object') setDraft(data.settings)
            setSaved({ tone: 'muted', text: tr('section.saved') })
            retryLoad()
          })
          .catch((error) => {
            setSaved({ tone: 'error', text: tr('failed', { message: error instanceof Error ? error.message : String(error) }) })
          })
      }

      const badge = state.phase === 'ready'
        ? h('span', { key: 'badge', className: 'dsvt-badge', 'data-tone': 'ok' }, tr('status.running'))
        : state.phase === 'offline'
          ? h('span', { key: 'badge', className: 'dsvt-badge', 'data-tone': 'off' }, tr('offline'))
          : h('span', { key: 'badge', className: 'dsvt-badge', 'data-tone': 'busy' }, tr('warming'))

      return h('div', { className: 'dsvt-page' }, [
        h('div', { key: 'head' }, [
          h('h2', { key: 'title' }, tr('section.title')),
          h('p', { key: 'desc' }, tr('section.desc')),
        ]),
        h('div', { key: 'service', className: 'dsvt-card' }, [
          h('div', { key: 'title', className: 'dsvt-card-title' }, [
            h('span', { key: 'label' }, tr('section.label')),
            badge,
          ]),
          h('div', { key: 'row', className: 'dsvt-control' }, [
            h('span', { key: 'device', className: 'dsvt-status' }, `${tr('section.device')}: ${state.device === '' ? '—' : state.device}`),
            h('span', { key: 'voices', className: 'dsvt-status' }, tr('section.voiceCount', { value: state.voices.length })),
            h('button', { key: 'preview', type: 'button', className: 'dsvt-button', disabled: state.phase !== 'ready', onClick: preview }, playing ? tr('stop') : tr('preview')),
            h('button', { key: 'restart', type: 'button', className: 'dsvt-button', onClick: restart }, tr('section.restart')),
            state.phase === 'offline'
              ? h('button', { key: 'retry', type: 'button', className: 'dsvt-button', onClick: retryLoad }, tr('retry'))
              : null,
          ]),
          state.error === '' ? null : h('p', { key: 'error', className: 'dsvt-hint' }, state.error),
        ]),
        h('div', { key: 'voice', className: 'dsvt-card' }, [
          h('div', { key: 'grid', className: 'dsvt-grid' }, [
            field('voice', tr('section.voice'), h('select', {
              key: 'select',
              value: s.voice,
              onChange: (event) => {
                commit('voice', event.target.value)
              },
            }, voiceOptions)),
            field('pitch', tr('section.pitch'), [
              h('input', {
                key: 'range',
                type: 'range',
                min: -12,
                max: 12,
                step: 1,
                value: s.pitch,
                onChange: (event) => {
                  commit('pitch', Number(event.target.value))
                },
              }),
              h('span', { key: 'value', className: 'dsvt-value' }, tr('section.semitones', { value: s.pitch })),
            ]),
            field('rate', tr('section.rate'), [
              h('input', {
                key: 'range',
                type: 'range',
                min: -50,
                max: 100,
                step: 5,
                value: s.rate,
                onChange: (event) => {
                  commit('rate', Number(event.target.value))
                },
              }),
              h('span', { key: 'value', className: 'dsvt-value' }, tr('section.percent', { value: s.rate })),
            ]),
            field('volume', tr('section.volume'), [
              h('input', {
                key: 'range',
                type: 'range',
                min: 0,
                max: 100,
                step: 5,
                value: s.volume,
                onChange: (event) => {
                  const next = Number(event.target.value)
                  applyVolume(next)
                  commit('volume', next)
                },
              }),
              h('span', { key: 'value', className: 'dsvt-value' }, tr('section.percent', { value: s.volume })),
            ]),
            field('source', tr('section.source'), h('select', {
              key: 'select',
              value: s.sourceVoice,
              onChange: (event) => {
                commit('sourceVoice', event.target.value)
              },
            }, sourceOptions)),
            field('maxChars', tr('section.maxChars'), [
              h('input', {
                key: 'number',
                type: 'number',
                min: 0,
                max: 5000,
                step: 100,
                value: s.maxChars,
                onChange: (event) => {
                  commit('maxChars', Number(event.target.value))
                },
              }),
              h('span', { key: 'value', className: 'dsvt-value' }, tr('section.chars', { value: s.maxChars })),
            ]),
            field('idleMinutes', tr('section.idleMinutes'), [
              h('input', {
                key: 'number',
                type: 'number',
                min: 0,
                max: 240,
                step: 5,
                value: s.idleMinutes,
                onChange: (event) => {
                  commit('idleMinutes', Number(event.target.value))
                },
              }),
              h('span', { key: 'value', className: 'dsvt-value' }, tr('section.minutes', { value: s.idleMinutes })),
            ]),
            field('autoStart', '', h('label', { className: 'dsvt-check' }, [
              h('input', {
                key: 'box',
                type: 'checkbox',
                checked: s.autoStart !== false,
                onChange: (event) => {
                  commit('autoStart', event.target.checked)
                },
              }),
              h('span', { key: 'text' }, tr('section.autoStart')),
            ])),
          ]),
          h('p', { key: 'hint', className: 'dsvt-hint' }, tr('section.maxChars.hint')),
          h('p', { key: 'hintIdle', className: 'dsvt-hint' }, tr('section.idleMinutes.hint')),
        ]),
        h('details', { key: 'advanced' }, [
          h('summary', { key: 'summary' }, tr('section.advanced')),
          h('div', { key: 'grid', className: 'dsvt-grid' }, [
            field('workerDir', tr('section.workerDir'), h('input', {
              type: 'text',
              value: s.workerDir,
              onChange: (event) => {
                commit('workerDir', event.target.value)
              },
            })),
            field('pythonPath', tr('section.pythonPath'), h('input', {
              type: 'text',
              value: s.pythonPath,
              placeholder: tr('section.pythonPath.hint'),
              onChange: (event) => {
                commit('pythonPath', event.target.value)
              },
            })),
            field('port', tr('section.port'), h('input', {
              type: 'number',
              min: 1024,
              max: 65535,
              step: 1,
              value: s.port,
              onChange: (event) => {
                commit('port', Number(event.target.value))
              },
            })),
          ]),
          h('p', { key: 'hint', className: 'dsvt-hint' }, tr('section.pythonPath.hint')),
        ]),
        h('div', { key: 'footer', className: 'dsvt-footer' }, saved.text === ''
          ? null
          : h('span', { key: 'saved', className: 'dsvt-status', 'data-tone': saved.tone === 'error' ? 'error' : 'muted', role: saved.tone === 'error' ? 'alert' : 'status' }, saved.text)),
      ])
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        try {
        // A throwing client half aborts the app's whole web boot ("1 entry did
        // not activate"), so every surface is mounted defensively: a missing
        // slot must cost that one surface, never the application.
        // Services are also read through a tolerant accessor, so a service that
        // is missing at apply time costs one surface instead of the whole boot.
        const service = (name) => {
          try {
            const found = typeof ctx.get === 'function' ? ctx.get(name) : undefined
            return found ?? ctx[name] ?? undefined
          } catch (error) {
            console.warn(`[dsh-sovits-tts] service ${name} unavailable`, error)
            return undefined
          }
        }

        try {
          const locale = service('locale')
          translate = locale && typeof locale.bind === 'function' ? locale.bind(NS) : null
        } catch (error) {
          console.warn('[dsh-sovits-tts] locale binding unavailable', error)
        }

        ctx.effect(() => {
          const tag = document.createElement('style')
          tag.dataset.plugin = '@local/dsh-sovits-tts'
          tag.dataset.pluginCss = '@local/dsh-sovits-tts/speech.css'
          tag.textContent = CSS
          document.head.append(tag)
          return () => {
            tag.remove()
          }
        }, 'dsh-sovits-tts: styles')

        try {
          const locale = service('locale')
          if (locale && typeof locale.register === 'function') {
            ctx.effect(() => locale.register(NS, { zh, en }), 'dsh-sovits-tts: dictionaries')
          }
        } catch (error) {
          console.warn('[dsh-sovits-tts] dictionary registration failed', error)
        }

        /**
         * Register one slot surface defensively. `slots.inject` throws while a
         * lazily declared slot is still missing, so register straight on the
         * slots service (as the shipped settings plugins do) and retry a few
         * times; nothing here may throw out of `apply`.
         * @param label - effect label for diagnostics.
         * @param options - slot registration options.
         * @param Component - rendered occupant.
         */
        const registerSlot = (label, options, Component) => {
          try {
            ctx.effect(() => {
              let disposer = null
              let timer = null
              let tries = 0
              const attempt = () => {
                timer = null
                try {
                  const slots = service('slots')
                  if (!slots || typeof slots.register !== 'function') throw new Error('slots service unavailable')
                  disposer = slots.register(options, Component)
                } catch (error) {
                  tries += 1
                  if (tries < 6) timer = setTimeout(attempt, 700 * tries)
                  else {
                    console.warn(`[dsh-sovits-tts] ${label} unavailable`, error)
                    reportClientError(label, error)
                  }
                }
              }
              attempt()
              return () => {
                if (timer !== null) clearTimeout(timer)
                if (disposer !== null) {
                  try {
                    disposer()
                  } catch (error) {
                    console.warn(`[dsh-sovits-tts] ${label} dispose failed`, error)
                  }
                }
              }
            }, label)
          } catch (error) {
            console.warn(`[dsh-sovits-tts] ${label} failed`, error)
            reportClientError(label, error)
          }
        }

        registerSlot('dsh-sovits-tts: answer action', {
          name: 'conversation.chat.assistant-actions',
          id: 'sovits-speak',
          order: 30,
          locale: NS,
        }, SpeakAction)

        registerSlot('dsh-sovits-tts: voice dock', {
          name: 'conversation.composer.dock',
          id: 'sovits-voice',
          order: 91,
          locale: NS,
        }, VoiceDock)

        registerSlot('dsh-sovits-tts: settings section', {
          name: 'settings.section',
          id: 'sovits-tts',
          order: 60,
          label: () => copy('section.label'),
          inject: () => ({}),
        }, SettingsPage)

        } catch (error) {
          reportClientError('apply', error)
        }
      },
    }
    } catch (error) {
      reportClientError('factory', error)
      throw error
    }
  },
})

/**
 * Report a client-side failure to the Host twin, which appends it to
 * `client-errors.log` beside the settings file. The renderer console only
 * exists inside DevTools, so a boot failure would otherwise leave no trace.
 * @param where - label of the surface that failed.
 * @param error - the thrown value.
 */
function reportClientError(where, error) {
  try {
    void fetch('/api/dsh-sovits', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'client-error',
        where: String(where),
        message: String((error && error.message) || error),
        stack: String((error && error.stack) || ''),
        href: String((globalThis.location && globalThis.location.href) || ''),
      }),
    }).catch(() => {})
  } catch {
    // Reporting must never throw.
  }
}
