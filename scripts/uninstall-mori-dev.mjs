import { spawnSync } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

const localAppData = process.env.LOCALAPPDATA
if (process.platform !== 'win32' || !localAppData) throw new Error('此卸载器只能在 Windows 用户会话中运行。')
const installRoot = resolve(localAppData, 'Programs', 'MoriDev')
const markerPath = join(installRoot, '.mori-dev-install.json')
if (!existsSync(markerPath)) throw new Error(`未找到 Mori 开发版安装标记：${installRoot}`)
const marker = JSON.parse(await readFile(markerPath, 'utf8'))
if (marker.application !== 'MoriDevPayload' || marker.packageName !== 'Mori.LocalDev' || !/^[A-F0-9]+$/i.test(marker.certificateThumbprint)) {
  throw new Error('Mori 安装标记不匹配，未执行卸载。')
}

const readline = createInterface({ input: stdin, output: stdout })
let answer
try {
  answer = (await readline.question('确认卸载 Mori 开发包并移除其当前用户开发证书？本地聊天/知识库数据会保留。请输入 YES：')).trim()
} finally {
  readline.close()
}
if (answer !== 'YES') throw new Error('已取消卸载。')

const powershellPath = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const command = `$ErrorActionPreference='Stop'; if(Get-Process -Name 'mori-desktop-pet' -ErrorAction SilentlyContinue){ throw '请先退出 Mori，再卸载。' }; $package=Get-AppxPackage -Name 'Mori.LocalDev' -ErrorAction SilentlyContinue; if($package){ Remove-AppxPackage -Package $package.PackageFullName -ErrorAction Stop }; $thumb='${marker.certificateThumbprint}'; $cert=Get-ChildItem Cert:\\CurrentUser\\My | Where-Object { $_.Thumbprint -eq $thumb -and $_.Subject -eq 'CN=MoriLocalDeveloper' }; if($cert){ Get-ChildItem Cert:\\CurrentUser\\TrustedPeople | Where-Object { $_.Thumbprint -eq $thumb -and $_.Subject -eq 'CN=MoriLocalDeveloper' } | Remove-Item -ErrorAction SilentlyContinue; $cert | Remove-Item -ErrorAction SilentlyContinue }; $shortcut=Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs\\Mori Desktop Pet.lnk'; if(Test-Path $shortcut){ Remove-Item -LiteralPath $shortcut -Force }`
const result = spawnSync(powershellPath, ['-NoProfile', '-NonInteractive', '-Command', command], { stdio: 'inherit' })
if (result.error) throw result.error
if (result.status !== 0) throw new Error(`注销 Mori 开发包失败，退出码 ${result.status}。`)
await rm(installRoot, { recursive: true, force: true })
stdout.write('Mori 开发包和专用证书已移除；Mori 本地应用数据未删除。\n')
