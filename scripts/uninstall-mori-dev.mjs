import { spawnSync } from 'node:child_process'
import { readFile, rm, lstat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'

if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) throw new Error('请在 Windows 中运行卸载器。')
const installRoot = resolve(process.env.LOCALAPPDATA, 'Programs', 'MoriDev')
if ((await lstat(installRoot)).isSymbolicLink()) throw new Error('安装目录是链接，未执行卸载。')
const marker = JSON.parse(await readFile(join(installRoot, '.mori-dev-install.json'), 'utf8'))
if (marker.application !== 'MoriDevPayload' || marker.installMode !== 'portable') throw new Error('安装标记不匹配，未执行卸载。')
const terminal = createInterface({ input: process.stdin, output: process.stdout })
let answer
try { answer = await terminal.question('卸载 Mori 应用并保留聊天/知识库？请输入 YES：') } finally { terminal.close() }
if (answer.trim() !== 'YES') process.exit(0)
const psRoot = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0')
const command = "$ErrorActionPreference='Stop'; if(Get-Process -Name 'mori-desktop-pet' -ErrorAction SilentlyContinue){ throw '请先退出 Mori，再卸载。' }; $locations=@((Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'Mori 桌宠.lnk'), (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs\\Mori Desktop Pet.lnk')); $shell=New-Object -ComObject WScript.Shell; foreach($location in $locations){ if(Test-Path -LiteralPath $location){ $shortcut=$shell.CreateShortcut($location); if($shortcut.TargetPath -eq $env:MORI_INSTALL_EXE){ Remove-Item -LiteralPath $location } } }; $run='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'; $value=(Get-ItemProperty -Path $run -ErrorAction SilentlyContinue).Mori; if($value -and $value.Contains($env:MORI_INSTALL_EXE)){ Remove-ItemProperty -Path $run -Name Mori -ErrorAction SilentlyContinue }"
const result = spawnSync(join(psRoot, 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', command], { stdio: 'inherit', env: { ...process.env, PSModulePath: join(psRoot, 'Modules'), MORI_INSTALL_EXE: join(installRoot, 'mori-desktop-pet.exe') } })
if (result.error) throw result.error
if (result.status !== 0) throw new Error(`卸载未完成，退出码 ${result.status}。`)
await rm(installRoot, { recursive: true, force: true })
console.log('Mori 已卸载，聊天和知识库数据已保留。')
