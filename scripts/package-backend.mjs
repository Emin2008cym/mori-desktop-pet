import { cp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const resources = join(root, 'src-tauri', 'resources')

await rm(resources, { recursive: true, force: true })
await mkdir(join(resources, 'server'), { recursive: true })
await mkdir(join(resources, 'binaries'), { recursive: true })
await cp(join(root, 'server', 'package.json'), join(resources, 'package.json'))
await cp(join(root, 'server', 'package-lock.json'), join(resources, 'package-lock.json'))
await cp(join(root, 'server', 'index.mjs'), join(resources, 'server', 'index.mjs'))
await cp(join(root, 'server', 'desktop-tasks.mjs'), join(resources, 'server', 'desktop-tasks.mjs'))
await cp(join(root, 'server', 'desktop-protocol.mjs'), join(resources, 'server', 'desktop-protocol.mjs'))
await cp(join(root, 'server', 'pdf-text.mjs'), join(resources, 'server', 'pdf-text.mjs'))
await cp(process.execPath, join(resources, 'binaries', process.platform === 'win32' ? 'node.exe' : 'node'))

const npmCli = process.env.npm_execpath
if (!npmCli) throw new Error('npm_execpath is missing; run this script with npm run package:backend.')
const install = spawnSync(process.execPath, [npmCli, 'ci', '--omit=dev', '--omit=optional', '--prefix', resources, '--no-audit', '--no-fund'], { cwd: resources, stdio: 'inherit' })
if (install.status !== 0) throw new Error(`Bundled Node dependencies install failed with status ${install.status}.`)

console.log(`Packaged Node ${process.version}, service code, and locked backend dependencies.`)
