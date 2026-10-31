import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { classifyOpenClawError, resolveGatewayAuth } from '../server/openclaw-auth.mjs'

test('Gateway auth prefers an explicitly supplied token without reading local config', async () => {
  const auth = await resolveGatewayAuth({ manualToken: '  manual-secret  ', run: async () => { throw new Error('must not run') } })
  assert.deepEqual(auth, { token: 'manual-secret', source: 'manual' })
})

test('Gateway auth parses the local OpenClaw CLI JSON token without exposing command output', async () => {
  let invocation
  const auth = await resolveGatewayAuth({
    platform: 'win32',
    run: async (...args) => { invocation = args; return { stdout: '"local-secret-value"\n' } },
  })
  assert.equal(auth.token, 'local-secret-value')
  assert.equal(auth.source, 'local-config')
  assert.equal(invocation[0], 'cmd.exe')
  assert.equal(invocation[1].at(-1), 'openclaw.cmd config get gateway.auth.token --json')
})

test('Gateway auth reports a safe error when local CLI config is unavailable', async () => {
  await assert.rejects(resolveGatewayAuth({ platform: 'win32', configPath: join(tmpdir(), 'missing-openclaw-config.json'), run: async () => { throw new Error('secret in command output') } }), (error) => {
    assert.equal(error.code, 'credential_unavailable')
    assert.doesNotMatch(error.message, /secret/)
    return true
  })
})

test('Gateway auth reads only the configured token from the fixed local config when CLI is unavailable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mori-openclaw-auth-'))
  const configPath = join(directory, 'openclaw.json')
  try {
    await writeFile(configPath, JSON.stringify({ gateway: { auth: { token: 'config-secret' } }, unrelated: 'ignored' }))
    const auth = await resolveGatewayAuth({
      platform: 'win32',
      configPath,
      run: async () => { throw new Error('OpenClaw CLI is not on PATH') },
    })
    assert.deepEqual(auth, { token: 'config-secret', source: 'local-config' })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('Gateway connection failures receive actionable, credential-free categories', () => {
  assert.equal(classifyOpenClawError(new Error('unauthorized: gateway token mismatch')).code, 'token_mismatch')
  assert.equal(classifyOpenClawError(new Error('device pairing required')).code, 'pairing_required')
  assert.equal(classifyOpenClawError(new Error('computer.act driver unavailable')).code, 'cua_unavailable')
  assert.equal(classifyOpenClawError(new Error('connect ECONNREFUSED')).code, 'gateway_unavailable')
})
