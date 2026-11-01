// PDF text extraction does not need a native canvas renderer. Keep the parser out
// of service startup so a PDF-specific failure cannot disable chat and settings.
import DOMMatrix from '@thednp/dommatrix'

let parser
export async function openTextPdf(data) {
  globalThis.DOMMatrix ??= DOMMatrix
  parser ??= import('pdfjs-dist/legacy/build/pdf.mjs').catch((error) => {
    parser = undefined
    throw error
  })
  const { getDocument } = await parser
  return getDocument({
    data: new Uint8Array(data),
    isEvalSupported: false,
    isOffscreenCanvasSupported: false,
    disableFontFace: true,
    useSystemFonts: true,
  }).promise
}
