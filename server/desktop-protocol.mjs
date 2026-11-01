const safeKeys = new Set([
  'ENTER', 'TAB', 'ESC', 'ESCAPE', 'BACKSPACE', 'DELETE', 'HOME', 'END', 'PAGEUP', 'PAGEDOWN',
  'LEFT', 'RIGHT', 'UP', 'DOWN', 'CTRL', 'CONTROL', 'ALT', 'SHIFT', 'WIN', 'META',
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split(''),
])

export const desktopActionSchema = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['click', 'drag', 'scroll', 'type', 'key', 'wait', 'ask_user', 'finish'] },
    x: { type: 'integer', minimum: -32768, maximum: 32767 },
    y: { type: 'integer', minimum: -32768, maximum: 32767 },
    toX: { type: 'integer', minimum: -32768, maximum: 32767 },
    toY: { type: 'integer', minimum: -32768, maximum: 32767 },
    button: { type: 'string', enum: ['left', 'right', 'middle'] },
    clicks: { type: 'integer', enum: [1, 2] },
    deltaX: { type: 'integer', minimum: -1200, maximum: 1200 },
    deltaY: { type: 'integer', minimum: -1200, maximum: 1200 },
    text: { type: 'string', maxLength: 1000 },
    keys: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string', maxLength: 16 } },
    milliseconds: { type: 'integer', minimum: 100, maximum: 5000 },
    prompt: { type: 'string', maxLength: 500 },
    summary: { type: 'string', maxLength: 2000 },
    reason: { type: 'string', maxLength: 300 },
  },
  required: ['action', 'reason'],
  additionalProperties: false,
}

const numeric = (value, min, max) => Number.isInteger(value) && value >= min && value <= max

export function validateDesktopAction(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: '模型返回的动作不是对象。' }
  const { action, reason } = value
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 300) return { ok: false, error: '动作缺少有效说明。' }
  const coordinate = () => numeric(value.x, -32768, 32767) && numeric(value.y, -32768, 32767)
  switch (action) {
    case 'click':
      if (!coordinate() || !['left', 'right', 'middle'].includes(value.button) || ![1, 2].includes(value.clicks)) return { ok: false, error: '点击动作参数无效。' }
      break
    case 'drag':
      if (!coordinate() || !numeric(value.toX, -32768, 32767) || !numeric(value.toY, -32768, 32767)) return { ok: false, error: '拖动动作参数无效。' }
      break
    case 'scroll':
      if (!coordinate() || !numeric(value.deltaX, -1200, 1200) || !numeric(value.deltaY, -1200, 1200) || (!value.deltaX && !value.deltaY)) return { ok: false, error: '滚动动作参数无效。' }
      break
    case 'type':
      if (typeof value.text !== 'string' || !value.text.length || value.text.length > 1000) return { ok: false, error: '输入文字动作参数无效。' }
      break
    case 'key':
      if (!Array.isArray(value.keys) || value.keys.length < 1 || value.keys.length > 4 || value.keys.some((key) => typeof key !== 'string' || !safeKeys.has(key.toUpperCase()))) return { ok: false, error: '按键不在 Mori 允许的范围内。' }
      {
        const keys = value.keys.map((key) => key.toUpperCase().replace('META', 'WIN').replace('CONTROL', 'CTRL').replace('RETURN', 'ENTER').replace('ESCAPE', 'ESC')).sort()
        if (['R+WIN', 'CTRL+ESC+SHIFT', 'ALT+CTRL+DELETE'].includes(keys.join('+'))) return { ok: false, error: '该系统快捷键不能由桌面任务触发。' }
      }
      break
    case 'wait':
      if (!numeric(value.milliseconds, 100, 5000)) return { ok: false, error: '等待时间必须在 100 到 5000 毫秒之间。' }
      break
    case 'ask_user':
      if (typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > 500) return { ok: false, error: '询问用户动作缺少问题内容。' }
      break
    case 'finish':
      if (typeof value.summary !== 'string' || !value.summary.trim() || value.summary.length > 2000) return { ok: false, error: '完成动作缺少结果说明。' }
      break
    default:
      return { ok: false, error: '模型请求了 Mori 不支持的桌面动作。' }
  }
  return { ok: true, value }
}

const highImpact = /发送|提交|付款|支付|删除|发布|下单|购买|转账|确认|send|submit|pay|delete|publish|purchase|place order|transfer|confirm/i

export function requiresDesktopApproval(action, elements = []) {
  if (!['click', 'key'].includes(action.action)) return false
  if (highImpact.test(action.reason || '')) return true
  if (action.action === 'key' && action.keys.some((key) => ['ENTER', 'RETURN', 'DELETE'].includes(key.toUpperCase()))) return true
  if (action.action !== 'click') return false
  const x = action.x
  const y = action.y
  return elements.some((element) => highImpact.test(element.name || '') && x >= element.left && x <= element.right && y >= element.top && y <= element.bottom)
}
