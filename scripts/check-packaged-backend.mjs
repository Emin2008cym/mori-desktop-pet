import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'
import { once } from 'node:events'

test('isolated shipped runtime starts and indexes a PDF with optional native canvas absent', { timeout: 60000 }, async () => {
  const root = dirname(dirname(fileURLToPath(import.meta.url)))
  const temporary = await mkdtemp(join(tmpdir(), 'mori-packaged-test-'))
  let child
  let log = ''
  try {
    const runtime = join(temporary, 'app')
    await cp(join(root, 'src-tauri', 'resources'), runtime, { recursive: true })
    assert.equal(existsSync(join(runtime, 'node_modules', '@napi-rs', 'canvas', 'package.json')), false)
    const reserve = createServer()
    reserve.listen(0, '127.0.0.1')
    await once(reserve, 'listening')
    const port = reserve.address().port
    await new Promise((resolve) => reserve.close(resolve))
    child = spawn(join(runtime, 'binaries', process.platform === 'win32' ? 'node.exe' : 'node'), [join(runtime, 'server', 'index.mjs')], {
      cwd: runtime,
      env: { ...process.env, NODE_PATH: '', MORI_DATA_DIR: join(temporary, 'data'), MORI_PORT: String(port), MORI_AUTOCONNECT_OPENCLAW: '0', OLLAMA_URL: 'http://127.0.0.1:1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.on('data', (data) => { log += data })
    child.stderr.on('data', (data) => { log += data })
    const url = `http://127.0.0.1:${port}`
    let healthy = false
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`Bundled backend exited: ${log}`)
      try { healthy = (await fetch(`${url}/api/knowledge/documents`)).ok } catch {}
      if (healthy) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert.ok(healthy, log)
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      '<< /Length 64 >>\nstream\nBT /F1 12 Tf 24 80 Td (Mori isolated runtime marker) Tj ET\nendstream',
    ]
    const pdf = `%PDF-1.4\n${objects.map((object, i) => `${i + 1} 0 obj\n${object}\nendobj`).join('\n')}\ntrailer\n<< /Root 1 0 R >>\n%%EOF`
    const form = new FormData()
    form.append('files', new Blob([pdf], { type: 'application/pdf' }), 'isolated.pdf')
    const indexed = await fetch(`${url}/api/knowledge/index`, { method: 'POST', body: form }).then((response) => response.json())
    assert.equal(indexed.indexed?.length, 1, `${JSON.stringify(indexed)}\n${log}`)
    const searched = await fetch(`${url}/api/knowledge/search?q=isolated%20runtime%20marker`).then((response) => response.json())
    assert.ok(searched.results.some((result) => result.source === 'isolated.pdf'), log)
  } finally {
    if (child && child.exitCode === null) {
      const stopped = once(child, 'exit')
      child.kill()
      await stopped
    }
    await rm(temporary, { recursive: true, force: true })
  }
})
