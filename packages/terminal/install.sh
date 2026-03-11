#!/usr/bin/env bash
set -euo pipefail

# OpenMeet Terminal Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/<owner>/openmeet/main/packages/terminal/install.sh | bash

BOLD='\033[1m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
RESET='\033[0m'

info()  { echo -e "${GREEN}[+]${RESET} $*"; }
warn()  { echo -e "${YELLOW}[!]${RESET} $*"; }
error() { echo -e "${RED}[x]${RESET} $*"; exit 1; }

# --- Check prerequisites ---

command -v node >/dev/null 2>&1 || error "Node.js >= 22 is required. Install it from https://nodejs.org"

NODE_MAJOR=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 22 ]; then
  error "Node.js >= 22 required (found v$(node -v)). Update from https://nodejs.org"
fi

command -v npm >/dev/null 2>&1 || error "npm is required (usually bundled with Node.js)"

# Check for sox
if ! command -v sox >/dev/null 2>&1; then
  warn "sox is required for audio capture/playback but was not found."
  echo ""
  if [ "$(uname)" = "Darwin" ]; then
    echo "  Install with:  brew install sox"
  elif command -v apt >/dev/null 2>&1; then
    echo "  Install with:  sudo apt install sox"
  elif command -v dnf >/dev/null 2>&1; then
    echo "  Install with:  sudo dnf install sox"
  elif command -v pacman >/dev/null 2>&1; then
    echo "  Install with:  sudo pacman -S sox"
  else
    echo "  Install sox from: https://sox.sourceforge.net"
  fi
  echo ""
fi

# --- Install ---

info "Installing openmeet-terminal..."
npm install -g openmeet-terminal

info "Installed successfully!"
echo ""
echo -e "  ${BOLD}Usage:${RESET}"
echo "    openmeet --server ws://your-server:3001/ws --room <room-id>"
echo ""
echo -e "  ${BOLD}Options:${RESET}"
echo "    --server <url>         WebSocket URL (default: ws://localhost:3001/ws)"
echo "    --room <id>            Room ID to join directly"
echo "    --input-device <name>  Input device name"
echo "    --output-device <name> Output device name"
echo "    -h, --help             Show help"
echo ""
