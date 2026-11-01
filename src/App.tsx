import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import {
  Activity, Archive, ArrowUp, ArrowUpRight, BookOpen, Check, ChevronDown,
  CircleHelp, Clock3, Command, Database, FileText, FolderOpen, Globe2,
  HardDrive, Layers3, LoaderCircle, LockKeyhole, MessageCircle, MoreHorizontal,
  Pause, Play, Plus, Search, Send, Settings2, ShieldCheck, Sparkles, Square, Trash2,
  WandSparkles, X, Monitor,
} from 'lucide-react'
import './App.css'
import PetWindow from './PetWindow'
import { streamChat } from './chat-stream'
import { emit, listen } from '@tauri-apps/api/event'
import { getAllWindows, getCurrentWindow } from '@tauri-apps/api/window'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { apiFetch, apiUrl } from './api'

type Mode = 'chat' | 'plan' | 'sketch'
type Page = 'overview' | 'knowledge' | 'memory' | 'tasks'
type Health = { ollama: boolean; model: boolean; desktopSupported?: boolean; modelName: string; documentCount?: number; chunkCount?: number; error?: string; serviceVersion?: number }
type DesktopStatus = { supported: boolean; ready: boolean; monitorCount?: number; capabilities?: string[]; message: string }
type DesktopTask = { id: string; conversationId: string; prompt: string; state: string; statusText: string; result: string; stepCount: number; pendingApproval: { kind: 'action' | 'question'; prompt: string } | null; createdAt: string; updatedAt: string }
type Message = { role: 'user' | 'assistant'; text: string; memorySuggestion?: string }
type Conversation = { id: string; title: string; mode: Mode; messageCount: number; updatedAt: string }
type PetStatus = 'idle' | 'thinking' | 'indexing' | 'operating' | 'waiting' | 'error'
type IndexedDocument = { source: string; name: string; extension: string; chars: number; indexedAt: string }
type IndexResult = { indexed: Array<{ name: string; chars: number; chunks: number }>; rejected: Array<{ name: string; error: string }>; embeddingsAvailable: boolean; documentCount: number; chunkCount: number }
type KnowledgeResult = { source: string; excerpt: string; score: number }

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
  const [health, setHealth] = useState<Health>({ ollama: false, model: false, desktopSupported: false, modelName: 'qwen3.5:4b' })
  const [desktopSession, setDesktopSession] = useState('')
  const [desktopStatus, setDesktopStatus] = useState<DesktopStatus>({ supported: false, ready: false, message: '正在检查本地桌面执行器…' })
  const [desktopTasks, setDesktopTasks] = useState<DesktopTask[]>([])
  const [taskToolScopeConfirmed, setTaskToolScopeConfirmed] = useState(false)
  const [activeRun, setActiveRun] = useState('')
  const [pausedTask, setPausedTask] = useState('')
  const [pendingTask, setPendingTask] = useState('')
  const [operationControlBusy, setOperationControlBusy] = useState(false)
  const [operationText, setOperationText] = useState('')
  const [approvalResponse, setApprovalResponse] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [now] = useState(() => new Date())
  const formRef = useRef<HTMLFormElement>(null)
  const hideTimer = useRef<number | undefined>(undefined)
  const transcriptRef = useRef<HTMLDivElement>(null)
  const operationTextRef = useRef(operationText)
  const operationConversationId = useRef(conversationId)
  const activeRunRef = useRef(activeRun)

  useEffect(() => { operationTextRef.current = operationText }, [operationText])
  useEffect(() => { conversationIdRef.current = conversationId }, [conversationId])
  useEffect(() => { activeRunRef.current = activeRun }, [activeRun])

  const refreshConversations = async () => {
    const response = await apiFetch('/api/conversations')
    if (response.ok) setConversations((await response.json()).conversations || [])
  }

  const desktopFetch = (path: string, init: RequestInit = {}) => fetch(apiUrl(path), {
    ...init,
    headers: { ...(init.headers || {}), 'X-Mori-Desktop-Session': desktopSession },
  })

  useEffect(() => {
    const refresh = () => apiFetch('/api/health').then((r) => r.json()).then((data: Health) => setHealth(data)).catch((reason: unknown) => setHealth((v) => ({ ...v, ollama: false, model: false, error: reason instanceof Error ? reason.message : '本地服务未启动' })))
    refresh()
    const timer = window.setInterval(refresh, 9000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!nativeApp) return
    let cancelled = false
    let session = ''
    const refreshDesktop = async (mayRefreshSession = true) => {
      if (!session) return
      const [statusResponse, tasksResponse] = await Promise.all([
        fetch(apiUrl('/api/desktop/status'), { headers: { 'X-Mori-Desktop-Session': session } }),
        fetch(apiUrl('/api/desktop/tasks'), { headers: { 'X-Mori-Desktop-Session': session } }),
      ])
      if (statusResponse.status === 403 || tasksResponse.status === 403) {
        if (mayRefreshSession) {
          const sessionResponse = await fetch(apiUrl('/api/desktop/session'))
          const renewed = sessionResponse.ok ? await sessionResponse.json() as { token?: string } : {}
          if (renewed.token) {
            session = renewed.token
            setDesktopSession(renewed.token)
            return refreshDesktop(false)
          }
        }
        throw new Error('Mori 桌面任务授权已失效，请重新打开工作台。')
      }
      if (!statusResponse.ok || !tasksResponse.ok) throw new Error('本地桌面服务拒绝了请求。')
      const status = await statusResponse.json() as DesktopStatus
      const taskList = (await tasksResponse.json()).tasks as DesktopTask[]
      if (cancelled) return
      setDesktopStatus(status)
      setDesktopTasks(taskList)
      const current = taskList.find((task) => ['running', 'pausing', 'awaiting_approval'].includes(task.state))
      if (current) {
        activeRunRef.current = current.id
        setActiveRun(current.id)
        setOperationText(current.statusText)
        setPetStatus(current.state === 'awaiting_approval' ? 'waiting' : 'operating')
      } else if (activeRunRef.current) {
        const previous = taskList.find((task) => task.id === activeRunRef.current)
        activeRunRef.current = ''
        setActiveRun('')
        if (previous?.state === 'paused' || previous?.state === 'interrupted') {
          setPausedTask(previous.prompt)
          setOperationText(previous.statusText)
          setPetStatus('waiting')
        } else if (previous) {
          setOperationText(previous.statusText)
          setPetStatus(previous.state === 'failed' ? 'error' : 'idle')
          if (previous.state === 'completed') {
            const history = await apiFetch(`/api/chat/history?conversationId=${encodeURIComponent(previous.conversationId)}`)
            const content = await history.json() as { messages?: Array<{ role: 'user' | 'assistant'; content: string }> }
            if (!cancelled && conversationIdRef.current === previous.conversationId) {
              setMessages(content.messages?.map((item) => ({ role: item.role, text: item.content })) || [])
            }
            void refreshConversations()
          }
        }
      }
    }
    void fetch(apiUrl('/api/desktop/session'), { headers: { 'Cache-Control': 'no-store' } }).then((response) => {
      if (!response.ok) throw new Error('无法建立 Mori 桌面任务授权。')
      return response.json()
    }).then(async (result: { token?: string }) => {
      if (!result.token || cancelled) throw new Error('Mori 桌面任务授权未返回。')
      session = result.token
      setDesktopSession(result.token)
      await refreshDesktop()
    }).catch((reason) => { if (!cancelled) setDesktopStatus({ supported: false, ready: false, message: reason instanceof Error ? reason.message : 'Mori 桌面服务未启动。' }) })
    const timer = window.setInterval(() => {
      void refreshDesktop().catch((reason) => {
        if (!cancelled) setDesktopStatus((current) => ({ ...current, ready: false, message: reason instanceof Error ? reason.message : '桌面任务状态读取失败。' }))
      })
    }, 1500)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [nativeApp])

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
    void executePrompt(prompt).then((sent) => { if (!sent) setDraft((current) => current || prompt) })
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

  const delegateTask = async () => {
    const request = pendingTask || [...messages].reverse().find((item) => item.role === 'user')?.text
    if (!request || !desktopStatus.ready || !desktopSession || !taskToolScopeConfirmed || activeRun) return
    setConfirmDelegateOpen(false)
    operationConversationId.current = conversationId
    setPausedTask('')
    setPetStatus('operating')
    setOperationText('正在准备本地桌面任务…')
    try {
      const response = await desktopFetch('/api/desktop/tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: request, conversationId }),
      })
      const result = await response.json() as { task?: DesktopTask; error?: string }
      if (!response.ok || !result.task) throw new Error(result.error || '无法创建桌面任务。')
      const start = await desktopFetch(`/api/desktop/tasks/${result.task.id}/control`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', confirmed: true }),
      })
      const started = await start.json() as { ok?: boolean; error?: string }
      if (!start.ok || !started.ok) throw new Error(started.error || '无法启动桌面任务。')
      activeRunRef.current = result.task.id
      setActiveRun(result.task.id)
      setPendingTask('')
      setOperationText('Mori 正在观察当前 Windows 桌面。')
      setNotice('Mori 本地桌面任务已开始')
    } catch (error) {
      setPetStatus('error')
      setOperationText(error instanceof Error ? error.message : 'Mori 桌面任务启动失败。')
    }
  }

  const openDelegateReview = (task?: string) => {
    setPendingTask(task || [...messages].reverse().find((item) => item.role === 'user')?.text || '')
    setTaskToolScopeConfirmed(false)
    setConfirmDelegateOpen(true)
    setPetStatus('waiting')
  }
  const closeDelegateReview = () => { setConfirmDelegateOpen(false); setPendingTask(''); setPetStatus((current) => current === 'waiting' ? 'idle' : current) }

  const controlDesktopTask = async (action: 'pause' | 'stop' | 'takeover') => {
    if (!activeRun) return false
    setOperationControlBusy(true)
    try {
      const response = await desktopFetch(`/api/desktop/tasks/${activeRun}/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })
      const result = await response.json() as { ok: boolean; error?: string }
      if (!response.ok || !result.ok) throw new Error(result.error || 'Mori 没有确认桌面控制指令。')
      setOperationText(action === 'pause' ? '正在暂停并交还桌面…' : action === 'takeover' ? '正在停止自动操作并交还桌面…' : '正在停止桌面任务…')
      return true
    } catch (error) {
      setPetStatus('error')
      setOperationText(`桌面控制指令失败：${error instanceof Error ? error.message : '请求失败'}`)
      setNotice('桌面控制指令未确认，请直接使用鼠标或键盘接管')
      return false
    } finally { setOperationControlBusy(false) }
  }

  const pauseOperation = async () => {
    if (!await controlDesktopTask('pause')) return
    setNotice('正在暂停；Mori 将在当前动作结束后交还桌面')
  }

  const stopOperation = async () => {
    if (!await controlDesktopTask('stop')) return
    setNotice('已请求停止 Mori 桌面任务')
  }

  const takeoverOperation = async () => {
    if (!await controlDesktopTask('takeover')) return
    setNotice('已请求停止并交还桌面控制权')
  }

  const resumeOperation = () => openDelegateReview(pausedTask)

  const answerDesktopApproval = async (choice: 'approve' | 'deny' | 'answer', taskId = activeRun, responseText = approvalResponse) => {
    if (!taskId) return
    try {
      const response = await desktopFetch(`/api/desktop/tasks/${taskId}/approval`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ choice, response: responseText }) })
      const result = await response.json() as { ok?: boolean; error?: string }
      if (!response.ok || !result.ok) throw new Error(result.error || '无法提交审批。')
      setApprovalResponse('')
      setNotice(choice === 'approve' ? '已批准当前桌面步骤' : choice === 'answer' ? '已把你的回答交给 Mori' : '已拒绝当前桌面步骤')
    } catch (error) { setNotice(error instanceof Error ? error.message : '无法提交桌面审批。') }
  }

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
            <button className="desktop-chip" onClick={() => setSettingsOpen(true)}><span className={desktopStatus.ready ? 'connection-dot live coral' : 'connection-dot coral'} />桌面执行 <span className="desktop-status">{desktopStatus.ready ? '就绪' : '未就绪'}</span></button>
            <button className="icon-button top-settings" title="桌面执行器状态" onClick={() => setSettingsOpen(true)}><Settings2 size={17} /></button>
          </div>
        </header>

        <div className="page-scroll">
          <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" />本机智能体 <span className="private-pill"><LockKeyhole size={11} /> PRIVATE</span></div><h1>{page === 'overview' ? '早上好，林。' : pageTitle}</h1><p>{page === 'overview' ? '你的本地 AI 已准备好，今天想从哪里开始？' : page === 'knowledge' ? '连接到你的本地资料，只在需要时查找相关内容。' : page === 'memory' ? '你和 Mori 一起整理的偏好与长期上下文。' : '正在进行和等待你确认的工作。'}</p></div><div className="date-block"><span>本机时间</span><strong>{new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(now)}</strong><small>{new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(now)}</small></div></div>

          {page === 'overview' && <>
            <section className="hero-stage">
              <div className="hero-copy"><div className="online-label"><span className="pulse-dot" />{health.model ? '本地模型在线' : '等待本地模型'}</div><h2>我是 Mori。<br /><em>你的私人智能体。</em></h2><p>我在本机运行，可以帮你检索资料、一起梳理计划，也能在你确认后通过可见的鼠标和键盘操作桌面。</p>{!health.model && health.error && <p className="model-error" role="status">{health.error}</p>}<div className="hero-buttons"><button className="primary-button" onClick={() => requestChat('chat')}><MessageCircle size={16} />开始对话</button><button className="text-button" onClick={() => requestChat('plan')}>先做个计划 <ArrowUpRight size={15} /></button></div><div className="hero-foot"><span><LockKeyhole size={13} />内容留在本机</span><span><HardDrive size={13} />Ollama · {health.modelName}</span></div></div>
              <div className="hero-mascot-wrap"><img className={`hero-mascot status-${petStatus}`} src="/mori-wildman-transparent.png" alt="黑白野人 Mori 桌宠" /><div className="speech-tag"><span className="mini-spark">✦</span> 我在听</div><div className="mascot-caption"><strong>Mori</strong><span>本地陪伴 · 随时可唤醒</span></div></div>
              <div className="hero-index"><div className="index-icon"><Database size={17} /></div><div><strong>本地知识</strong><span>等待添加授权来源</span></div><button onClick={() => openPage('knowledge')} aria-label="管理知识来源"><ArrowUpRight size={16} /></button></div>
            </section>

            <section className="section-block">
              <div className="section-heading"><div><span className="section-overline">QUICK ACCESS</span><h3>从这里继续</h3></div><button className="quiet-link" onClick={() => openPage('tasks')}>查看全部 <ArrowUpRight size={14} /></button></div>
              <div className="quick-grid">
                <button className="quick-item" onClick={() => requestChat('plan')}><div className="quick-icon amber"><WandSparkles size={17} /></div><div><strong>整理一个计划</strong><span>逐步澄清目标与约束</span></div><ArrowUpRight size={15} /></button>
                <button className="quick-item" onClick={() => requestChat('sketch')}><div className="quick-icon teal"><Command size={17} /></div><div><strong>继续自由构思</strong><span>提示可以边聊边追加</span></div><ArrowUpRight size={15} /></button>
                <button className="quick-item" onClick={() => openPage('tasks')}><div className="quick-icon coral"><Monitor size={17} /></div><div><strong>Mori 桌面任务</strong><span>确认后操作当前屏幕</span></div><ArrowUpRight size={15} /></button>
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
          {page === 'tasks' && <TasksPage tasks={desktopTasks} status={desktopStatus} onReview={openDelegateReview} onOpenChat={() => requestChat()} onApproval={(id, choice, response) => void answerDesktopApproval(choice, id, response)} onControl={(id, action) => { setActiveRun(id); activeRunRef.current = id; void desktopFetch(`/api/desktop/tasks/${id}/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) }).then((response) => response.json()).then((result) => { if (!result.ok) setNotice(result.error || '任务控制失败') }).catch(() => setNotice('Mori 本地服务无响应。')) }} />}

          <footer className="page-footer"><span><ShieldCheck size={14} />隐私优先 · 本机数据</span><span>Qwen 3.5 <b>·</b> Ollama <b>·</b> Mori 桌面执行器</span></footer>
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
        <div className="chat-panel-head"><div className="chat-title"><div className="chat-avatar"><img src="/mori-wildman-transparent.png" alt="" /></div><div><strong>Mori <span className="verified"><Check size={10} /></span></strong><span>{petStatus === 'operating' ? 'Mori 正在操作桌面' : '本地私人智能体'}</span></div></div><div className="chat-head-actions"><button title="新建对话" onClick={() => void createConversation()}><Plus size={16} /></button><button title="关闭" onClick={closeChat}><X size={17} /></button></div></div>
        <div className="chat-mode-tabs">{(['chat', 'plan', 'sketch'] as Mode[]).map((item) => <button key={item} className={mode === item ? 'chat-tab selected' : 'chat-tab'} onClick={() => setMode(item)}>{modeLabels[item]}</button>)}</div>
        <div className="conversation-toolbar"><select aria-label="选择会话" value={conversationId} onChange={(event) => void selectConversation(event.target.value)}>{conversations.map((item) => <option value={item.id} key={item.id}>{item.title || '新对话'}</option>)}</select><label><Search size={12} /><input value={conversationSearch} onChange={(event) => setConversationSearch(event.target.value)} placeholder="搜索历史对话" /></label></div>
        {conversationSearch.trim().length >= 2 && conversationResults.length > 0 && <div className="conversation-search-results">{conversationResults.map((item) => <button key={`${item.conversationId}-${item.messageId}`} onClick={() => { void selectConversation(item.conversationId); setConversationSearch(''); setPanelOpen(true) }}><strong>{item.title}</strong><span>{item.excerpt}</span></button>)}</div>}
        <div className="transcript" ref={transcriptRef}>
          <div className="conversation-date"><span />今天<span /></div>
          {messages.map((message, index) => <div key={`${index}-${message.role}`} className={`message-row ${message.role}`}><div className="message-avatar">{message.role === 'assistant' ? <img src="/mori-wildman-transparent.png" alt="" /> : '林'}</div><div className="message-body"><span className="message-author">{message.role === 'assistant' ? 'Mori' : '你'} <small>{message.role === 'assistant' ? '· 本机' : ''}</small></span><div className={`message-text ${!message.text ? 'streaming' : ''}`}>{message.text || <><i /><i /><i /></>}</div>{message.memorySuggestion && <div className="memory-suggestion-card"><span>记住这条长期事实？</span><p>{message.memorySuggestion}</p><button onClick={() => void confirmMemorySuggestion(index, message.memorySuggestion!)}><Check size={12} />确认保存</button></div>}</div></div>)}
          {operationText && <div className="operation-card"><div className="operation-head"><span className="operation-pulse" />Mori 桌面任务 <span className="operation-via">本机执行</span>{activeRun && <><button disabled={operationControlBusy} title="暂停并交还控制权" onClick={() => void pauseOperation()}><Pause size={12} />暂停</button><button disabled={operationControlBusy} title="停止任务" onClick={() => void stopOperation()}><Square size={11} fill="currentColor" />停止</button><button disabled={operationControlBusy} title="停止并立即接管" onClick={() => void takeoverOperation()}><Monitor size={12} />接管</button></>}{!activeRun && pausedTask && <button title="重新确认后观察当前桌面" onClick={resumeOperation}><Play size={11} />重新开始</button>}</div><p>{operationText}</p>{activeRun && desktopTasks.find((task) => task.id === activeRun)?.pendingApproval && <div className="desktop-approval"><strong>{desktopTasks.find((task) => task.id === activeRun)?.pendingApproval?.kind === 'question' ? 'Mori 需要你回答' : '等待你批准这一步'}</strong><p>{desktopTasks.find((task) => task.id === activeRun)?.pendingApproval?.prompt}</p>{desktopTasks.find((task) => task.id === activeRun)?.pendingApproval?.kind === 'question' ? <><textarea value={approvalResponse} onChange={(event) => setApprovalResponse(event.target.value)} rows={2} placeholder="输入回答" /><button className="primary-button" disabled={!approvalResponse.trim()} onClick={() => void answerDesktopApproval('answer')}>发送回答</button><button className="secondary-button" onClick={() => void answerDesktopApproval('deny')}>取消任务</button></> : <><button className="primary-button" onClick={() => void answerDesktopApproval('approve')}>批准这一步</button><button className="secondary-button" onClick={() => void answerDesktopApproval('deny')}>拒绝并停止</button></>}</div>}{!activeRun && pausedTask && <span className="handoff-label"><Check size={12} />桌面控制权已交还给你</span>}</div>}
          {messages.some((item) => item.role === 'user' && /(打开|点击|鼠标|桌面|网页|浏览器|填写|操作电脑|帮我操作|关掉|启动)/.test(item.text)) && <div className="delegate-nudge"><div><MonitorGlyph /><span><b>需要操作当前桌面？</b><small>确认任务后，Mori 会用当前屏幕和可见键鼠完成。</small></span></div><button disabled={!desktopStatus.ready || !!activeRun} onClick={() => openDelegateReview()}>{activeRun ? '正在操作' : '创建桌面任务'}<ArrowUpRight size={14} /></button></div>}
        </div>
        <form className="panel-composer" onSubmit={sendPrompt}><textarea value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendPrompt() } }} placeholder={mode === 'sketch' ? '继续输入，按 Enter 追加…' : '写下你的问题…'} rows={2} /><div className="panel-composer-foot"><div><span className="local-lock"><LockKeyhole size={12} />本地对话</span><span className="composer-hint">Shift + Enter 换行</span></div><button className="panel-send" type="submit" disabled={!draft.trim() || petStatus === 'thinking'} aria-label="发送"><Send size={15} /></button></div></form>
        <div className="panel-bottom"><span><span className="connection-dot live" />Ollama · {health.modelName}</span><button onClick={() => setSettingsOpen(true)}>桌面执行器 <ArrowUpRight size={12} /></button></div>
      </section>}

      {settingsOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false) }}><section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title"><header className="modal-heading"><div><span className="section-overline">LOCAL DESKTOP</span><h2 id="settings-title">Mori 桌面执行器</h2></div><button className="icon-button" onClick={() => setSettingsOpen(false)} aria-label="关闭"><X size={17} /></button></header><p className="modal-intro">桌面任务只在当前 Windows 登录会话运行。Mori 使用屏幕截图、只读控件信息和可见鼠标键盘；不会调用命令行或应用私有接口。</p><div className={desktopStatus.ready ? 'connection-result good' : 'connection-result'}><span className={desktopStatus.ready ? 'connection-dot live' : 'connection-dot'} />{desktopStatus.message}</div><div className="scope-note"><ShieldCheck size={15} /><span>锁屏、安全桌面或更高权限窗口不可控制。你可以随时移动鼠标或按键接管；高影响步骤会停下来等你批准。</span></div></section></div>}

      {confirmDelegateOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDelegateReview() }}><section className="settings-modal confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delegate-title"><header className="modal-heading"><div><span className="section-overline">VISIBLE DESKTOP CONTROL</span><h2 id="delegate-title">确认 Mori 操作桌面</h2></div><button className="icon-button" onClick={closeDelegateReview} aria-label="关闭"><X size={17} /></button></header><p className="modal-intro">请检查完整任务内容。确认后 Mori 才会观察当前桌面并逐步操作；遇到需要提交或确认的步骤会再次询问。</p><blockquote className="delegate-review">{pendingTask}</blockquote><label className="safety-check task-scope-check"><input type="checkbox" checked={taskToolScopeConfirmed} onChange={(event) => setTaskToolScopeConfirmed(event.target.checked)} /><span><b>我已检查上面的任务全文，并同意本次可见桌面操作。</b></span></label><p className="approval-caution">执行期间可暂停、停止或接管。应用重启后不会重放旧动作；继续前会重新观察桌面。</p><div className="delegate-review-actions"><button className="secondary-button" onClick={closeDelegateReview}>返回修改</button><button className="primary-button" disabled={!desktopStatus.ready || !!activeRun || !pendingTask || !taskToolScopeConfirmed} onClick={() => void delegateTask()}>确认并开始 <ArrowUpRight size={14} /></button></div></section></div>}

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
    const events = new EventSource(apiUrl('/api/events'))
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

function TasksPage({ tasks, status, onReview, onOpenChat, onControl, onApproval }: { tasks: DesktopTask[]; status: DesktopStatus; onReview: (task: string) => void; onOpenChat: () => void; onControl: (id: string, action: 'pause' | 'stop' | 'takeover') => void; onApproval: (id: string, choice: 'approve' | 'deny' | 'answer', response?: string) => void }) {
  const [taskDraft, setTaskDraft] = useState('')
  const [approvalResponse, setApprovalResponse] = useState('')
  const active = tasks.find((task) => ['running', 'pausing', 'awaiting_approval'].includes(task.state))
  const labels: Record<string, string> = { awaiting_confirmation: '等待确认', running: '运行中', pausing: '正在暂停', paused: '已暂停', awaiting_approval: '等待你批准', completed: '已完成', failed: '失败', stopped: '已停止', interrupted: '已中断' }
  return <div className="subpage">
    <div className="task-summary"><div><span className="section-overline">LOCAL DESKTOP TASKS</span><h2>桌面任务</h2><p>{status.message}</p></div><div className="task-count"><strong>{active ? '1' : '0'}</strong><span>运行中</span></div></div>
    <div className="task-access"><div className="task-access-icon"><Monitor size={18} /></div><div><strong>Mori 原生桌面执行器</strong><span>屏幕观察 · 只读控件信息 · 可见鼠标键盘</span><small>{status.ready ? `已就绪 · ${status.monitorCount || 1} 个显示器` : '桌面执行器不可用'}</small></div><span className={status.ready ? 'connection-dot live' : 'connection-dot'} /></div>
    <form className="desktop-task-form" onSubmit={(event) => { event.preventDefault(); if (taskDraft.trim()) { onReview(taskDraft.trim()); setTaskDraft('') } }}><label htmlFor="desktop-task-input">新建桌面任务</label><textarea id="desktop-task-input" value={taskDraft} onChange={(event) => setTaskDraft(event.target.value)} maxLength={12000} rows={3} placeholder="例如：打开浏览器搜索某个主题，并把前三个结果整理到对话里。" /><div><span>确认后才开始操作。遇到提交、发送或删除等步骤会再次询问。</span><button className="primary-button" disabled={!status.ready || !taskDraft.trim()}><Monitor size={14} />检查任务并确认</button></div></form>
    {active && <section className="desktop-task-active"><div><span className="section-overline">CURRENT TASK · {labels[active.state] || active.state}</span><strong>{active.prompt}</strong><small>{active.statusText} · {active.stepCount} 步</small>{active.pendingApproval && <div className="desktop-approval"><strong>{active.pendingApproval.kind === 'question' ? 'Mori 需要你回答' : '请检查并批准下一步'}</strong><p>{active.pendingApproval.prompt}</p>{active.pendingApproval.kind === 'question' && <textarea value={approvalResponse} onChange={(event) => setApprovalResponse(event.target.value)} rows={2} placeholder="输入回答" />}{active.pendingApproval.kind === 'question' ? <><button className="primary-button" disabled={!approvalResponse.trim()} onClick={() => { onApproval(active.id, 'answer', approvalResponse); setApprovalResponse('') }}>发送回答</button><button className="secondary-button" onClick={() => onApproval(active.id, 'deny')}>取消任务</button></> : <><button className="primary-button" onClick={() => onApproval(active.id, 'approve')}>批准这一步</button><button className="secondary-button" onClick={() => onApproval(active.id, 'deny')}>拒绝并停止</button></>}</div>}</div><div className="desktop-task-controls"><button className="secondary-button" onClick={() => onControl(active.id, 'pause')}><Pause size={13} />暂停</button><button className="secondary-button" onClick={() => onControl(active.id, 'stop')}><Square size={11} />停止</button><button className="secondary-button" onClick={() => onControl(active.id, 'takeover')}><Monitor size={13} />接管</button></div></section>}
    <div className="section-heading desktop-history-heading"><div><span className="section-overline">TASK HISTORY</span><h3>最近任务</h3></div><button className="quiet-link" onClick={onOpenChat}>打开对话 <ArrowUpRight size={14} /></button></div>
    {tasks.length ? <div className="desktop-task-list">{tasks.map((task) => <article className="desktop-task-row" key={task.id}><div className="desktop-task-state"><span className={['running', 'pausing', 'awaiting_approval'].includes(task.state) ? 'connection-dot live' : 'connection-dot'} />{labels[task.state] || task.state}</div><div className="desktop-task-detail"><strong>{task.prompt}</strong><span>{task.statusText}</span><small>{new Date(task.updatedAt).toLocaleString('zh-CN')} · {task.stepCount} 步</small></div>{['paused', 'interrupted'].includes(task.state) && <button className="source-action" onClick={() => onReview(task.prompt)}>重新观察并确认 <ArrowUpRight size={14} /></button>}</article>)}</div> : <div className="task-empty"><div className="empty-icon"><Check size={20} /></div><strong>还没有桌面任务</strong><span>输入任务后，Mori 会先显示完整内容供你确认。</span><button className="text-button" onClick={onOpenChat}>打开对话 <ArrowUpRight size={14} /></button></div>}
  </div>
}

function MonitorGlyph() { return <span className="monitor-glyph"><Activity size={15} /></span> }


function App() {
  const petWindow = new URLSearchParams(window.location.search).get('pet') === '1'
  const chatWindow = new URLSearchParams(window.location.search).get('chat') === '1'
  return petWindow ? <PetWindow /> : <DashboardApp key={chatWindow ? 'chat' : 'dashboard'} />
}

export default App
