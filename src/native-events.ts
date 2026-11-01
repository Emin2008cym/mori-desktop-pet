import { emit, listen } from '@tauri-apps/api/event'

type NativeAck = { requestId: string; ok: boolean; error?: string; conversationId?: string }

export function requestNativeAck(
  eventName: string,
  ackName: string,
  payload: Record<string, unknown>,
  options: { retryMs?: number; timeoutMs?: number } = {},
): Promise<NativeAck> {
  const requestId = crypto.randomUUID()
  const timeoutMs = options.timeoutMs ?? 5000
  return new Promise((resolve, reject) => {
    let unlisten: (() => void) | undefined
    let retryTimer: number | undefined
    const timeout = window.setTimeout(() => {
      unlisten?.()
      if (retryTimer !== undefined) window.clearInterval(retryTimer)
      reject(new Error('Mori 窗口没有及时响应，请重试。'))
    }, timeoutMs)
    const cleanup = () => {
      window.clearTimeout(timeout)
      if (retryTimer !== undefined) window.clearInterval(retryTimer)
      unlisten?.()
    }
    void listen<NativeAck>(ackName, (event) => {
      if (event.payload.requestId !== requestId) return
      cleanup()
      if (!event.payload.ok) reject(new Error(event.payload.error || 'Mori 窗口操作失败。'))
      else resolve(event.payload)
    }).then((stop) => {
      unlisten = stop
      const send = () => { void emit(eventName, { ...payload, requestId }).catch((error) => { cleanup(); reject(error) }) }
      send()
      if (options.retryMs) retryTimer = window.setInterval(send, options.retryMs)
    }).catch((error) => { cleanup(); reject(error) })
  })
}
