import { spawnSync } from 'node:child_process'
import { cp, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

const sourceRoot = dirname(fileURLToPath(import.meta.url))
const subject = 'CN=MoriLocalDeveloper'
const packageName = 'Mori.LocalDev'
const applicationName = 'MoriDevPayload'
const localAppData = process.env.LOCALAPPDATA
if (process.platform !== 'win32' || !localAppData) throw new Error('此安装器只能在 Windows 用户会话中运行。')

const installRoot = resolve(localAppData, 'Programs', 'MoriDev')
const markerPath = join(installRoot, '.mori-dev-install.json')
const executableName = 'mori-desktop-pet.exe'
const executableSource = join(sourceRoot, executableName)
const resourcesSource = join(sourceRoot, 'resources')
const assetsSource = join(sourceRoot, 'Assets')
const templatePath = join(sourceRoot, 'AppxManifest.xml')
const version = (await readFile(join(sourceRoot, 'package-version.txt'), 'utf8')).trim()
if (!/^\d+\.\d+\.\d+\.\d+$/.test(version)) throw new Error(`开发包版本格式无效：${version}`)
if (![executableSource, resourcesSource, assetsSource, templatePath].every(existsSync)) {
  throw new Error('开发包内容不完整。请从 GitHub Actions 下载并完整解压 Mori-Dev-Payload.zip。')
}

if (existsSync(installRoot)) {
  let marker
  try { marker = JSON.parse(await readFile(markerPath, 'utf8')) } catch {}
  if (marker?.application !== applicationName) {
    throw new Error(`安装目录已存在且不是 Mori 创建的目录，未覆盖：${installRoot}`)
  }
}

const powershellPath = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, { encoding: 'utf8', stdio: 'inherit', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${executable} 退出码 ${result.status}`)
  return result
}
function ps(command, env = {}) {
  return run(powershellPath, ['-NoProfile', '-NonInteractive', '-Command', command], {
    env: { ...process.env, ...env },
  })
}
function findSdkTool(toolName) {
  const root = 'C:\\Program Files (x86)\\Windows Kits\\10\\bin'
  if (!existsSync(root)) throw new Error('未找到 Windows SDK。请安装 Windows SDK 后重试。')
  const versions = readdirSync(root).filter((name) => /^10\./.test(name)).sort().reverse()
  for (const versionName of versions) {
    const tool = join(root, versionName, 'x64', `${toolName}.exe`)
    if (existsSync(tool)) return tool
  }
  throw new Error(`Windows SDK 中未找到 ${toolName}.exe。`)
}

const readline = createInterface({ input: stdin, output: stdout })
try {
  stdout.write(`Mori 本机开发安装\n\n将仅在当前 Windows 用户下信任 Mori 专用的开发证书，并注册本机稀疏 MSIX 包身份。不会修改 Smart App Control、机器级证书库或 Trusted Root；这不是面向他人分发的代码签名。\n安装目录：${installRoot}\n包版本：${version}\n\n`)
  const answer = (await readline.question('确认继续请输入 YES：')).trim()
  if (answer !== 'YES') throw new Error('已取消；未修改证书信任或安装包。')
} finally {
  readline.close()
}

const processCheck = spawnSync(powershellPath, ['-NoProfile', '-NonInteractive', '-Command', "if (Get-Process -Name 'mori-desktop-pet' -ErrorAction SilentlyContinue) { exit 3 }"], { stdio: 'inherit' })
if (processCheck.status === 3) throw new Error('请先退出正在运行的 Mori，再重新安装。')
if (processCheck.status !== 0) throw new Error('无法确认 Mori 是否正在运行，停止安装。')

const makeAppx = findSdkTool('MakeAppx')
const signTool = findSdkTool('SignTool')
const tempRoot = join(tmpdir(), `mori-dev-${randomUUID()}`)
const manifestRoot = join(tempRoot, 'manifest')
const packagePath = join(tempRoot, 'Mori.identity.msix')
const certificatePath = join(tempRoot, 'MoriLocalDeveloper.cer')
const shortcutPath = join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Mori Desktop Pet.lnk')
let certificateState
let packageRegistered = false

try {
  await mkdir(manifestRoot, { recursive: true })
  const manifest = (await readFile(templatePath, 'utf8')).replace('__PACKAGE_VERSION__', version)
  if (manifest.includes('__PACKAGE_VERSION__')) throw new Error('MSIX 清单版本模板替换失败。')
  await writeFile(join(manifestRoot, 'AppxManifest.xml'), manifest, 'utf8')

  const certScript = `$subject='${subject}'; $cert=Get-ChildItem Cert:\\CurrentUser\\My | Where-Object { $_.Subject -eq $subject -and $_.HasPrivateKey -and $_.NotAfter -gt (Get-Date) -and ($_.EnhancedKeyUsageList.ObjectId.Value -contains '1.3.6.1.5.5.7.3.3') } | Sort-Object NotAfter -Descending | Select-Object -First 1; $created=$false; if(-not $cert){ $cert=New-SelfSignedCertificate -Type Custom -Subject $subject -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -KeyUsage DigitalSignature -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3','2.5.29.19={text}') -CertStoreLocation Cert:\\CurrentUser\\My -NotAfter (Get-Date).AddYears(5); $created=$true }; Export-Certificate -Cert $cert -FilePath $env:MORI_DEV_CERT -Force | Out-Null; if(-not (Get-ChildItem Cert:\\CurrentUser\\TrustedPeople | Where-Object Thumbprint -eq $cert.Thumbprint)){ Import-Certificate -FilePath $env:MORI_DEV_CERT -CertStoreLocation Cert:\\CurrentUser\\TrustedPeople | Out-Null }; [pscustomobject]@{Thumbprint=$cert.Thumbprint;Created=$created}|ConvertTo-Json -Compress`
  const certResult = spawnSync(powershellPath, ['-NoProfile', '-NonInteractive', '-Command', certScript], {
    encoding: 'utf8',
    env: { ...process.env, MORI_DEV_CERT: certificatePath },
  })
  if (certResult.status !== 0) throw new Error(certResult.stderr || '创建/登记 Mori 当前用户开发证书失败。')
  certificateState = JSON.parse(certResult.stdout.trim())
  stdout.write(`Mori 开发证书指纹：${certificateState.Thumbprint}\n`)

  await mkdir(installRoot, { recursive: true })
  await copyFile(executableSource, join(installRoot, executableName))
  await cp(resourcesSource, join(installRoot, 'resources'), { recursive: true, force: true })
  await cp(assetsSource, join(installRoot, 'Assets'), { recursive: true, force: true })
  await writeFile(join(installRoot, 'AppxManifest.xml'), manifest, 'utf8')
  await writeFile(markerPath, JSON.stringify({ application: applicationName, packageName, version, certificateThumbprint: certificateState.Thumbprint }, null, 2), 'utf8')

  run(makeAppx, ['pack', '/o', '/d', manifestRoot, '/nv', '/p', packagePath])
  run(signTool, ['sign', '/fd', 'SHA256', '/s', 'My', '/sha1', certificateState.Thumbprint, packagePath])
  run(signTool, ['verify', '/pa', '/v', packagePath])
  ps("$ErrorActionPreference='Stop'; Add-AppxPackage -Path $env:MORI_DEV_PACKAGE -ExternalLocation $env:MORI_DEV_INSTALL_ROOT -ForceUpdateFromAnyVersion -ErrorAction Stop", {
    MORI_DEV_PACKAGE: packagePath,
    MORI_DEV_INSTALL_ROOT: installRoot,
  })
  packageRegistered = true

  ps("$ErrorActionPreference='Stop'; $shell=New-Object -ComObject WScript.Shell; $shortcut=$shell.CreateShortcut($env:MORI_DEV_SHORTCUT); $shortcut.TargetPath=$env:MORI_DEV_EXE; $shortcut.WorkingDirectory=$env:MORI_DEV_ROOT; $shortcut.Save()", {
    MORI_DEV_SHORTCUT: shortcutPath,
    MORI_DEV_EXE: join(installRoot, executableName),
    MORI_DEV_ROOT: installRoot,
  })
  stdout.write(`\nMori 已安装到当前用户：${installRoot}\n开始菜单已创建“Mori Desktop Pet”。本机模型、历史和 OpenClaw 凭据仍使用应用本地存储。\n`)
} catch (error) {
  if (certificateState?.Created && !packageRegistered) {
    const cleanup = `$thumb='${certificateState.Thumbprint}'; foreach($store in @('Cert:\\CurrentUser\\TrustedPeople','Cert:\\CurrentUser\\My')){ Get-ChildItem $store | Where-Object Thumbprint -eq $thumb | Remove-Item -ErrorAction SilentlyContinue }`
    spawnSync(powershellPath, ['-NoProfile', '-NonInteractive', '-Command', cleanup], { stdio: 'ignore' })
  }
  throw error
} finally {
  await rm(tempRoot, { recursive: true, force: true })
}
