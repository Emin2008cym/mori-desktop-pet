import test from 'node:test'
import assert from 'node:assert/strict'
import { petLayout, PET_WIDTH, PET_HEIGHT } from '../src/pet-layout.ts'

test('pet stays at exactly the same desktop coordinates when menus and chat expand at every screen edge and DPI', () => {
  for (const scale of [1, 1.25, 1.5, 2]) {
    for (const screen of [{ x: 0, y: 0, width: 1920, height: 1080 }, { x: -1920, y: 120, width: 1920, height: 1080 }]) {
      for (const anchor of [
        { x: screen.x, y: screen.y },
        { x: screen.x + 540, y: screen.y + 350 },
        { x: screen.x + screen.width - PET_WIDTH * scale, y: screen.y + screen.height - PET_HEIGHT * scale },
      ]) {
        for (const height of [0, 178, 396]) {
          const layout = petLayout(anchor, screen, scale, height)
          assert.ok(Math.abs(layout.x + layout.pet.left * scale - anchor.x) < 0.001)
          assert.ok(Math.abs(layout.y + layout.pet.top * scale - anchor.y) < 0.001)
          assert.ok(layout.x >= screen.x && layout.y >= screen.y)
          assert.ok(layout.x + layout.width * scale <= screen.x + screen.width + 0.001)
          assert.ok(layout.y + layout.height * scale <= screen.y + screen.height + 0.001)
        }
      }
    }
  }
})
