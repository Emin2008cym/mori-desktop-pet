#!/usr/bin/env bash
set -euo pipefail

cd "$HOME/mori-desktop-pet"

# Re-launching the desktop icon replaces only Mori's own dev processes.
pkill -x mori-desktop-pet 2>/dev/null || true
pkill -f "$HOME/mori-desktop-pet/node_modules/.bin/tauri dev" 2>/dev/null || true
pkill -f "$HOME/mori-desktop-pet/node_modules/vite/bin/vite.js" 2>/dev/null || true
pkill -f "npm run package:backend" 2>/dev/null || true
sleep 1

export OLLAMA_URL="${OLLAMA_URL:-http://192.168.56.1:11434}"
export LIBGL_ALWAYS_SOFTWARE=1
export WEBKIT_DISABLE_COMPOSITING_MODE=1
# Tauri's dynamic pet-window resizing and placement need an X11 window manager.
export GDK_BACKEND=x11
exec npm run tauri:dev
