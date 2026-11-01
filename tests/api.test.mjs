import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { createServer as createHttpServer } from 'node:http'

let child
let apiOutput = ''
let baseUrl
let dataDirectory
let apiPort
const instanceId = 'mori-api-test-instance'
let ollamaMock
let ollamaUrl
let lastChatPayload
const chatPayloads = []

function startApi() {
  apiOutput = ''
  child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, MORI_PORT: '0', MORI_INSTANCE_ID: instanceId, MORI_DATA_DIR: dataDirectory, OLLAMA_URL: ollamaUrl },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.setEncoding('utf8').on('data', (data) => { apiOutput += data })
  child.stderr.setEncoding('utf8').on('data', (data) => { apiOutput += data })
  return waitForServer(baseUrl)
}

async function stopApi() {
  if (!child || child.exitCode !== null) return
  child.kill()
  await Promise.race([new Promise((resolve) => child.once('exit', resolve)), new Promise((resolve) => setTimeout(resolve, 2500))])
}

function createTextPdf(text) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(`BT /F1 12 Tf 24 80 Td (${text}) Tj ET\n`, 'ascii')} >>\nstream\nBT /F1 12 Tf 24 80 Td (${text}) Tj ET\nendstream`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf, 'ascii'))
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`
  }
  const xrefOffset = Buffer.byteLength(pdf, 'ascii')
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(pdf, 'ascii')
}

async function waitForServer() {
  const expires = Date.now() + 8000
  while (Date.now() < expires) {
    const port = apiOutput.match(/MORI_READY (\d+)/)?.[1]
    if (port) {
      apiPort = Number(port)
      baseUrl = `http://127.0.0.1:${apiPort}`
      try {
        const response = await fetch(`${baseUrl}/api/knowledge/documents`, { signal: AbortSignal.timeout(250) })
        if (response.ok) return
      } catch { /* The child has announced its port and is finishing startup. */ }
    }
    await new Promise((resolve) => setTimeout(resolve, 80))
  }
  throw new Error(`Local API failed to start. ${apiOutput}`)
}

before(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), 'mori-api-test-'))
  ollamaMock = createHttpServer((request, response) => {
    if (request.url === '/api/tags') {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ models: [{ name: 'qwen3.5:4b' }, { name: 'nomic-embed-text:latest' }] }))
      return
    }
    if (request.url === '/api/embed') {
      response.writeHead(404).end()
      return
    }
    if (request.url === '/api/chat') {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk) => { body += chunk })
      request.on('end', () => {
        lastChatPayload = JSON.parse(body)
        chatPayloads.push(lastChatPayload)
        if (lastChatPayload.stream === false) {
          const content = lastChatPayload.messages.some((message) => message.images?.length) ? '图片中有一辆红色小车和一棵树。' : '已摘要：保留用户目标、决定和待办事项。'
          response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ message: { content } }))
          return
        }
        response.writeHead(200, { 'Content-Type': 'application/x-ndjson' }).end(`${JSON.stringify({ message: { content: '收到，我会保留这个计划。' }, done: false })}\n${JSON.stringify({ message: { content: '' }, done: true })}\n`)
      })
      return
    }
    response.writeHead(404).end()
  })
  await new Promise((resolve, reject) => ollamaMock.listen(0, '127.0.0.1', (error) => error ? reject(error) : resolve()))
  ollamaUrl = `http://127.0.0.1:${ollamaMock.address().port}`
  await startApi()
})

after(async () => {
  await stopApi()
  if (ollamaMock?.listening) await new Promise((resolve) => ollamaMock.close(resolve))
  if (dataDirectory) await rm(dataDirectory, { recursive: true, force: true })
})

test('health identifies this service instance and confirms the configured Ollama model', async () => {
  const response = await fetch(`${baseUrl}/api/health`)
  const health = await response.json()
  assert.equal(response.ok, true)
  assert.equal(health.serviceVersion, 2)
  assert.equal(health.serviceInstanceId, instanceId)
  assert.equal(health.ollama, true)
  assert.equal(health.model, true)
  assert.equal(health.modelName, 'qwen3.5:4b')
})

test('knowledge files can be indexed, searched locally, listed, and removed', async () => {
  const form = new FormData()
  form.append('files', new Blob(['Mori 私人知识库的测试秘密短语：松树下的蓝色笔记本。'], { type: 'text/markdown' }), 'notes.md')
  const indexed = await fetch(`${baseUrl}/api/knowledge/index`, { method: 'POST', body: form }).then((response) => response.json())
  assert.equal(indexed.indexed.length, 1)
  assert.equal(indexed.indexed[0].name, 'notes.md')
  assert.equal(indexed.documentCount, 1)

  const search = await fetch(`${baseUrl}/api/knowledge/search?q=${encodeURIComponent('松树下的蓝色笔记本')}`).then((response) => response.json())
  assert.equal(search.results.length, 1)
  assert.match(search.results[0].excerpt, /松树下的蓝色笔记本/)

  const listed = await fetch(`${baseUrl}/api/knowledge/documents`).then((response) => response.json())
  assert.equal(listed.documents[0].source, 'notes.md')

  const removed = await fetch(`${baseUrl}/api/knowledge/documents`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'notes.md' }),
  }).then((response) => response.json())
  assert.equal(removed.ok, true)
  assert.equal(removed.documentCount, 0)
  assert.equal(removed.chunkCount, 0)
})

test('PDF text extraction indexes content without a native canvas add-on', async () => {
  const form = new FormData()
  form.append('files', new Blob([createTextPdf('Mori PDF extraction marker')], { type: 'application/pdf' }), 'sample.pdf')
  const indexed = await fetch(`${baseUrl}/api/knowledge/index`, { method: 'POST', body: form }).then((response) => response.json())
  assert.equal(indexed.indexed.length, 1)
  const search = await fetch(`${baseUrl}/api/knowledge/search?q=${encodeURIComponent('PDF extraction marker')}`).then((response) => response.json())
  assert.ok(search.results.some((result) => result.source === 'sample.pdf'))
  await fetch(`${baseUrl}/api/knowledge/documents`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'sample.pdf' }),
  })
})

test('chat rejects invalid modes before contacting Ollama', async () => {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'execute', message: 'test' }),
  })
  assert.equal(response.status, 400)
})

test('chat history survives a local service restart', async () => {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'plan', message: '帮我整理一个计划' }),
  })
  assert.equal(response.status, 200)
  assert.match(await response.text(), /收到，我会保留这个计划。/)
  await stopApi()
  await startApi()
  const history = await fetch(`${baseUrl}/api/chat/history`).then((result) => result.json())
  assert.deepEqual(history.messages.map((message) => message.role), ['user', 'assistant'])
  assert.equal(history.messages[0].content, '帮我整理一个计划')
})

test('conversations remain isolated, preserve mode, summarize older turns, and keep the 16K request context', async () => {
  const created = await fetch(`${baseUrl}/api/conversations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'sketch' }),
  }).then((response) => response.json())
  const conversationId = created.id
  for (let index = 0; index < 13; index++) {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `草稿轮次 ${index} 私有关键词青松-91`, conversationId }),
    })
    assert.equal(response.status, 200)
    await response.text()
  }

  const secondary = await fetch(`${baseUrl}/api/conversations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'plan' }),
  }).then((response) => response.json())
  const secondChat = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: '另一个隔离会话', conversationId: secondary.id }),
  })
  await secondChat.text()
  assert.equal(lastChatPayload.options.num_ctx, 16384)
  assert.equal(lastChatPayload.messages.some((message) => message.content?.includes('青松-91')), false)

  const conversationList = await fetch(`${baseUrl}/api/conversations`).then((response) => response.json())
  let summary = conversationList.conversations.find((item) => item.id === conversationId)?.summary || ''
  const deadline = Date.now() + 4000
  while (!summary && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 80))
    const refreshed = await fetch(`${baseUrl}/api/conversations`).then((response) => response.json())
    summary = refreshed.conversations.find((item) => item.id === conversationId)?.summary || ''
  }
  assert.match(summary, /已摘要/)
  assert.ok(chatPayloads.filter((payload) => payload.options?.num_ctx === 16384).length >= 14)

  const search = await fetch(`${baseUrl}/api/conversations/search?q=${encodeURIComponent('青松-91')}`).then((response) => response.json())
  assert.ok(search.results.some((item) => item.conversationId === conversationId))
  await stopApi()
  await startApi()
  const restored = await fetch(`${baseUrl}/api/chat/history?conversationId=${conversationId}`).then((response) => response.json())
  assert.equal(restored.messages.length, 26)
  assert.equal(restored.conversation.mode, 'sketch')
})

test('explicit memories can be stored, listed, and deleted', async () => {
  const created = await fetch(`${baseUrl}/api/memories`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: '回答先给结论，再给步骤。' }),
  })
  assert.equal(created.status, 201)
  const memory = await created.json()
  const listed = await fetch(`${baseUrl}/api/memories`).then((response) => response.json())
  assert.equal(listed.memories[0].content, '回答先给结论，再给步骤。')
  const chat = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '你记得我喜欢怎样的回答吗？' }),
  })
  assert.equal(chat.status, 200)
  assert.match(lastChatPayload.messages[0].content, /回答先给结论，再给步骤。/)
  const deleted = await fetch(`${baseUrl}/api/memories/${memory.id}`, { method: 'DELETE' }).then((response) => response.json())
  assert.equal(deleted.ok, true)
})

test('selected knowledge roots index recursively, skip credential paths, update changed files, and remove their index', async () => {
  const root = join(process.cwd(), `.mori-root-test-${process.pid}-${Date.now()}`)
  const nested = join(root, 'nested')
  const ignored = join(root, 'credentials')
  await mkdir(nested, { recursive: true })
  await mkdir(ignored, { recursive: true })
  await writeFile(join(nested, 'project-notes.txt'), '第一版内容：海边灯塔。')
  await writeFile(join(ignored, 'private.md'), '不得进入索引的凭据目录短语。')
  await writeFile(join(root, 'passwords.txt'), '不得进入索引的密码文件短语。')
  const denied = await fetch(`${baseUrl}/api/knowledge/roots`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: join(root, 'AppData') }),
  })
  assert.equal(denied.status, 403)
  const added = await fetch(`${baseUrl}/api/knowledge/roots`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: root }),
  })
  assert.equal(added.status, 201)
  const searchFor = async (term) => fetch(`${baseUrl}/api/knowledge/search?q=${encodeURIComponent(term)}`).then((response) => response.json())
  const waitForSearch = async (term) => {
    const deadline = Date.now() + 5000
    let result = await searchFor(term)
    while (!result.results.length && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 80))
      result = await searchFor(term)
    }
    return result
  }
  assert.equal((await waitForSearch('海边灯塔')).results.length, 1)
  assert.equal((await searchFor('凭据目录短语')).results.length, 0)
  assert.equal((await searchFor('密码文件短语')).results.length, 0)

  await new Promise((resolve) => setTimeout(resolve, 100))
  await writeFile(join(nested, 'project-notes.txt'), '第二版更新内容：海边灯塔旁边新建了红色木质观景台。')
  await fetch(`${baseUrl}/api/knowledge/scan`, { method: 'POST' })
  assert.equal((await waitForSearch('红色木质观景台')).results.length, 1)
  const removed = await fetch(`${baseUrl}/api/knowledge/roots`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: root }),
  }).then((response) => response.json())
  assert.equal(removed.ok, true)
  assert.equal((await searchFor('红色木质观景台')).results.length, 0)
  await rm(root, { recursive: true, force: true })
})

test('images are described by local vision and audio/video are indexed as metadata only', async () => {
  const form = new FormData()
  form.append('files', new Blob(['local image bytes'], { type: 'image/png' }), 'garden.png')
  form.append('files', new Blob(['video bytes'], { type: 'video/mp4' }), 'walk.mp4')
  const response = await fetch(`${baseUrl}/api/knowledge/index`, { method: 'POST', body: form })
  const result = await response.json()
  assert.equal(result.indexed.length, 2)
  const visionPayload = [...chatPayloads].reverse().find((payload) => payload.messages.some((message) => message.images?.length))
  assert.equal(visionPayload.options.num_ctx, 16384)
  const imageSearch = await fetch(`${baseUrl}/api/knowledge/search?q=${encodeURIComponent('红色小车')}`).then((item) => item.json())
  assert.equal(imageSearch.results.length, 1)
  const videoSearch = await fetch(`${baseUrl}/api/knowledge/search?q=${encodeURIComponent('只记录媒体文件信息')}`).then((item) => item.json())
  assert.equal(videoSearch.results.length, 1)
})

test('desktop task session is limited to trusted Mori origins and authenticated requests', async () => {
  const deniedSession = await fetch(`${baseUrl}/api/desktop/session`, { headers: { Origin: 'https://example.com' } })
  assert.equal(deniedSession.status, 403)
  const deniedTasks = await fetch(`${baseUrl}/api/desktop/tasks`, { headers: { Origin: 'http://127.0.0.1:5173' } })
  assert.equal(deniedTasks.status, 403)
  const removedConnector = await fetch(`${baseUrl}/api/openclaw/delegate`, { method: 'POST' })
  assert.equal(removedConnector.status, 404)

  const session = await fetch(`${baseUrl}/api/desktop/session`, { headers: { Origin: 'http://127.0.0.1:5173' } }).then((response) => response.json())
  assert.equal(typeof session.token, 'string')
  const response = await fetch(`${baseUrl}/api/desktop/tasks`, {
    method: 'POST', headers: { Origin: 'http://127.0.0.1:5173', 'X-Mori-Desktop-Session': session.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ task: '打开记事本', conversationId: 'mori-main' }),
  })
  assert.equal(response.status, process.platform === 'win32' ? 201 : 501)
  if (response.status === 201) {
    const created = await response.json()
    assert.equal(created.task.state, 'awaiting_confirmation')
    const unconfirmed = await fetch(`${baseUrl}/api/desktop/tasks/${created.task.id}/control`, {
      method: 'POST', headers: { Origin: 'http://127.0.0.1:5173', 'X-Mori-Desktop-Session': session.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start', confirmed: false }),
    })
    assert.equal(unconfirmed.status, 400)
  }
})
