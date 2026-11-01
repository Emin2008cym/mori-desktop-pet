import { spawn, spawnSync } from 'node:child_process'
import { cp, mkdir, readFile, writeFile, lstat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) throw new Error('请在 Windows 中运行安装器。')
const source = dirname(fileURLToPath(import.meta.url))
const installRoot = resolve(process.env.LOCALAPPDATA, 'Programs', 'MoriDev')
const markerPath = join(installRoot, '.mori-dev-install.json')
const executableName = 'mori-desktop-pet.exe'
const version = (await readFile(join(source, 'package-version.txt'), 'utf8')).trim()
for (const path of [executableName, 'resources/server/index.mjs', 'resources/binaries/node.exe', 'resources/node_modules']) {
  if (!existsSync(join(source, path))) throw new Error(`安装包不完整，缺少 ${path}。请先完整解压 Mori-Dev-Payload.zip。`)
}
if (existsSync(installRoot)) {
  if ((await lstat(installRoot)).isSymbolicLink()) throw new Error('安装目录是链接，停止安装以免覆盖其他文件。')
  let marker
  try { marker = JSON.parse(await readFile(markerPath, 'utf8')) } catch {}
  if (marker?.application !== 'MoriDevPayload') throw new Error(`目录已存在且不是 Mori 创建的目录，未覆盖：${installRoot}`)
}
const psRoot = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0')
const environment = {
  ...process.env,
  PSModulePath: [join(process.env.ProgramFiles ?? 'C:\\Program Files', 'WindowsPowerShell', 'Modules'), join(psRoot, 'Modules')].join(';'),
  MORI_INSTALL_ROOT: installRoot,
  MORI_INSTALL_EXE: join(installRoot, executableName),
}
function ps(command) {
  const result = spawnSync(join(psRoot, 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference='Stop'; ${command}`], { env: environment, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Windows 安装操作未完成，退出码 ${result.status}。`)
}
ps("if(Get-Process -Name 'mori-desktop-pet' -ErrorAction SilentlyContinue){ throw '请先从托盘退出 Mori，再运行安装器。' }")
console.log(`正在安装 Mori ${version} 到 ${installRoot}。不导入证书，不修改 SAC，不注册 MSIX。`)
await mkdir(installRoot, { recursive: true })
await writeFile(markerPath, JSON.stringify({ application: 'MoriDevPayload', version, installMode: 'portable' }, null, 2))
await cp(join(source, executableName), join(installRoot, executableName), { force: true })
// Match Tauri's bundle.resources map: Windows resource_dir is beside the executable.
await cp(join(source, 'resources'), installRoot, { recursive: true, force: true })
await cp(join(source, 'uninstall-mori-dev.mjs'), join(installRoot, 'uninstall-mori-dev.mjs'), { force: true })
ps("$shell=New-Object -ComObject WScript.Shell; $locations=@((Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'Mori 桌宠.lnk'), (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs\\Mori Desktop Pet.lnk')); foreach($location in $locations){ $shortcut=$shell.CreateShortcut($location); $shortcut.TargetPath=$env:MORI_INSTALL_EXE; $shortcut.WorkingDirectory=$env:MORI_INSTALL_ROOT; $shortcut.Save() }")
console.log('安装完成。以后双击桌面的“Mori 桌宠”，应用自动管理本地服务。')
if (!process.argv.includes('--no-launch')) {
  const child = spawn(join(installRoot, executableName), [], { cwd: installRoot, detached: true, stdio: 'ignore', windowsHide: true })
  child.on('error', (error) => console.error(`无法启动 Mori：${error.message}`))
  child.unref()
}
