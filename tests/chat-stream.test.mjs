import test from 'node:test'
import assert from 'node:assert/strict'
import { streamChat } from '../src/chat-stream.ts'

const payload = { message: '你好', mode: 'chat', conversationId: 'unit-test' }
test('chat stream preserves split UTF-8, final rows without newline, and memory confirmation candidates', async (t) => {
  const bytes = new TextEncoder().encode('data: {"text":"你好"}\ndata: {"done":true,"replaceText":"你好 Mori","memorySuggestion":"喜欢中文"}')
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3))
    controller.close()
  } })))
  const updates = []
  await streamChat('/api/chat', payload, (...args) => updates.push(args))
  assert.deepEqual(updates.at(-1), ['你好 Mori', '喜欢中文'])
})
test('chat does not treat a disconnected response as successful completion', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('data: {"text":"partial"}\n'))
  await assert.rejects(streamChat('/api/chat', payload, () => {}), /回复连接中断/)
})
test('chat shows a readable backend error', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: '模型未安装' }, { status: 503 }))
  await assert.rejects(streamChat('/api/chat', payload, () => {}), /模型未安装/)
})
