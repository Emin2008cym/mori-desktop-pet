import assert from 'node:assert/strict'
import { test } from 'node:test'
import { requiresDesktopApproval, validateDesktopAction } from '../server/desktop-protocol.mjs'

test('desktop actions reject unknown operations and out-of-range coordinates', () => {
  assert.equal(validateDesktopAction({ action: 'shell', command: 'whoami', reason: 'inspect' }).ok, false)
  assert.equal(validateDesktopAction({ action: 'click', x: 99999, y: 2, button: 'left', clicks: 1, reason: 'click' }).ok, false)
  assert.equal(validateDesktopAction({ action: 'key', keys: ['WIN', 'R'], reason: 'open' }).ok, false)
  assert.equal(validateDesktopAction({ action: 'key', keys: ['R', 'WIN'], reason: 'open' }).ok, false)
  assert.equal(validateDesktopAction({ action: 'key', keys: ['DELETE', 'ALT', 'CTRL'], reason: 'system action' }).ok, false)
  assert.equal(validateDesktopAction({ action: 'key', keys: ['CTRL', 'ALT', 'DELETE'], reason: 'system action' }).ok, false)
})

test('desktop actions accept bounded visible input and text', () => {
  assert.equal(validateDesktopAction({ action: 'type', text: '你好 Mori', reason: 'enter text' }).ok, true)
  assert.equal(validateDesktopAction({ action: 'wait', milliseconds: 500, reason: 'wait for page' }).ok, true)
})

test('submit key presses and labeled destructive controls require another approval', () => {
  assert.equal(requiresDesktopApproval({ action: 'key', keys: ['ENTER'] }), true)
  assert.equal(requiresDesktopApproval({ action: 'key', keys: ['DELETE'] }), true)
  assert.equal(requiresDesktopApproval({ action: 'click', reason: '删除文件' }, []), true)
  assert.equal(requiresDesktopApproval({ action: 'click', x: 120, y: 210, button: 'left', clicks: 1 }, [
    { name: '删除文件', left: 100, top: 200, right: 160, bottom: 230 },
  ]), true)
  assert.equal(requiresDesktopApproval({ action: 'click', x: 20, y: 20, button: 'left', clicks: 1 }, []), false)
})
