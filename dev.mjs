import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
const children = [
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], { cwd: root, stdio: 'inherit', env: process.env }),
]
let stopping = false
function stop(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) if (!child.killed) child.kill('SIGTERM')
  setTimeout(() => process.exit(code), 350)
}
for (const child of children) child.on('exit', (code) => { if (!stopping) stop(code || 0) })
process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
