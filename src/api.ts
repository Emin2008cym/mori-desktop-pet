export function apiUrl(path: string) {
  const base = window.__MORI_API_BASE__
  if ('__TAURI_INTERNALS__' in window && !base) throw new Error(window.__MORI_API_ERROR__ || 'Mori 本地服务尚未通过启动校验。')
  return `${base || ''}${path}`
}

export function apiFetch(path: string, init?: RequestInit) {
  return fetch(apiUrl(path), init)
}

declare global {
  interface Window {
    __MORI_API_BASE__?: string
    __MORI_API_ERROR__?: string
  }
}
