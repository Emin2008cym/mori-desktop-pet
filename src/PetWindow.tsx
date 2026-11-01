import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { emit, listen } from '@tauri-apps/api/event'
import { LogicalSize, PhysicalPosition, currentMonitor, getAllWindows, getCurrentWindow, primaryMonitor } from '@tauri-apps/api/window'
import { load } from '@tauri-apps/plugin-store'
import { Activity, Archive, ArrowUp, BookOpen, Command, Layers3, LoaderCircle, MessageCircle, Move, Settings2, WandSparkles, X } from 'lucide-react'
import { streamChat, type ChatMode } from './chat-stream'
import { petLayout } from './pet-layout'
import { requestNativeAck } from './native-events'
import './PetWindow.css'

type Message = { role: 'user' | 'assistant'; text: string; memorySuggestion?: string }
const labels = { chat: '对话', plan: 'Plan', sketch: 'Sketch' }
const base = '__TAURI_INTERNALS__' in window ? 'http://127.0.0.1:4179' : ''
async function json(path: string, init?: RequestInit) {
  const response = await fetch(`${base}${path}`, init)
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || '本地服务暂时不可用')
  return result
}

export default function PetWindow() {
  const [hovered, setHovered] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [ready, setReady] = useState(false)
  const [mode, setMode] = useState<ChatMode>('chat')
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [online, setOnline] = useState(false)
  const [frame, setFrame] = useState(() => petLayout({ x: 0, y: 0 }, { x: 0, y: 0, width: 1920, height: 1080 }, 1))
  const anchor = useRef({ x: 0, y: 0 })
  const frameRef = useRef(frame)
  const nativeBusy = useRef(false)
  const layoutQueue = useRef(Promise.resolve())
  const conversationId = useRef('mori-main')
  const sending = useRef(false)
  const collapseTimer = useRef<number | undefined>(undefined)
  const transcript = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const drag = useRef<{ x: number; y: number; moved: boolean } | undefined>(undefined)
  const expanded = hovered || pinned

  const restoreHistory = useCallback(async (id?: string) => {
    const result = await json('/api/conversations')
    const current = id ? result.conversations?.find((item: { id: string }) => item.id === id) : result.conversations?.[0]
    conversationId.current = current?.id || 'mori-main'
    const history = await json(`/api/chat/history?conversationId=${encodeURIComponent(conversationId.current)}`)
    setMessages((history.messages || []).map((item: { role: Message['role']; content: string }) => ({ role: item.role, text: item.content })))
    if (current?.mode) setMode(current.mode)
  }, [])

  useEffect(() => {
    document.documentElement.classList.add('pet-window')
    let disposed = false
    let moved: (() => void) | undefined
    let showChat: (() => void) | undefined
    void (async () => {
      const win = getCurrentWindow()
      const store = await load('mori-settings.json', { autoSave: true })
      const saved = await store.get<{ x: number; y: number }>('petPosition')
      anchor.current = saved || await win.innerPosition()
      moved = await win.onMoved(async ({ payload }) => {
        if (nativeBusy.current) return
        const scale = await win.scaleFactor()
        anchor.current = { x: payload.x + frameRef.current.pet.left * scale, y: payload.y + frameRef.current.pet.top * scale }
        void store.set('petPosition', anchor.current)
      })
      showChat = await listen<{ conversationId?: string; mode?: ChatMode }>('mori:show-chat', async ({ payload }) => {
        if (sending.current) return
        try {
          if (payload.conversationId) await restoreHistory(payload.conversationId)
          if (payload.mode) setMode(payload.mode)
          setPinned(true); setChatOpen(true)
          await win.show(); await win.setFocus()
        } catch { setError('会话无法打开，请检查本地服务。') }
      })
      if (!disposed) setReady(true)
    })().catch((reason) => setError(String(reason)))
    return () => { disposed = true; moved?.(); showChat?.(); window.clearTimeout(collapseTimer.current); document.documentElement.classList.remove('pet-window') }
  }, [restoreHistory])

  useEffect(() => {
    let cancelled = false
    let loaded = false
    const refresh = async () => {
      try {
        const health = await json('/api/health')
        if (cancelled) return
        setOnline(health.model === true)
        if (!loaded && !sending.current) { await restoreHistory(); loaded = true }
      } catch { if (!cancelled) setOnline(false) }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 3000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [restoreHistory])

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    layoutQueue.current = layoutQueue.current.catch(() => undefined).then(async () => {
      if (cancelled) return
      nativeBusy.current = true
      try {
        const win = getCurrentWindow()
        const monitor = await currentMonitor() || await primaryMonitor()
        if (!monitor) throw new Error('无法读取显示器尺寸。')
        const scale = await win.scaleFactor()
        const area = monitor.workArea
        const layout = petLayout(anchor.current, { ...area.position, ...area.size }, scale, expanded ? chatOpen ? 396 : 178 : 0)
        anchor.current = { x: layout.x + layout.pet.left * scale, y: layout.y + layout.pet.top * scale }
        frameRef.current = layout
        flushSync(() => setFrame(layout))
        await win.setSize(new LogicalSize(layout.width, layout.height))
        await win.setPosition(new PhysicalPosition(layout.x, layout.y))
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      } finally { nativeBusy.current = false }
    }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
    return () => { cancelled = true }
  }, [expanded, chatOpen, ready])

  useEffect(() => { transcript.current?.scrollTo({ top: transcript.current.scrollHeight }) }, [messages, busy, chatOpen])

  const enter = () => { window.clearTimeout(collapseTimer.current); setHovered(true) }
  const leave = () => {
    window.clearTimeout(collapseTimer.current)
    collapseTimer.current = window.setTimeout(() => {
      if (nativeBusy.current || panel.current?.contains(document.activeElement)) return
      setHovered(false)
    }, 650)
  }
  const close = () => { input.current?.blur(); setPinned(false); setHovered(false); setChatOpen(false) }
  const openChat = (next: ChatMode) => { enter(); setMode(next); setChatOpen(true); setPinned(true); window.setTimeout(() => input.current?.focus(), 80) }

  const send = async (event: FormEvent) => {
    event.preventDefault()
    const message = draft.trim()
    if (!message || sending.current) return
    sending.current = true; setBusy(true); setPinned(true); setChatOpen(true); setError('')
    setDraft('')
    setMessages((current) => [...current, { role: 'user', text: message }, { role: 'assistant', text: '' }])
    try {
      await streamChat(`${base}/api/chat`, { message, mode, conversationId: conversationId.current }, (text, memorySuggestion) => {
        setMessages((current) => current.map((item, index) => index === current.length - 1 ? { role: 'assistant', text, memorySuggestion } : item))
      })
      void emit('mori:conversation-updated', { conversationId: conversationId.current })
    } catch (reason) {
      const detail = reason instanceof Error && reason.message !== 'Failed to fetch' ? reason.message : '本地服务没有连接。请退出并重新启动 Mori；若仍失败，请查看启动日志。'
      setError(detail)
      setMessages((current) => current.map((item, index) => index === current.length - 1 ? { ...item, text: detail } : item))
    } finally { sending.current = false; setBusy(false) }
  }

  const workbench = async (page = 'overview', settings = false) => {
    try {
      const win = (await getAllWindows()).find((item) => item.label === 'main')
      if (!win) throw new Error('找不到工作台窗口。')
      await win.show(); await win.setFocus()
      await requestNativeAck('mori:main-ready-request', 'mori:main-ready', {}, { retryMs: 200, timeoutMs: 10000 })
      await requestNativeAck('mori:open-workbench', 'mori:open-workbench-ack', { page, settings })
      close()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '无法打开工作台。') }
  }
  const confirmMemory = async (index: number, content: string) => {
    try {
      await json('/api/memories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) })
      setMessages((current) => current.map((item, i) => i === index ? { ...item, memorySuggestion: undefined } : item))
    } catch { setError('记忆保存失败，请重试。') }
  }
  const entries = [
    { title: '对话', Icon: MessageCircle, run: () => openChat('chat') },
    { title: 'Plan', Icon: WandSparkles, run: () => openChat('plan') },
    { title: 'Sketch', Icon: Command, run: () => openChat('sketch') },
    { title: '知识库', Icon: BookOpen, run: () => void workbench('knowledge') },
    { title: '记忆', Icon: Archive, run: () => void workbench('memory') },
    { title: 'OpenClaw', Icon: Activity, run: () => void workbench('tasks', true) },
    { title: '设置', Icon: Settings2, run: () => void workbench('overview', true) },
    { title: '工作台', Icon: Layers3, run: () => void workbench() },
  ]

  return <main className="pet-shell" onMouseLeave={leave}>
    <div className="pet-character" style={frame.pet} onMouseEnter={enter}>
      <button className="pet-grip" title="按住移动桌宠" aria-label="移动桌宠" onPointerDown={(event) => { event.preventDefault(); void getCurrentWindow().startDragging().catch((reason) => setError(String(reason))) }}><Move size={12} /></button>
      <button className={`pet-face ${busy ? 'thinking' : ''}`} title="点击对话，按住拖动" onPointerDown={(event) => { event.preventDefault(); drag.current = { x: event.clientX, y: event.clientY, moved: false } }} onPointerMove={(event) => {
        if (!drag.current || !(event.buttons & 1) || drag.current.moved) return
        if (Math.hypot(event.clientX - drag.current.x, event.clientY - drag.current.y) < 5) return
        drag.current.moved = true
        void getCurrentWindow().startDragging().catch((reason) => setError(String(reason)))
      }} onClick={() => { if (!drag.current?.moved) openChat(mode); drag.current = undefined }}><img draggable={false} src={busy ? '/mori-thinking-transparent.png' : '/mori-wildman-transparent.png'} alt={busy ? 'Mori 正在思考' : 'Mori'} /></button>
      <span className="pet-label">{busy ? '思考中…' : 'Mori'}<i className={online ? 'online' : ''} /></span>
    </div>
    {expanded && <section ref={panel} className="pet-popover" style={frame.panel} onMouseEnter={enter} onFocusCapture={enter} onBlurCapture={leave} aria-label="Mori 对话与快捷入口">
      <header className="pet-popover-head"><span>{online ? '本地 Qwen' : '等待本地模型'}{busy && <LoaderCircle size={12} className="spin" />}</span><button onClick={close} title="收起" aria-label="收起"><X size={14} /></button></header>
      <nav className="pet-shortcuts">{entries.map(({ title, Icon, run }) => <button key={title} onClick={run} title={title}><Icon size={14} /><span>{title}</span></button>)}</nav>
      {chatOpen && <div className="pet-messages" ref={transcript} aria-live="polite">
        {!messages.length && <p className="pet-greeting">我在，想聊点什么？</p>}
        {messages.map((item, index) => <div key={index} className={`pet-message ${item.role}`}><div>{item.text || (busy ? <span className="pet-typing">正在思考<span>···</span></span> : '')}</div>{item.memorySuggestion && <aside>记住：{item.memorySuggestion}<button onClick={() => void confirmMemory(index, item.memorySuggestion!)}>确认保存</button></aside>}</div>)}
      </div>}
      {error && !chatOpen && <div className="pet-error" role="alert">{error}</div>}
      <form className="pet-compose" onSubmit={send}><span className="pet-current-mode">{labels[mode]}</span><input ref={input} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') close() }} onCompositionStart={(event) => event.currentTarget.dataset.composing = 'true'} onCompositionEnd={(event) => { delete event.currentTarget.dataset.composing }} placeholder={mode === 'sketch' ? '接着输入想法…' : '和 Mori 说点什么…'} onKeyDownCapture={(event) => { if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.currentTarget.dataset.composing)) event.preventDefault() }} /><button disabled={busy || !draft.trim()} aria-label="发送" title="发送">{busy ? <LoaderCircle size={15} className="spin" /> : <ArrowUp size={15} />}</button></form>
    </section>}
  </main>
}
