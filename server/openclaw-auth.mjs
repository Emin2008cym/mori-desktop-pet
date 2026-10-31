import { execFile as execFileCallback } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

export async function resolveGatewayAuth({ manualToken, platform = process.platform, run = execFile, configPath = join(homedir(), '.openclaw', 'openclaw.json') } = {}) {
  if (typeof manualToken === 'string' && manualToken.trim()) {
    const token = manualToken.trim()
    if (token.length > 512) throw Object.assign(new Error('Gateway 令牌格式无效。'), { code: 'invalid_token' })
    return { token, source: 'manual' }
  }

  let token
  try {
    const result = platform === 'win32'
      ? await run('cmd.exe', ['/d', '/s', '/c', 'openclaw.cmd config get gateway.auth.token --json'], { timeout: 5000, windowsHide: true, maxBuffer: 65536 })
      : await run('openclaw', ['config', 'get', 'gateway.auth.token', '--json'], { timeout: 5000, maxBuffer: 65536 })
    token = JSON.parse(result.stdout.trim())
  } catch { /* Use the fixed local config file when the OpenClaw CLI is not on PATH. */ }

  if (typeof token === 'string' && token.trim() && token.length <= 512) {
    return { token: token.trim(), source: 'local-config' }
  }

  try {
    const config = JSON.parse(await readFile(configPath, 'utf8'))
    token = config?.gateway?.auth?.token
    if (typeof token === 'string' && token.trim() && token.length <= 512 && !/^\$\{[^}]+\}$/.test(token.trim())) {
      return { token: token.trim(), source: 'local-config' }
    }
  } catch { /* Keep credential errors generic and never expose file contents. */ }

  throw Object.assign(new Error('无法从本机 OpenClaw 配置读取 Gateway 令牌。'), { code: 'credential_unavailable' })
}

export function classifyOpenClawError(error) {
  if (error?.code === 'credential_unavailable') {
    return { code: 'credential_unavailable', message: '无法从本机 OpenClaw 配置读取 Gateway 令牌。请展开“手动高级入口”输入令牌，或先检查 OpenClaw CLI 登录配置。' }
  }
  if (error?.code === 'invalid_token') {
    return { code: 'invalid_token', message: 'Gateway 令牌格式无效。请检查令牌长度后重试。' }
  }
  const message = String(error?.message || error || '').toLowerCase()
  if (/token.*mismatch|invalid.*token|unauthori[sz]ed|auth.*reject/.test(message)) {
    return { code: 'token_mismatch', message: 'Gateway 拒绝了这个令牌。请确认 Mori 与 OpenClaw 使用同一个 Gateway；也可以展开“手动高级入口”输入有效令牌。' }
  }
  if (/pair|approve|device.*pending|not.*paired/.test(message)) {
    return { code: 'pairing_required', message: 'Gateway 需要先批准 Mori 设备。请在 OpenClaw 的设备配对列表中批准这台 Mori 设备，然后重新连接。' }
  }
  if (/computer\.act|cua|computer use|driver|screen\.snapshot/.test(message)) {
    return { code: 'cua_unavailable', message: 'Windows 桌面控制未就绪。请检查登录用户桌面节点、CUA 驱动和 computer.act 能力。' }
  }
  if (/node.*(offline|disconnect|unavailable)|no.*desktop.*node/.test(message)) {
    return { code: 'node_unavailable', message: 'Windows 桌面节点未连接。请在当前登录用户桌面中启动并配对 OpenClaw 节点。' }
  }
  if (/econnrefused|enotfound|timeout|timed out|connect.*fail|socket/.test(message)) {
    return { code: 'gateway_unavailable', message: '无法连接本机 OpenClaw Gateway。请检查 Gateway 是否运行以及地址是否为当前端口。' }
  }
  return { code: 'connection_failed', message: 'OpenClaw 连接或能力检查失败。请查看 Gateway、设备配对和桌面节点状态后重试。' }
}
