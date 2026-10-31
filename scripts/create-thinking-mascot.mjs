import { writeFile } from 'node:fs/promises'
import { createCanvas, loadImage } from '@napi-rs/canvas'

const [sourcePath, outputPath] = process.argv.slice(2)
if (!sourcePath || !outputPath) throw new Error('Usage: node scripts/create-thinking-mascot.mjs <source.png> <output.png>')

const image = await loadImage(sourcePath)
const width = image.width
const height = image.height
const source = createCanvas(width, height)
const sourceContext = source.getContext('2d')
sourceContext.drawImage(image, 0, 0)
const pixels = sourceContext.getImageData(0, 0, width, height)
const originalPixels = new Uint8ClampedArray(pixels.data)
const textMask = new Uint8Array(width * height)
for (let y = 385; y < Math.min(510, height); y++) for (let x = 135; x < Math.min(295, width); x++) {
  const offset = (y * width + x) * 4
  const red = originalPixels[offset]
  const green = originalPixels[offset + 1]
  const blue = originalPixels[offset + 2]
  if (Math.min(red, green, blue) > 178 && Math.max(red, green, blue) - Math.min(red, green, blue) < 62) textMask[y * width + x] = 1
}
const seedMask = textMask.slice()
for (let y = 389; y < Math.min(506, height); y++) for (let x = 139; x < Math.min(291, width); x++) {
  if (!seedMask[y * width + x]) continue
  for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) {
    const nextX = x + dx
    const nextY = y + dy
    if (nextX >= 0 && nextX < width && nextY >= 0 && nextY < height) textMask[nextY * width + nextX] = 1
  }
}
for (let y = 389; y < Math.min(506, height); y++) {
  let left = -1
  for (let x = 0; x < width; x++) {
    if (!textMask[y * width + x]) { left = x; continue }
    let right = x + 1
    while (right < width && textMask[y * width + right]) right++
    if (left < 0 || right >= width) continue
    const leftOffset = (y * width + left) * 4
    const rightOffset = (y * width + right) * 4
    for (let fillX = x; fillX < right; fillX++) {
      const weight = (fillX - left) / (right - left)
      for (let channel = 0; channel < 3; channel++) {
        const horizontal = originalPixels[leftOffset + channel] * (1 - weight) + originalPixels[rightOffset + channel] * weight
        pixels.data[(y * width + fillX) * 4 + channel] = Math.round(horizontal)
      }
    }
    x = right - 1
  }
}
let workingPixels = new Uint8ClampedArray(pixels.data)
for (let iteration = 0; iteration < 100; iteration++) {
  const nextPixels = new Uint8ClampedArray(workingPixels)
  for (let y = 390; y < Math.min(505, height - 1); y++) for (let x = 140; x < Math.min(290, width - 1); x++) {
    if (!textMask[y * width + x]) continue
    const offset = (y * width + x) * 4
    for (let channel = 0; channel < 3; channel++) {
      nextPixels[offset + channel] = Math.round((
        workingPixels[offset - 4 + channel] + workingPixels[offset + 4 + channel] +
        workingPixels[offset - width * 4 + channel] + workingPixels[offset + width * 4 + channel]
      ) / 4)
    }
  }
  workingPixels = nextPixels
}
pixels.data.set(workingPixels)
sourceContext.putImageData(pixels, 0, 0)

const output = createCanvas(width, height)
const context = output.getContext('2d')
context.save()
context.beginPath()
context.moveTo(88, 68)
context.bezierCurveTo(122, 32, 169, 24, 211, 31)
context.bezierCurveTo(274, 35, 320, 67, 332, 105)
context.bezierCurveTo(337, 127, 326, 142, 350, 162)
context.bezierCurveTo(362, 172, 360, 181, 342, 190)
context.bezierCurveTo(333, 216, 309, 237, 282, 250)
context.bezierCurveTo(270, 256, 264, 264, 264, 273)
context.bezierCurveTo(288, 282, 313, 301, 328, 322)
context.bezierCurveTo(354, 359, 371, 406, 379, 445)
context.bezierCurveTo(390, 478, 404, 491, 430, 495)
context.bezierCurveTo(435, 528, 430, 562, 418, 589)
context.bezierCurveTo(395, 613, 362, 633, 326, 643)
context.bezierCurveTo(266, 656, 202, 645, 156, 626)
context.bezierCurveTo(105, 603, 61, 573, 20, 541)
context.bezierCurveTo(1, 526, 0, 496, 0, 467)
context.lineTo(0, 299)
context.bezierCurveTo(12, 278, 36, 256, 61, 245)
context.bezierCurveTo(77, 237, 91, 237, 106, 244)
context.bezierCurveTo(138, 259, 161, 278, 187, 281)
context.bezierCurveTo(198, 282, 204, 278, 198, 265)
context.bezierCurveTo(187, 244, 163, 227, 149, 206)
context.bezierCurveTo(132, 180, 120, 149, 111, 118)
context.bezierCurveTo(101, 96, 94, 78, 88, 68)
context.closePath()
context.clip()
context.drawImage(source, 0, 0)
context.restore()

const result = context.getImageData(0, 0, width, height)
let left = width
let top = height
let right = 0
let bottom = 0
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  if (result.data[(y * width + x) * 4 + 3] < 8) continue
  left = Math.min(left, x)
  top = Math.min(top, y)
  right = Math.max(right, x)
  bottom = Math.max(bottom, y)
}
const margin = 6
left = Math.max(0, left - margin)
top = Math.max(0, top - margin)
right = Math.min(width, right + margin + 1)
bottom = Math.min(height, bottom + margin + 1)
const finalCanvas = createCanvas(right - left, bottom - top)
finalCanvas.getContext('2d').drawImage(output, left, top, right - left, bottom - top, 0, 0, right - left, bottom - top)
await writeFile(outputPath, finalCanvas.toBuffer('image/png'))
