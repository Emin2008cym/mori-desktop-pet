import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import {
  Activity, Archive, ArrowUp, ArrowUpRight, BookOpen, Check, ChevronDown,
  CircleHelp, Clock3, Command, Database, FileText, FolderOpen, Globe2,
  HardDrive, Layers3, LoaderCircle, LockKeyhole, MessageCircle, MoreHorizontal,
  Pause, Play, Plus, Search, Send, Settings2, ShieldCheck, Sparkles, Square, Trash2,
  WandSparkles, X,
} from 'lucide-react'
import './App.css'
import PetWindow from './PetWindow'
import { streamChat } from './chat-stream'
import { emit, listen } from '@tauri-apps/api/event'
import { getAllWindows, getCurrentWindow } from '@tauri-apps/api/window'
import { open as openDialog } from '@tauri-apps/plugin-dialog'

type Mode = 'chat' | 'plan' | 'sketch'
type Page = 'overview' | 'knowledge' | 'memory' | 'tasks'
type Health = { ollama: boolean; model: boolean; gateway: boolean; openclawReady: boolean; openclawAgentId?: string; openclawStatus?: { ready: boolean; message: string; checks: Array<{ id: string; ready: boolean; detail: string }> }; modelName: string; documentCount?: number; chunkCount?: number; error?: string }
type Message = { role: 'user' | 'assistant'; text: string; memorySuggestion?: string }
type Conversation = { id: string; title: string; mode: Mode; messageCount: number; updatedAt: string }
type PetStatus = 'idle' | 'thinking' | 'indexing' | 'operating' | 'waiting' | 'error'
type IndexedDocument = { source: string; name: string; extension: string; chars: number; indexedAt: string }
type IndexResult = { indexed: Array<{ name: string; chars: number; chunks: number }>; rejected: Array<{ name: string; error: string }>; embeddingsAvailable: boolean; documentCount: number; chunkCount: number }
type KnowledgeResult = { source: string; excerpt: string; score: number }

const apiBase = '__TAURI_INTERNALS__' in window ? 'http://127.0.0.1:4179' : ''
const apiUrl = (path: string) => `${apiBase}${path}`
const apiFetch = (path: string, init?: RequestInit) => fetch(apiUrl(path), init)

const modeLabels: Record<Mode, string> = { chat: '对话', plan: 'Plan', sketch: 'Sketch' }
const pageLabels: Record<Page, string> = { overview: '总览', knowledge: '知识库', memory: '记忆', tasks: '任务' }

function DashboardApp() {
  const nativeApp = '__TAURI_INTERNALS__' in window
  const chatWindow = new URLSearchParams(window.location.search).get('chat') === '1'
  const [mode, setMode] = useState<Mode>('chat')
  const [page, setPage] = useState<Page>('overview')
  const [petStatus, setPetStatus] = useState<PetStatus>('idle')
  const [hovered, setHovered] = useState(false)
  const [panelOpen, setPanelOpen] = useState(chatWindow)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [confirmDelegateOpen, setConfirmDelegateOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [conversationId, setConversationId] = useState('mori-main')
  const conversationIdRef = useRef(conversationId)
  const activePromptRef = useRef(false)
  const [historyReady, setHistoryReady] = useState(false)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [conversationSearch, setConversationSearch] = useState('')
  const [conversationResults, setConversationResults] = useState<Array<{ conversationId: string; title: string; messageId: number; role: string; excerpt: string }>>([])
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', text: '早上好，我在这里。你可以问我本地资料，也可以让我先和你一起梳理计划。' },
  ])
  const [health, setHealth] = useState<Health>({ ollama: false, model: false, gateway: false, openclawReady: false, modelName: 'qwen3.5:4b' })
  const [gatewayUrl, setGatewayUrl] = useState('ws://127.0.0.1:18789')
  const [gatewayToken, setGatewayToken] = useState('')
  const [taskToolScopeConfirmed, setTaskToolScopeConfirmed] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [connectMessage, setConnectMessage] = useState('')
  const [manualAuthAvailable, setManualAuthAvailable] = useState(false)
  const [authSource, setAuthSource] = useState('')
  const [activeRun, setActiveRun] = useState('')
  const [activeTask, setActiveTask] = useState('')
  const [pausedTask, setPausedTask] = useState('')
  const [pendingTask, setPendingTask] = useState('')
  const [operationControlBusy, setOperationControlBusy] = useState(false)
  const [operationText, setOperationText] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [now] = useState(() => new Date())
  const formRef = useRef<HTMLFormElement>(null)
  const hideTimer = useRef<number | undefined>(undefined)
  const transcriptRef = useRef<HTMLDivElement>(null)
  const operationTextRef = useRef(operationText)
  const operationConversationId = useRef(conversationId)

  useEffect(() => { operationTextRef.current = operationText }, [operationText])
  useEffect(() => { conversationIdRef.current = conversationId }, [conversationId])

  const refreshConversations = async () => {
    const response = await apiFetch('/api/conversations')
    if (response.ok) setConversations((await response.json()).conversations || [])
  }

  useEffect(() => {
    const refresh = () => apiFetch('/api/health').then((r) => r.json()).then((data: Health) => setHealth(data)).catch(() => setHealth((v) => ({ ...v, ollama: false, model: false, gateway: false, error: '本地服务未启动' })))
    refresh()
    const timer = window.setInterval(refresh, 9000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!nativeApp) return
    document.documentElement.classList.toggle('chat-window', chatWindow)
    let unlisten: (() => void) | undefined
    void getCurrentWindow().onCloseRequested(async (event) => {
      event.preventDefault()
      await getCurrentWindow().hide()
    }).then((stop) => { unlisten = stop })
    return () => { document.documentElement.classList.remove('chat-window'); unlisten?.() }
  }, [nativeApp, chatWindow])

  useEffect(() => {
    let cancelled = false
    const restore = async () => {
      try {
        const response = await apiFetch('/api/conversations')
        if (!response.ok) return
        const result = await response.json() as { conversations: Conversation[] }
        if (cancelled) return
        setConversations(result.conversations || [])
        const current = result.conversations?.[0]
        if (!current) return
        setConversationId(current.id)
        conversationIdRef.current = current.id
        setMode(current.mode || 'chat')
        const history = await apiFetch(`/api/chat/history?conversationId=${encodeURIComponent(current.id)}`)
        const content = await history.json() as { messages?: Array<{ role: 'user' | 'assistant'; content: string }> }
        if (!cancelled) setMessages(content.messages?.length ? content.messages.map((item) => ({ role: item.role, text: item.content })) : [{ role: 'assistant', text: '早上好，我在这里。你可以问我本地资料，也可以让我先和你一起梳理计划。' }])
      } catch { /* The chat remains available if local history cannot be restored. */ }
      finally { if (!cancelled) setHistoryReady(true) }
    }
    void restore()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const events = new EventSource(apiUrl('/api/openclaw/events'))
    events.onmessage = (event) => {
      const payload = JSON.parse(event.data) as { type: string; runId?: string; text?: string; message?: string; ready?: boolean; checks?: Array<{ id: string; ready: boolean; detail: string }> }
      if (payload.type === 'connected') {
        setHealth((v) => ({ ...v, openclawReady: payload.ready === true, openclawStatus: { ready: payload.ready === true, message: payload.text || '', checks: payload.checks || [] } }))
        setConnectMessage(payload.text || 'Gateway 已连接')
      }
      if (payload.type === 'disconnected') setHealth((v) => ({ ...v, openclawReady: false }))
      if (payload.type === 'chat' && (!activeRun || payload.runId === activeRun)) {
        if (payload.text) setOperationText((current) => payload.message === 'completed' || payload.message === 'error' ? payload.text! : current.startsWith(payload.text!) ? current : `${current}${payload.text}`.slice(-12000))
        if (payload.message === 'completed') {
          setPetStatus('idle'); setActiveRun(''); setActiveTask(''); setPausedTask('')
          const reportConversationId = operationConversationId.current
          void apiFetch('/api/openclaw/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ report: payload.text || operationTextRef.current, conversationId: reportConversationId }) })
            .then((response) => response.json())
            .then((result: { ok?: boolean; content?: string }) => {
              if (result.ok && result.content && conversationId === reportConversationId) setMessages((current) => [...current, { role: 'assistant', text: result.content! }])
              void refreshConversations()
            })
            .catch(() => setNotice('任务完成，但结果未能写入本地会话'))
        }
        if (payload.message === 'aborted') { setPetStatus('waiting'); setActiveRun(''); setPausedTask(activeTask); setOperationText((current) => `${current}\n\n[桌面任务已中止]`) }
        if (payload.message === 'error') { setPetStatus('error'); setNotice('OpenClaw 任务出错'); setActiveRun(''); setActiveTask(''); setOperationText((current) => `${current}\n\n[OpenClaw 任务报告错误]`) }
      }
    }
    return () => events.close()
  }, [activeRun, activeTask, conversationId])

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, operationText])

  useEffect(() => {
    if (nativeApp) void emit('mori:status', { status: petStatus })
  }, [nativeApp, petStatus])

  const showInput = () => {
    window.clearTimeout(hideTimer.current)
    setHovered(true)
  }

  const queueHide = () => {
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => {
      if (formRef.current?.contains(document.activeElement)) return
      setHovered(false)
    }, 480)
  }

  const selectConversation = useCallback(async (id: string) => {
    if (!id) return
    const response = await apiFetch(`/api/chat/history?conversationId=${encodeURIComponent(id)}`)
    if (!response.ok) return
    const result = await response.json() as { messages?: Array<{ role: 'user' | 'assistant'; content: string }>; conversation?: Conversation }
    setConversationId(id)
    conversationIdRef.current = id
    setMode(result.conversation?.mode || 'chat')
    setMessages(result.messages?.length ? result.messages.map((item) => ({ role: item.role, text: item.content })) : [{ role: 'assistant', text: '这个会话还没有消息。可以从这里开始。' }])
  }, [])

  const requestChat = (nextMode: Mode = mode, nextConversationId = conversationId) => {
    setMode(nextMode)
    if (nativeApp && !chatWindow) void emit('mori:show-chat', { mode: nextMode, conversationId: nextConversationId })
    else setPanelOpen(true)
  }

  const createConversation = async () => {
    const response = await apiFetch('/api/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'chat' }) })
    if (!response.ok) return
    const created = await response.json() as Conversation
    setConversationId(created.id)
    conversationIdRef.current = created.id
    setMode(created.mode)
    setMessages([{ role: 'assistant', text: '新对话开始了。你希望从哪里开始？' }])
    requestChat(created.mode, created.id)
    await refreshConversations()
  }

  useEffect(() => {
    if (conversationId) void apiFetch(`/api/conversations/${encodeURIComponent(conversationId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) })
  }, [conversationId, mode])

  useEffect(() => {
    const query = conversationSearch.trim()
    if (query.length < 2) return
    let active = true
    const timer = window.setTimeout(() => {
      apiFetch(`/api/conversations/search?q=${encodeURIComponent(query)}`)
        .then((response) => response.ok ? response.json() : Promise.reject(new Error('历史搜索失败。')))
        .then((result) => { if (active) setConversationResults(result.results || []) })
        .catch(() => { if (active) setConversationResults([]) })
    }, 220)
    return () => { active = false; window.clearTimeout(timer) }
  }, [conversationSearch])

  const executePrompt = useCallback(async (prompt: string, promptMode = mode, targetConversationId = conversationId) => {
    if (!prompt || activePromptRef.current || petStatus === 'thinking') return false
    activePromptRef.current = true
    if (!nativeApp || chatWindow) setPanelOpen(true)
    setMessages((current) => [...current, { role: 'user', text: prompt }, { role: 'assistant', text: '' }])
    setPetStatus('thinking')
    try {
      await streamChat(apiUrl('/api/chat'), { mode: promptMode, message: prompt, conversationId: targetConversationId }, (text, memorySuggestion) => {
        setMessages((current) => current.map((message, index) => index === current.length - 1 ? { ...message, text, memorySuggestion } : message))
      })
      void refreshConversations()
      setPetStatus('idle')
      return true
    } catch (error) {
      const detail = error instanceof Error ? error.message : '模型请求失败'
      setMessages((current) => current.map((message, index) => index === current.length - 1 ? { ...message, text: `本地模型暂时没有回应：${detail}` } : message))
      setPetStatus('error')
      return false
    } finally {
      activePromptRef.current = false
    }
  }, [conversationId, mode, petStatus, nativeApp, chatWindow])
  const executePromptRef = useRef(executePrompt)

  const indexFiles = async (files: File[]) => {
    setPetStatus('indexing')
    try {
      const formData = new FormData()
      for (const file of files) formData.append('files', file, (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name)
      const response = await apiFetch('/api/knowledge/index', { method: 'POST', body: formData })
      const result = await response.json() as IndexResult & { error?: string }
      if (!response.ok) throw new Error(result.error || '索引失败。')
      setHealth((current) => ({ ...current, documentCount: result.documentCount, chunkCount: result.chunkCount }))
      return result
    } finally { setPetStatus((current) => current === 'indexing' ? 'idle' : current) }
  }

  useEffect(() => { executePromptRef.current = executePrompt }, [executePrompt])

  const sendPrompt = (event?: FormEvent) => {
    event?.preventDefault()
    const prompt = draft.trim()
    if (!prompt || petStatus === 'thinking') return
    setDraft('')
    void executePrompt(prompt)
  }

  const confirmMemorySuggestion = async (index: number, content: string) => {
    const response = await apiFetch('/api/memories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) })
    const result = await response.json()
    if (!response.ok) { setNotice(result.error || '记忆保存失败'); return }
    setMessages((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, memorySuggestion: undefined } : item))
    setNotice('已保存这条长期记忆')
  }

  useEffect(() => {
    if (!nativeApp || !historyReady) return
    let unlistenReady: (() => void) | undefined
    let unlistenMainReady: (() => void) | undefined
    let unlistenChat: (() => void) | undefined
    let unlistenPrompt: (() => void) | undefined
    let unlistenWorkbench: (() => void) | undefined
    const answer = (eventName: string, requestId: string, values: Record<string, unknown> = {}) =>
      emit(eventName, { requestId, ok: true, ...values })

    if (chatWindow) {
      void listen<{ requestId: string }>('mori:chat-ready-request', (event) => {
        void answer('mori:chat-ready', event.payload.requestId, { conversationId: conversationIdRef.current })
      }).then((stop) => { unlistenReady = stop })
      void listen<{ mode?: Mode; conversationId?: string; requestId: string }>('mori:show-chat', async (event) => {
        try {
          setPanelOpen(true)
          if (event.payload.conversationId) await selectConversation(event.payload.conversationId)
          if (event.payload.mode) setMode(event.payload.mode)
          await getCurrentWindow().show()
          await getCurrentWindow().setFocus()
          await answer('mori:show-chat-ack', event.payload.requestId, { conversationId: conversationIdRef.current })
        } catch (error) {
          await emit('mori:show-chat-ack', { requestId: event.payload.requestId, ok: false, error: error instanceof Error ? error.message : '聊天窗口无法打开。' })
        }
      }).then((stop) => { unlistenChat = stop })
      void listen<{ message: string; mode: Mode; conversationId: string; requestId: string }>('mori:prompt', async (event) => {
        try {
          const { message, mode: promptMode, conversationId: targetId } = event.payload
          if (!message.trim()) throw new Error('输入内容为空。')
          if (activePromptRef.current) throw new Error('上一条消息仍在生成，请稍候。')
          if (targetId !== conversationIdRef.current) await selectConversation(targetId)
          setMode(promptMode)
          await getCurrentWindow().show()
          await getCurrentWindow().setFocus()
          const response = executePromptRef.current(message, promptMode, targetId)
          if (!activePromptRef.current) throw new Error('当前会话暂时无法接收消息。')
          await answer('mori:prompt-accepted', event.payload.requestId, { conversationId: targetId })
          void response
        } catch (error) {
          await emit('mori:prompt-accepted', { requestId: event.payload.requestId, ok: false, error: error instanceof Error ? error.message : '消息未能发送。' })
        }
      }).then((stop) => { unlistenPrompt = stop })
    } else {
      void listen<{ requestId: string }>('mori:main-ready-request', (event) => {
        void answer('mori:main-ready', event.payload.requestId)
      }).then((stop) => { unlistenMainReady = stop })
      void listen<{ page?: Page; settings?: boolean; requestId: string }>('mori:open-workbench', async (event) => {
        try {
          if (event.payload.page) setPage(event.payload.page)
          if (event.payload.settings) setSettingsOpen(true)
          const mainWindow = (await getAllWindows()).find((item) => item.label === 'main')
          if (!mainWindow) throw new Error('工作台窗口不存在。')
          await mainWindow.show()
          await mainWindow.setFocus()
          await answer('mori:open-workbench-ack', event.payload.requestId)
        } catch (error) {
          await emit('mori:open-workbench-ack', { requestId: event.payload.requestId, ok: false, error: error instanceof Error ? error.message : '工作台无法打开。' })
        }
      }).then((stop) => { unlistenWorkbench = stop })
    }
    return () => { unlistenReady?.(); unlistenMainReady?.(); unlistenChat?.(); unlistenPrompt?.(); unlistenWorkbench?.() }
  }, [nativeApp, chatWindow, historyReady, selectConversation])

  const connectOpenClaw = async (event: FormEvent) => {
    event.preventDefault()
    setConnecting(true)
    setConnectMessage('正在连接本机 Gateway…')
    try {
      const response = await apiFetch('/api/openclaw/connect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: gatewayUrl, ...(gatewayToken.trim() ? { token: gatewayToken.trim() } : {}) }),
      })
      const result = await response.json() as { ok: boolean; ready?: boolean; checks?: Array<{ id: string; ready: boolean; detail: string }>; message?: string; error?: string; errorCode?: string; authSource?: string; manualAuthAvailable?: boolean }
      if (!response.ok || !result.ok) {
        setHealth((v) => ({ ...v, openclawReady: false }))
        setAuthSource('')
        setManualAuthAvailable(result.manualAuthAvailable === true)
        setConnectMessage(result.error || '连接失败')
        return
      }
      setManualAuthAvailable(false)
      setAuthSource(result.authSource === 'local-config' ? '已从本机 OpenClaw 配置认证' : '已使用手动令牌认证')
      setHealth((v) => ({ ...v, openclawReady: result.ready === true, openclawStatus: { ready: result.ready === true, message: result.message || '', checks: result.checks || [] } }))
      setConnectMessage(result.message || (result.ready ? 'OpenClaw 已就绪' : 'Gateway 已认证，桌面能力尚未就绪'))
      setGatewayToken('')
    } catch {
      setManualAuthAvailable(true)
      setConnectMessage('Mori 本地服务无响应。请确认应用服务正在运行后重试。')
    } finally { setConnecting(false) }
  }

  const delegateTask = async () => {
    const request = pendingTask || [...messages].reverse().find((item) => item.role === 'user')?.text
    if (!request || !health.openclawReady) return
    setConfirmDelegateOpen(false)
    setPendingTask('')
    setActiveTask(request)
    operationConversationId.current = conversationId
    setPausedTask('')
    setPetStatus('operating')
    setOperationText('正在提交到 OpenClaw…')
    try {
      const response = await apiFetch('/api/openclaw/delegate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: request }),
      })
      const result = await response.json() as { ok: boolean; runId?: string; error?: string }
      if (!response.ok || !result.ok || !result.runId) throw new Error(result.error || '提交失败')
      setActiveRun(result.runId)
      setOperationText('OpenClaw 正在观察桌面并执行任务。你可以随时停止并接管。')
      setNotice('桌面控制已交给 OpenClaw')
    } catch (error) {
      setActiveTask('')
      setPetStatus('error')
      setOperationText(error instanceof Error ? error.message : 'OpenClaw 任务提交失败')
    }
  }

  const openDelegateReview = (task?: string) => {
    setPendingTask(task || [...messages].reverse().find((item) => item.role === 'user')?.text || '')
    setTaskToolScopeConfirmed(false)
    setConfirmDelegateOpen(true)
    setPetStatus('waiting')
  }
  const closeDelegateReview = () => { setConfirmDelegateOpen(false); setPendingTask(''); setPetStatus((current) => current === 'waiting' ? 'idle' : current) }

  const abortOperation = async () => {
    if (!activeRun) return false
    setOperationControlBusy(true)
    try {
      const response = await apiFetch('/api/openclaw/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId: activeRun }) })
      const result = await response.json() as { ok: boolean; error?: string }
      if (!response.ok || !result.ok) throw new Error(result.error || 'OpenClaw 没有确认停止。')
      setActiveRun('')
      return true
    } catch (error) {
      setPetStatus('error')
      setOperationText(`无法确认桌面任务已停止：${error instanceof Error ? error.message : '停止请求失败'}`)
      setNotice('停止请求失败，请检查 OpenClaw 控制台并手动接管')
      return false
    } finally { setOperationControlBusy(false) }
  }

  const pauseOperation = async () => {
    if (!await abortOperation()) return
    setPausedTask(activeTask)
    setPetStatus('waiting')
    setOperationText('已暂停并交还桌面控制。继续前需要重新确认任务。')
    setNotice('桌面任务已暂停，可以手动接管')
  }

  const stopOperation = async () => {
    if (!await abortOperation()) return
    setActiveTask('')
    setPausedTask('')
    setPetStatus('idle')
    setOperationText('已停止。现在由你操作桌面。')
    setNotice('已停止自动操作，可以手动接管')
  }

  const resumeOperation = () => openDelegateReview(`请继续执行这条已暂停的桌面任务。先重新观察当前屏幕，确认现状后再操作；原任务是：${pausedTask}`)

  const openPage = (next: Page) => { setPage(next); if (!nativeApp) setPanelOpen(next !== 'overview') }

  const closeChat = () => {
    if (chatWindow) void getCurrentWindow().hide()
    else setPanelOpen(false)
  }

  const pageTitle = page === 'overview' ? '你的本地智能体' : pageLabels[page]

  return (
    <main className="desktop-app">
      <aside className="sidebar">
        <div className="brand-lockup"><div className="brand-mark"><Sparkles size={17} /></div><div><strong>mori</strong><span>PERSONAL AI</span></div></div>
        <div className="nav-caption">工作台</div>
        <nav className="main-nav" aria-label="主要导航">
          {(['overview', 'knowledge', 'memory', 'tasks'] as Page[]).map((item) => {
            const Icon = item === 'overview' ? Layers3 : item === 'knowledge' ? BookOpen : item === 'memory' ? Archive : Activity
            return <button key={item} className={page === item ? 'nav-item active' : 'nav-item'} onClick={() => openPage(item)}><Icon size={17} /><span>{pageLabels[item]}</span>{item === 'tasks' && <i className="nav-count">2</i>}</button>
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-note"><ShieldCheck size={16} /><span>本地运行<br /><b>资料保留在这台电脑</b></span></div>
          <button className="profile-button" onClick={() => setSettingsOpen(true)}><div className="profile-avatar">林</div><div><strong>我的空间</strong><span>本机 · 私人</span></div><MoreHorizontal size={17} /></button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="breadcrumb"><span>工作台</span><span className="crumb-slash">/</span><b>{pageTitle}</b></div>
          <div className="top-actions">
            <div className="model-chip"><span className={health.model ? 'connection-dot live' : 'connection-dot'} /><span>{health.modelName}</span><ChevronDown size={14} /></div>
            <button className="gateway-chip" onClick={() => setSettingsOpen(true)}><span className={health.openclawReady ? 'connection-dot live coral' : 'connection-dot coral'} />OpenClaw <span className="gateway-status">{health.openclawReady ? '已连接' : '未连接'}</span></button>
            <button className="icon-button top-settings" title="连接设置" onClick={() => setSettingsOpen(true)}><Settings2 size={17} /></button>
          </div>
        </header>

        <div className="page-scroll">
          <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" />本机智能体 <span className="private-pill"><LockKeyhole size={11} /> PRIVATE</span></div><h1>{page === 'overview' ? '早上好，林。' : pageTitle}</h1><p>{page === 'overview' ? '你的本地 AI 已准备好，今天想从哪里开始？' : page === 'knowledge' ? '连接到你的本地资料，只在需要时查找相关内容。' : page === 'memory' ? '你和 Mori 一起整理的偏好与长期上下文。' : '正在进行和等待你确认的工作。'}</p></div><div className="date-block"><span>本机时间</span><strong>{new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(now)}</strong><small>{new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(now)}</small></div></div>

          {page === 'overview' && <>
            <section className="hero-stage">
              <div className="hero-copy"><div className="online-label"><span className="pulse-dot" />{health.model ? '本地模型在线' : '等待本地模型'}</div><h2>我是 Mori。<br /><em>你的私人智能体。</em></h2><p>我在本机运行，可以帮你检索资料、一起梳理计划，也能把桌面操作交给 OpenClaw 完成。</p><div className="hero-buttons"><button className="primary-button" onClick={() => requestChat('chat')}><MessageCircle size={16} />开始对话</button><button className="text-button" onClick={() => requestChat('plan')}>先做个计划 <ArrowUpRight size={15} /></button></div><div className="hero-foot"><span><LockKeyhole size={13} />内容留在本机</span><span><HardDrive size={13} />Ollama · {health.modelName}</span></div></div>
              <div className="hero-mascot-wrap"><img className={`hero-mascot status-${petStatus}`} src="/mori-wildman-transparent.png" alt="黑白野人 Mori 桌宠" /><div className="speech-tag"><span className="mini-spark">✦</span> 我在听</div><div className="mascot-caption"><strong>Mori</strong><span>本地陪伴 · 随时可唤醒</span></div></div>
              <div className="hero-index"><div className="index-icon"><Database size={17} /></div><div><strong>本地知识</strong><span>等待添加授权来源</span></div><button onClick={() => openPage('knowledge')} aria-label="管理知识来源"><ArrowUpRight size={16} /></button></div>
            </section>

            <section className="section-block">
              <div className="section-heading"><div><span className="section-overline">QUICK ACCESS</span><h3>从这里继续</h3></div><button className="quiet-link" onClick={() => openPage('tasks')}>查看全部 <ArrowUpRight size={14} /></button></div>
              <div className="quick-grid">
                <button className="quick-item" onClick={() => requestChat('plan')}><div className="quick-icon amber"><WandSparkles size={17} /></div><div><strong>整理一个计划</strong><span>逐步澄清目标与约束</span></div><ArrowUpRight size={15} /></button>
                <button className="quick-item" onClick={() => requestChat('sketch')}><div className="quick-icon teal"><Command size={17} /></div><div><strong>继续自由构思</strong><span>提示可以边聊边追加</span></div><ArrowUpRight size={15} /></button>
                <button className="quick-item" onClick={() => setSettingsOpen(true)}><div className="quick-icon coral"><Play size={17} /></div><div><strong>连接 OpenClaw</strong><span>委派可见的桌面操作</span></div><ArrowUpRight size={15} /></button>
              </div>
            </section>

            <section className="section-block lower-sections">
              <div className="section-heading"><div><span className="section-overline">YOUR SPACE</span><h3>个人资料空间</h3></div><button className="quiet-link" onClick={() => openPage('knowledge')}>管理来源 <ArrowUpRight size={14} /></button></div>
              <div className="source-row"><div className="source-icon"><FolderOpen size={18} /></div><div className="source-info"><strong>本地文件知识库</strong><span>{health.documentCount || 0} 个来源 · {health.chunkCount || 0} 个检索片段</span></div><span className="source-state"><i />{health.documentCount ? '已索引' : '未连接'}</span><button className="source-action" onClick={() => openPage('knowledge')}>{health.documentCount ? '管理来源' : '添加来源'} <Plus size={14} /></button></div>
              <div className="source-row"><div className="source-icon browser"><Globe2 size={18} /></div><div className="source-info"><strong>浏览器书签导出</strong><span>导入 Edge/Chrome 书签 HTML · 不读取密码和 Cookie</span></div><span className="source-state"><i />手动导入</span><button className="source-action" onClick={() => openPage('knowledge')}>选择文件 <Plus size={14} /></button></div>
              <div className="source-row"><div className="source-icon mail"><FileText size={18} /></div><div className="source-info"><strong>本地邮件文件</strong><span>MBOX · EML · 只读文本索引</span></div><span className="source-state"><i />手动导入</span><button className="source-action" onClick={() => openPage('knowledge')}>选择文件 <Plus size={14} /></button></div>
            </section>
          </>}

          {page === 'knowledge' && <KnowledgePage search={search} setSearch={setSearch} onIndex={indexFiles} nativeApp={nativeApp} />}
          {page === 'memory' && <MemoryPage />}
          {page === 'tasks' && <TasksPage connected={health.openclawReady} onConnect={() => setSettingsOpen(true)} onResume={() => requestChat()} />}

          <footer className="page-footer"><span><ShieldCheck size={14} />隐私优先 · 本机数据</span><span>Qwen 3.5 <b>·</b> Ollama <b>·</b> OpenClaw</span></footer>
        </div>
      </section>

      {!nativeApp && <div className="floating-pet" onMouseEnter={showInput} onMouseLeave={queueHide}>
        {hovered && <form className="hover-composer" ref={formRef} onSubmit={sendPrompt}>
          <div className="composer-topline"><span><i className="live-tiny" />{modeLabels[mode]} <span className="composer-sep">·</span> 私人对话</span><button type="button" title="打开完整对话" onClick={() => setPanelOpen(true)}><ArrowUpRight size={14} /></button></div>
          <div className="composer-input-row"><input aria-label="给 Mori 输入提示" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={mode === 'plan' ? '先说说你要完成什么…' : mode === 'sketch' ? '接着输入想法…' : '问问你的私人 AI…'} onFocus={() => setPanelOpen((open) => open)} /><button className="send-button" type="submit" disabled={!draft.trim() || petStatus === 'thinking'} title="发送"><ArrowUp size={16} /></button></div>
          <div className="composer-modes">{(['chat', 'plan', 'sketch'] as Mode[]).map((item) => <button key={item} type="button" className={mode === item ? 'mode-chip selected' : 'mode-chip'} onClick={() => setMode(item)}>{item === 'chat' ? <MessageCircle size={12} /> : item === 'plan' ? <WandSparkles size={12} /> : <Command size={12} />}{modeLabels[item]}</button>)}<span className="shortcut-hint">Enter ↵</span></div>
        </form>}
        <div className="pet-caption-bubble" aria-live="polite">{petStatus === 'thinking' ? <><LoaderCircle size={13} className="spin" />我在想…</> : petStatus === 'indexing' ? <><Database size={13} />正在整理资料</> : petStatus === 'operating' ? <><Activity size={13} />正在操作桌面</> : petStatus === 'error' ? <><CircleHelp size={13} />需要检查连接</> : petStatus === 'waiting' ? <><Clock3 size={13} />等你确认</> : '嗨，想聊聊吗？'}</div>
        <button className={`pet-button status-${petStatus}`} aria-label="展开 Mori 桌宠" onClick={() => setPanelOpen((v) => !v)}><img src="/mori-wildman-transparent.png" alt="" /><span className="pet-status-indicator" /></button>
      </div>}

      {panelOpen && (!nativeApp || chatWindow) && <section className="chat-panel" aria-label="Mori 对话面板">
        <div className="chat-panel-head"><div className="chat-title"><div className="chat-avatar"><img src="/mori-wildman-transparent.png" alt="" /></div><div><strong>Mori <span className="verified"><Check size={10} /></span></strong><span>{petStatus === 'operating' ? 'OpenClaw 正在操作桌面' : '本地私人智能体'}</span></div></div><div className="chat-head-actions"><button title="新建对话" onClick={() => void createConversation()}><Plus size={16} /></button><button title="关闭" onClick={closeChat}><X size={17} /></button></div></div>
        <div className="chat-mode-tabs">{(['chat', 'plan', 'sketch'] as Mode[]).map((item) => <button key={item} className={mode === item ? 'chat-tab selected' : 'chat-tab'} onClick={() => setMode(item)}>{modeLabels[item]}</button>)}</div>
        <div className="conversation-toolbar"><select aria-label="选择会话" value={conversationId} onChange={(event) => void selectConversation(event.target.value)}>{conversations.map((item) => <option value={item.id} key={item.id}>{item.title || '新对话'}</option>)}</select><label><Search size={12} /><input value={conversationSearch} onChange={(event) => setConversationSearch(event.target.value)} placeholder="搜索历史对话" /></label></div>
        {conversationSearch.trim().length >= 2 && conversationResults.length > 0 && <div className="conversation-search-results">{conversationResults.map((item) => <button key={`${item.conversationId}-${item.messageId}`} onClick={() => { void selectConversation(item.conversationId); setConversationSearch(''); setPanelOpen(true) }}><strong>{item.title}</strong><span>{item.excerpt}</span></button>)}</div>}
        <div className="transcript" ref={transcriptRef}>
          <div className="conversation-date"><span />今天<span /></div>
          {messages.map((message, index) => <div key={`${index}-${message.role}`} className={`message-row ${message.role}`}><div className="message-avatar">{message.role === 'assistant' ? <img src="/mori-wildman-transparent.png" alt="" /> : '林'}</div><div className="message-body"><span className="message-author">{message.role === 'assistant' ? 'Mori' : '你'} <small>{message.role === 'assistant' ? '· 本机' : ''}</small></span><div className={`message-text ${!message.text ? 'streaming' : ''}`}>{message.text || <><i /><i /><i /></>}</div>{message.memorySuggestion && <div className="memory-suggestion-card"><span>记住这条长期事实？</span><p>{message.memorySuggestion}</p><button onClick={() => void confirmMemorySuggestion(index, message.memorySuggestion!)}><Check size={12} />确认保存</button></div>}</div></div>)}
          {operationText && <div className="operation-card"><div className="operation-head"><span className="operation-pulse" />桌面委派 <span className="operation-via">OpenClaw</span>{activeRun && <><button disabled={operationControlBusy} title="暂停并接管" onClick={() => void pauseOperation()}><Pause size={12} />暂停</button><button disabled={operationControlBusy} title="停止并接管" onClick={() => void stopOperation()}><Square size={11} fill="currentColor" />停止</button></>}{!activeRun && pausedTask && <button title="重新确认后继续" onClick={resumeOperation}><Play size={11} />继续</button>}</div><p>{operationText}</p>{!activeRun && !pausedTask && operationText.startsWith('已停止') && <span className="handoff-label"><Check size={12} />控制权已交还给你</span>}</div>}
          {messages.some((item) => item.role === 'user' && /(打开|点击|鼠标|桌面|网页|浏览器|填写|操作电脑|帮我操作|关掉|启动)/.test(item.text)) && <div className="delegate-nudge"><div><MonitorGlyph /><span><b>需要操作当前桌面？</b><small>将任务交给 OpenClaw，以可见的鼠标和键盘完成。</small></span></div><button disabled={!health.openclawReady || !!activeRun} onClick={() => openDelegateReview()}>{activeRun ? '正在操作' : '交给 OpenClaw'}<ArrowUpRight size={14} /></button></div>}
        </div>
        <form className="panel-composer" onSubmit={sendPrompt}><textarea value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendPrompt() } }} placeholder={mode === 'sketch' ? '继续输入，按 Enter 追加…' : '写下你的问题…'} rows={2} /><div className="panel-composer-foot"><div><span className="local-lock"><LockKeyhole size={12} />本地对话</span><span className="composer-hint">Shift + Enter 换行</span></div><button className="panel-send" type="submit" disabled={!draft.trim() || petStatus === 'thinking'} aria-label="发送"><Send size={15} /></button></div></form>
        <div className="panel-bottom"><span><span className="connection-dot live" />Ollama · {health.modelName}</span><button onClick={() => setSettingsOpen(true)}>连接设置 <ArrowUpRight size={12} /></button></div>
      </section>}

      {settingsOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false) }}><section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title"><header className="modal-heading"><div><span className="section-overline">LOCAL CONNECTOR</span><h2 id="settings-title">连接 OpenClaw</h2></div><button className="icon-button" onClick={() => setSettingsOpen(false)} aria-label="关闭"><X size={17} /></button></header><p className="modal-intro">Mori 优先从本机 OpenClaw 配置认证，令牌不会显示或保存。首次配对凭据保存在 Windows 凭据管理器中。</p><form className="connector-form" onSubmit={connectOpenClaw}><label>Gateway 地址<input value={gatewayUrl} onChange={(e) => setGatewayUrl(e.target.value)} spellCheck={false} /></label>{manualAuthAvailable && <details className="manual-auth"><summary>手动高级入口</summary><label>Gateway 令牌<input value={gatewayToken} onChange={(e) => setGatewayToken(e.target.value)} type="password" autoComplete="off" placeholder="仅用于本次本机连接，不会保存" /></label></details>}<button className="primary-button connect-submit" disabled={connecting}>{connecting ? <LoaderCircle size={15} className="spin" /> : <PlugGlyph />}{connecting ? '正在检查 Gateway 与桌面权限…' : '连接并检查就绪状态'}</button></form>{authSource && <p className="auth-source"><LockKeyhole size={12} />{authSource}</p>}{connectMessage && <div className={health.openclawReady ? 'connection-result good' : 'connection-result'}>{health.openclawReady && <Check size={14} />}{connectMessage}{health.openclawStatus?.checks.filter((check) => !check.ready).map((check) => <small key={check.id}>{check.detail}</small>)}</div>}<div className="scope-note"><ShieldCheck size={15} /><span>执行前要求专用 desktop Agent、computer 工具策略和 Windows 桌面节点同时就绪。缺少任一项都不能委派。</span></div></section></div>}

      {confirmDelegateOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDelegateReview() }}><section className="settings-modal confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delegate-title"><header className="modal-heading"><div><span className="section-overline">VISIBLE DESKTOP CONTROL</span><h2 id="delegate-title">确认桌面委派</h2></div><button className="icon-button" onClick={closeDelegateReview} aria-label="关闭"><X size={17} /></button></header><p className="modal-intro">即将把下面这条完整任务交给已验证的 OpenClaw Agent「{health.openclawAgentId || 'desktop'}」。执行期间你可以暂停、停止或手动接管。</p><blockquote className="delegate-review">{pendingTask}</blockquote><label className="safety-check task-scope-check"><input type="checkbox" checked={taskToolScopeConfirmed} onChange={(event) => setTaskToolScopeConfirmed(event.target.checked)} /><span><b>我已检查上面的任务全文，并同意本次可见桌面操作。</b></span></label><p className="approval-caution">发送、提交、付款、删除、发布或其他高影响动作前，Agent 必须先停下请求确认。Mori 会显示实时执行状态；请保持监督，或随时暂停并接管。</p><div className="delegate-review-actions"><button className="secondary-button" onClick={closeDelegateReview}>返回修改</button><button className="primary-button" disabled={!health.openclawReady || !!activeRun || !pendingTask || !taskToolScopeConfirmed} onClick={() => void delegateTask()}>确认并开始 <ArrowUpRight size={14} /></button></div></section></div>}

      {notice && <div className="toast"><Check size={15} />{notice}<button onClick={() => setNotice('')} aria-label="关闭提示"><X size={14} /></button></div>}
    </main>
  )
}

function KnowledgePage({ search, setSearch, onIndex, nativeApp }: { search: string; setSearch: (value: string) => void; onIndex: (files: File[]) => Promise<IndexResult>; nativeApp: boolean }) {
  const [documents, setDocuments] = useState<IndexedDocument[]>([])
  const [roots, setRoots] = useState<Array<{ path: string; addedAt: string }>>([])
  const [suggestedRoots, setSuggestedRoots] = useState<string[]>([])
  const [selectedRoots, setSelectedRoots] = useState<string[]>([])
  const [onboardingOpen, setOnboardingOpen] = useState(false)
  const [results, setResults] = useState<KnowledgeResult[]>([])
  const [searching, setSearching] = useState(false)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  const refresh = () => apiFetch('/api/knowledge/documents').then((response) => response.json()).then((result) => setDocuments(result.documents || [])).catch(() => setDocuments([]))
  const refreshRoots = async () => {
    const [rootResponse, folderResponse] = await Promise.all([apiFetch('/api/knowledge/roots'), apiFetch('/api/knowledge/folders')])
    if (!rootResponse.ok || !folderResponse.ok) return
    const saved = (await rootResponse.json()).roots as Array<{ path: string; addedAt: string }>
    const candidates = (await folderResponse.json()).folders as string[]
    setRoots(saved)
    setSuggestedRoots(candidates)
    setSelectedRoots(candidates.filter((path) => !saved.some((root) => root.path.toLowerCase() === path.toLowerCase())))
    if (!saved.length && candidates.length) setOnboardingOpen(true)
  }

  useEffect(() => {
    void refresh()
    void refreshRoots()
    const events = new EventSource(apiUrl('/api/openclaw/events'))
    events.onmessage = (event) => {
      const payload = JSON.parse(event.data) as { type: string; completed?: number; total?: number; failed?: number; message?: string }
      if (payload.type === 'index-progress') setFeedback(`正在索引 ${payload.completed} / ${payload.total} 个文件${payload.failed ? ` · ${payload.failed} 个暂不可读取` : ''}`)
      if (payload.type === 'index-complete') { setFeedback('目录扫描完成'); void refresh() }
      if (payload.type === 'index-error') setFeedback(payload.message || '目录扫描失败。')
    }
    return () => events.close()
  }, [])

  useEffect(() => {
    const query = search.trim()
    if (query.length < 2) return
    let active = true
    const timer = window.setTimeout(() => {
      apiFetch(`/api/knowledge/search?q=${encodeURIComponent(query)}`)
        .then((response) => response.ok ? response.json() : Promise.reject(new Error('知识库搜索失败。')))
        .then((result: { results?: KnowledgeResult[] }) => { if (active) setResults(result.results || []) })
        .catch(() => { if (active) setResults([]) })
        .finally(() => { if (active) setSearching(false) })
    }, 250)
    return () => { active = false; window.clearTimeout(timer) }
  }, [search, documents])

  const addFiles = async (list: FileList | null) => {
    if (!list?.length) return
    setBusy(true)
    setFeedback(`正在读取 ${list.length} 个文件…`)
    try {
      const result = await onIndex(Array.from(list))
      await refresh()
      const indexed = result.indexed.length
      const rejected = result.rejected.length
      setFeedback(`${indexed} 个文件已索引 · ${result.chunkCount} 个检索片段${result.embeddingsAvailable ? ' · 语义检索可用' : ' · 关键词检索可用'}` + (rejected ? ` · ${rejected} 个文件未能解析` : ''))
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : '索引失败。')
    } finally {
      setBusy(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const addRoot = async (path: string) => {
    const response = await apiFetch('/api/knowledge/roots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || '无法授权此目录。')
    await refreshRoots()
    setFeedback(`已授权目录：${path}`)
  }

  const chooseRoot = async () => {
    if (!nativeApp) { setFeedback('递归目录索引需要使用 Mori 桌面应用。'); return }
    try {
      const selected = await openDialog({ directory: true, multiple: false, title: '选择要索引的内容目录' })
      if (typeof selected === 'string') await addRoot(selected)
    } catch (error) { setFeedback(error instanceof Error ? error.message : '选择文件夹失败。') }
  }

  const addSelectedRoots = async () => {
    setBusy(true)
    try {
      for (const path of selectedRoots) await addRoot(path)
      setOnboardingOpen(false)
      setFeedback('已授权所选目录，正在递归建立本地索引。')
    } catch (error) { setFeedback(error instanceof Error ? error.message : '授权目录失败。') }
    finally { setBusy(false) }
  }

  const removeRoot = async (path: string) => {
    await apiFetch('/api/knowledge/roots', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) })
    await Promise.all([refreshRoots(), refresh()])
  }

  const scanRoots = async () => {
    const response = await apiFetch('/api/knowledge/scan', { method: 'POST' })
    if (!response.ok) { setFeedback('无法开始目录扫描。'); return }
    setFeedback('正在检查授权目录中的新增和变更文件…')
  }

  const removeDocument = async (source: string) => {
    await apiFetch('/api/knowledge/documents', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source }) })
    await refresh()
  }

  const filtered = documents.filter((item) => `${item.source} ${item.extension}`.toLowerCase().includes(search.toLowerCase()))
  return <div className="subpage">
    <div className="knowledge-toolbar"><label className="search-box"><Search size={16} /><input value={search} onChange={(event) => { setSearch(event.target.value); setSearching(event.target.value.trim().length >= 2); if (event.target.value.trim().length < 2) setResults([]) }} placeholder="搜索知识内容或来源" /></label><button className="primary-button" disabled={busy || !roots.length} onClick={() => void scanRoots()}>{busy ? <LoaderCircle size={15} className="spin" /> : <Database size={15} />}扫描授权目录</button><button className="secondary-button" disabled={busy} onClick={() => void chooseRoot()}><FolderOpen size={15} />授权文件夹</button><button className="secondary-button" disabled={busy} onClick={() => fileInput.current?.click()}><Plus size={15} />添加文件</button><input ref={fileInput} className="visually-hidden" type="file" multiple accept=".pdf,.docx,.xlsx,.pptx,.txt,.md,.markdown,.csv,.tsv,.json,.html,.htm,.eml,.mbox,.log,.xml,.yaml,.yml,.js,.jsx,.ts,.tsx,.py,.go,.rs,.java,.kt,.css,.sql,.png,.jpg,.jpeg,.webp,.mp3,.wav,.m4a,.aac,.flac,.ogg,.mp4,.mov,.mkv,.avi,.webm" onChange={(event) => void addFiles(event.target.files)} /></div>
    {onboardingOpen && <section className="root-onboarding"><div><span className="section-overline">本地索引授权</span><strong>选择 Mori 可以递归检索的个人目录。</strong><small>系统和程序目录、AppData、凭据文件会自动排除；音视频只登记文件信息。</small></div><div className="root-choice-list">{suggestedRoots.map((path) => <label key={path}><input type="checkbox" checked={selectedRoots.includes(path)} onChange={(event) => setSelectedRoots((current) => event.target.checked ? [...current, path] : current.filter((item) => item !== path))} /><span>{path.split(/[\\/]/).at(-1)}</span><small>{path}</small></label>)}</div><div className="root-onboarding-actions"><button className="secondary-button" onClick={() => void chooseRoot()}><FolderOpen size={14} />选择其他目录</button><button className="primary-button" disabled={busy || !selectedRoots.length} onClick={() => void addSelectedRoots()}>{busy ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}授权并开始索引</button></div></section>}
    {roots.length > 0 && <section className="root-list"><div className="root-list-head"><strong>递归索引目录</strong><span>{roots.length} 个已授权</span></div>{roots.map((root) => <div className="root-item" key={root.path}><FolderOpen size={14} /><span>{root.path}</span><button className="icon-button" onClick={() => void removeRoot(root.path)} title="停止索引并移除此目录" aria-label="停止索引并移除此目录"><X size={13} /></button></div>)}</section>}
    <div className="knowledge-summary"><div><span className="section-overline">KNOWLEDGE INDEX</span><h2>资料在本机建立索引。</h2><p>文档和图片内容可搜索；音视频首版只记录文件信息。</p></div><div className="summary-count"><strong>{documents.length}</strong><span>已索引来源</span></div></div>
    {feedback && <div className="index-feedback"><Activity size={14} />{feedback}</div>}
    <div className="source-table"><div className="table-heading"><span>来源</span><span>内容类型</span><span>状态</span><span>操作</span></div>
      {filtered.map((item) => <div className="source-table-row" key={item.source}><div className="table-source"><span className="source-icon"><FileText size={17} /></span><div><strong>{item.name}</strong><small>{item.source}</small></div></div><span className="type-label">{item.extension.toUpperCase().replace('.', '')} · {item.chars.toLocaleString()} 字符</span><span className="source-state indexed-state"><i />已索引</span><button className="row-action remove-action" onClick={() => void removeDocument(item.source)}>移除来源<X size={13} /></button></div>)}
      {filtered.length === 0 && <div className="knowledge-empty"><FolderOpen size={21} /><span>{documents.length ? '没有匹配的来源' : '选择文件夹或文件，把第一批资料加入本地知识库。'}</span></div>}
    </div>
    {search.trim().length >= 2 && <section className="search-results" aria-live="polite"><header><div><span className="section-overline">CONTENT SEARCH</span><h3>内容匹配</h3></div><span>{searching ? '正在查找…' : `${results.length} 条结果`}</span></header>{results.map((result, index) => <article className="search-result" key={`${result.source}-${index}`}><div><FileText size={14} /><strong>{result.source}</strong></div><p>{result.excerpt}</p></article>)}{!searching && results.length === 0 && <p className="search-empty">没有找到匹配片段。</p>}</section>}
    <div className="manual-sources"><button onClick={() => fileInput.current?.click()}><Globe2 size={15} /><span><b>浏览器书签</b><small>从浏览器导出 HTML 文件后导入</small></span><Plus size={14} /></button><button onClick={() => fileInput.current?.click()}><FileText size={15} /><span><b>本地邮件</b><small>导入 MBOX 或 EML 导出文件</small></span><Plus size={14} /></button></div>
    <div className="privacy-callout"><LockKeyhole size={16} /><div><strong>来源访问遵循最小权限</strong><span>索引数据保存在本机的 SQLite 文件中。仅支持读取文件；浏览器密码、Cookie 和应用凭据不会读取。删除来源会同时移除对应索引。</span></div></div>
  </div>
}

function MemoryPage() {
  const [memories, setMemories] = useState<Array<{ id: number; content: string; createdAt: string }>>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = () => apiFetch('/api/memories').then((response) => response.json()).then((result) => setMemories(result.memories || [])).catch(() => setMemories([]))
  useEffect(() => { void refresh() }, [])

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!draft.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      const response = await apiFetch('/api/memories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: draft.trim() }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || '无法保存记忆。')
      setDraft('')
      await refresh()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '无法保存记忆。') }
    finally { setBusy(false) }
  }

  const remove = async (id: number) => {
    await apiFetch(`/api/memories/${id}`, { method: 'DELETE' })
    await refresh()
  }

  return <div className="subpage"><div className="memory-intro"><div className="quick-icon amber"><Archive size={18} /></div><div><span className="section-overline">LONG-TERM CONTEXT</span><h2>记忆由你掌控。</h2><p>只保存你明确添加的偏好和长期事实，会纳入后续本地对话，可随时删除。</p></div></div><form className="memory-form" onSubmit={save}><textarea value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={2000} rows={3} placeholder="例如：我偏好先看简短结论，再看详细步骤。" /><div><span>{error || `${draft.length} / 2000`}</span><button className="primary-button" disabled={busy || !draft.trim()}>{busy ? <LoaderCircle size={14} className="spin" /> : <Plus size={14} />}保存记忆</button></div></form>{memories.length ? <div className="memory-list">{memories.map((memory) => <article className="memory-item" key={memory.id}><div><Sparkles size={14} /><span>{memory.content}</span></div><button className="icon-button" onClick={() => void remove(memory.id)} aria-label="删除记忆" title="删除记忆"><Trash2 size={14} /></button></article>)}</div> : <div className="empty-state"><div className="empty-icon"><Sparkles size={21} /></div><strong>还没有保存的记忆</strong><span>添加一条你希望 Mori 在后续对话中记住的信息。</span></div>}</div>
}

function TasksPage({ connected, onConnect, onResume }: { connected: boolean; onConnect: () => void; onResume: () => void }) {
  return <div className="subpage"><div className="task-summary"><div><span className="section-overline">TASKS & APPROVALS</span><h2>每一步都在你掌握中。</h2><p>桌面控制只会在你显式委派后开始。</p></div><div className="task-count"><strong>0</strong><span>运行中</span></div></div><div className="task-access"><div className="task-access-icon"><Activity size={18} /></div><div><strong>OpenClaw 桌面执行器</strong><span>鼠标、键盘和当前屏幕 · 本机 Gateway</span><small>{connected ? '已连接，等待你委派任务' : '尚未连接，前往连接设置完成配置'}</small></div><button className="source-action" onClick={onConnect}>{connected ? '连接设置' : '连接'}<ArrowUpRight size={14} /></button></div><div className="task-empty"><div className="empty-icon"><Check size={20} /></div><strong>没有待处理任务</strong><span>从桌宠输入一个任务，完成本地对话后可选择交给 OpenClaw。</span><button className="text-button" onClick={onResume}>打开对话 <ArrowUpRight size={14} /></button></div></div>
}

function MonitorGlyph() { return <span className="monitor-glyph"><Activity size={15} /></span> }
function PlugGlyph() { return <span className="plug-glyph"><Play size={13} /></span> }


function App() {
  const petWindow = new URLSearchParams(window.location.search).get('pet') === '1'
  const chatWindow = new URLSearchParams(window.location.search).get('chat') === '1'
  return petWindow ? <PetWindow /> : <DashboardApp key={chatWindow ? 'chat' : 'dashboard'} />
}

export default App
