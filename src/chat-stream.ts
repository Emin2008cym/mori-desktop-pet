export type ChatMode = 'chat' | 'plan' | 'sketch'
export async function streamChat(
  url: string,
  payload: { message: string; mode: ChatMode; conversationId: string },
  update: (text: string, memorySuggestion?: string) => void,
) {
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  })
  if (!response.ok || !response.body) {
    let detail = '本地服务暂时不可用，请稍后重试。'
    try { detail = (await response.json()).error || detail } catch { /* Keep a readable fallback. */ }
    throw new Error(detail)
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let answer = ''
  let completed = false
  const accept = (row: string) => {
    if (!row.startsWith('data: ')) return
    const item = JSON.parse(row.slice(6)) as { text?: string; error?: string; done?: boolean; replaceText?: string; memorySuggestion?: string }
    if (item.error) throw new Error(item.error)
    if (item.text) { answer += item.text; update(answer) }
    if (item.done) { completed = true; answer = item.replaceText ?? answer; update(answer, item.memorySuggestion) }
  }
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const rows = buffer.split('\n')
      buffer = rows.pop() ?? ''
      rows.forEach(accept)
    }
    buffer += decoder.decode()
    if (buffer.trim()) accept(buffer)
    if (!completed) throw new Error('回复连接中断，请重试。')
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
}
