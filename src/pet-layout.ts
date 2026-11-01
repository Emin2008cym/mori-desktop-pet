export const PET_WIDTH = 84
export const PET_HEIGHT = 102
type Point = { x: number; y: number }
type Screen = Point & { width: number; height: number }

// Anchor always means the top-left of the small pet, never the window's center.
// Expanding the frame changes offsets, not the character's desktop coordinates.
export function petLayout(anchor: Point, screen: Screen, scale: number, panelHeight = 0) {
  const petX = Math.max(screen.x, Math.min(screen.x + screen.width - PET_WIDTH * scale, anchor.x))
  const petY = Math.max(screen.y, Math.min(screen.y + screen.height - PET_HEIGHT * scale, anchor.y))
  if (!panelHeight) return {
    x: petX, y: petY, width: PET_WIDTH, height: PET_HEIGHT,
    pet: { left: 0, top: 0 }, panel: { left: 0, top: 0, width: 0, height: 0 },
  }
  const rightSpace = (screen.x + screen.width - petX) / scale - PET_WIDTH - 8
  const leftSpace = (petX - screen.x) / scale - 8
  const right = rightSpace >= 292 || rightSpace >= leftSpace
  const width = Math.min(292, Math.max(120, right ? rightSpace : leftSpace))
  const height = Math.min(panelHeight, screen.height / scale)
  const panelX = right ? petX + (PET_WIDTH + 8) * scale : petX - (width + 8) * scale
  const panelY = Math.max(screen.y, Math.min(screen.y + screen.height - height * scale, petY - 30 * scale))
  const x = Math.min(petX, panelX)
  const y = Math.min(petY, panelY)
  return {
    x, y,
    width: (Math.max(petX + PET_WIDTH * scale, panelX + width * scale) - x) / scale,
    height: (Math.max(petY + PET_HEIGHT * scale, panelY + height * scale) - y) / scale,
    pet: { left: (petX - x) / scale, top: (petY - y) / scale },
    panel: { left: (panelX - x) / scale, top: (panelY - y) / scale, width, height },
  }
}
