import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { invoke } from '@tauri-apps/api/core'
import './index.css'
import App from './App.tsx'

const root = createRoot(document.getElementById('root')!)

function renderApplication() {
  root.render(<StrictMode><App /></StrictMode>)
}

async function start() {
  if ('__TAURI_INTERNALS__' in window) {
    const config = await invoke<{ apiBase?: string; instanceId?: string; error?: string }>('backend_api_config')
    if (config.error || !config.apiBase || !config.instanceId) {
      throw new Error(config.error || 'Mori 本地服务没有返回有效连接信息。')
    }
    const response = await fetch(`${config.apiBase}/api/health`, { cache: 'no-store', signal: AbortSignal.timeout(5000) })
    if (!response.ok) throw new Error(`Mori 本地服务启动检查失败（HTTP ${response.status}）。`)
    const health = await response.json() as { serviceVersion?: number; serviceInstanceId?: string }
    if (health.serviceVersion !== 2 || health.serviceInstanceId !== config.instanceId) {
      throw new Error('Mori 连接到的本地服务与当前应用版本不匹配。请退出旧版 Mori 后安装或启动新版。')
    }
    window.__MORI_API_BASE__ = config.apiBase
  }
  renderApplication()
}

void start().catch((reason: unknown) => {
  window.__MORI_API_ERROR__ = reason instanceof Error ? reason.message : String(reason)
  renderApplication()
})
